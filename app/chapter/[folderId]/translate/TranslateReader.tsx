'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { createWorker, Worker } from 'tesseract.js'

interface ChapterImage {
  id: string
  src: string
  name: string
}

interface OverlaySegment {
  sourceText: string
  translatedText: string
  x: number
  y: number
  width: number
  height: number
}

type TranslationLang = 'jpn' | 'chi_sim'

type ImageStatus = 'idle' | 'loading-model' | 'ocr' | 'translating' | 'done' | 'error'

interface ImageTranslation {
  status: ImageStatus
  ocrText?: string
  segments?: OverlaySegment[]
  errorMsg?: string
}

interface Props {
  images: ChapterImage[]
  folderName: string
  folderId: string
}

/** Detect source language from OCR text by checking Unicode ranges */
function detectApiLang(text: string): 'ja' | 'zh' {
  // Hiragana U+3040-U+309F, Katakana U+30A0-U+30FF
  return /[\u3040-\u309f\u30a0-\u30ff]/.test(text) ? 'ja' : 'zh'
}

function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
}

function extractLineSegments(data: unknown): Omit<OverlaySegment, 'translatedText'>[] {
  const lines = (data as { lines?: Array<{
    text?: string
    confidence?: number
    bbox?: { x0?: number; y0?: number; x1?: number; y1?: number }
  }> })?.lines ?? []

  return lines
    .map(line => {
      const text = (line.text ?? '').trim()
      const confidence = line.confidence ?? 0
      const x0 = line.bbox?.x0 ?? 0
      const y0 = line.bbox?.y0 ?? 0
      const x1 = line.bbox?.x1 ?? 0
      const y1 = line.bbox?.y1 ?? 0
      return {
        sourceText: text,
        x: Math.max(0, x0),
        y: Math.max(0, y0),
        width: Math.max(0, x1 - x0),
        height: Math.max(0, y1 - y0),
        confidence,
      }
    })
    .filter(seg => seg.sourceText.length >= 1)
    .filter(seg => seg.width > 3 && seg.height > 3)
    .filter(seg => seg.confidence >= 20)
    .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y))
    .map(({ confidence: _, ...seg }) => seg)
}

async function translateWithMyMemory(text: string): Promise<string> {
  const from = detectApiLang(text)
  // MyMemory free tier: no key needed, CORS-enabled, ~1000 req/day
  const url = new URL('https://api.mymemory.translated.net/get')
  url.searchParams.set('q', text.slice(0, 500))
  url.searchParams.set('langpair', `${from}|vi`)

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`)
  const data = await res.json()

  const translated: string = data.responseData?.translatedText ?? ''
  if (!translated) throw new Error('Empty translation response')

  return decodeHtmlEntities(translated)
}

export default function TranslateReader({ images, folderName, folderId }: Props) {
  const [lang, setLang] = useState<TranslationLang>('jpn')
  const [translations, setTranslations] = useState<Record<number, ImageTranslation>>({})
  const [isRunning, setIsRunning] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [imageSize, setImageSize] = useState<Record<number, { width: number; height: number }>>({})
  const [showOverlay, setShowOverlay] = useState(true)

  // Use refs so async loop always has fresh values without recreating the handler
  const workerRef = useRef<Worker | null>(null)
  const workerLangRef = useRef<string>('')
  const translationsRef = useRef<Record<number, ImageTranslation>>({})
  const abortRef = useRef(false)
  const langRef = useRef(lang)

  useEffect(() => { langRef.current = lang }, [lang])

  // Sync ref with state so the loop sees latest values
  useEffect(() => { translationsRef.current = translations }, [translations])

  // Cleanup worker on unmount
  useEffect(() => {
    return () => { workerRef.current?.terminate() }
  }, [])

  const updateTranslation = (i: number, update: Partial<ImageTranslation>) => {
    setTranslations(prev => {
      const next = {
        ...prev,
        [i]: { ...(prev[i] ?? { status: 'idle' as ImageStatus }), ...update },
      }
      translationsRef.current = next
      return next
    })
  }

  const handleStart = async () => {
    if (isRunning) return
    abortRef.current = false
    setIsRunning(true)
    setCurrentIndex(-1)

    try {
      const targetLang = langRef.current

      // Re-create worker if language changed
      if (!workerRef.current || workerLangRef.current !== targetLang) {
        if (workerRef.current) {
          await workerRef.current.terminate()
          workerRef.current = null
        }

        // Find the first image that needs processing to show loading-model on
        const firstPending = images.findIndex(
          (_, i) => (translationsRef.current[i]?.status ?? 'idle') !== 'done',
        )
        if (firstPending >= 0) {
          updateTranslation(firstPending, { status: 'loading-model' })
          setCurrentIndex(firstPending)
        }

        workerRef.current = await createWorker(targetLang)
        workerLangRef.current = targetLang
      }

      for (let i = 0; i < images.length; i++) {
        if (abortRef.current) break
        if ((translationsRef.current[i]?.status ?? 'idle') === 'done') continue

        setCurrentIndex(i)
        updateTranslation(i, { status: 'ocr' })

        try {
          const { data } = await workerRef.current!.recognize(images[i].src)
          const text = data.text.trim()
          const lineSegments = extractLineSegments(data)

          // Low confidence or empty → mark done with no-text message
          if (!text || data.confidence < 15 || lineSegments.length === 0) {
            updateTranslation(i, {
              status: 'done',
              ocrText: '',
              segments: [],
            })
            continue
          }

          updateTranslation(i, { status: 'translating', ocrText: text })

          const translatedSegments: OverlaySegment[] = []
          for (const seg of lineSegments) {
            if (abortRef.current) break
            try {
              const translated = await translateWithMyMemory(seg.sourceText)
              translatedSegments.push({ ...seg, translatedText: translated })
            } catch {
              // Fallback to source text for this segment if translation fails.
              translatedSegments.push({ ...seg, translatedText: seg.sourceText })
            }
          }

          updateTranslation(i, {
            status: 'done',
            ocrText: text,
            segments: translatedSegments,
          })
        } catch {
          updateTranslation(i, { status: 'error', errorMsg: 'OCR thất bại cho trang này' })
        }
      }
    } finally {
      setIsRunning(false)
      setCurrentIndex(-1)
    }
  }

  const handleStop = () => { abortRef.current = true }

  const totalDone = Object.values(translations).filter(t => t.status === 'done').length
  const progress = images.length > 0 ? (totalDone / images.length) * 100 : 0

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Sticky nav bar */}
      <nav className="bg-[#111]/95 border-b border-gray-800 px-4 py-3 sticky top-0 z-20 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto flex flex-wrap items-center gap-3">
          <Link
            href={`/chapter/${folderId}`}
            className="flex items-center gap-1.5 text-gray-400 hover:text-red-400 transition-colors text-sm shrink-0"
          >
            <span>←</span>
            <span className="hidden sm:inline">Bản gốc</span>
          </Link>
          <div className="h-4 w-px bg-gray-700 shrink-0" />
          <h1 className="text-sm font-semibold text-gray-200 truncate">{folderName}</h1>

          <div className="ml-auto flex items-center gap-2 shrink-0">
            {/* Language selector */}
            <select
              value={lang}
              onChange={e => setLang(e.target.value as TranslationLang)}
              disabled={isRunning}
              className="bg-gray-800 text-gray-300 text-xs rounded px-2 py-1 border border-gray-700 disabled:opacity-50"
            >
              <option value="jpn">🇯🇵 Nhật</option>
              <option value="chi_sim">🇨🇳 Trung</option>
            </select>

            <button
              onClick={() => setShowOverlay(v => !v)}
              className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
            >
              {showOverlay ? 'Ẩn lớp dịch' : 'Hiện lớp dịch'}
            </button>

            {!isRunning ? (
              <button
                onClick={handleStart}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
              >
                🌐 {totalDone > 0 && totalDone < images.length ? 'Dịch tiếp' : 'Bắt đầu dịch'}
              </button>
            ) : (
              <button
                onClick={handleStop}
                className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
              >
                ⏹ Dừng
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {(isRunning || totalDone > 0) && (
          <div className="max-w-3xl mx-auto mt-2">
            <div className="w-full bg-gray-800 rounded-full h-1">
              <div
                className="bg-blue-500 h-1 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1 text-right">
              {totalDone}/{images.length} trang đã dịch
            </p>
          </div>
        )}
      </nav>

      {/* Image list */}
      <div className="flex flex-col items-center bg-black">
        {images.length === 0 ? (
          <div className="text-center py-32 text-gray-600">
            <p className="text-5xl mb-4">🖼️</p>
            <p className="text-lg">Không có ảnh trong chương này.</p>
          </div>
        ) : (
          images.map((img, i) => {
            const t = translations[i] ?? { status: 'idle' }
            const isActive = i === currentIndex && isRunning

            return (
              <div key={img.id} className="w-full max-w-3xl">
                {/* Image with active-processing overlay */}
                <div className="relative">
                  <img
                    src={img.src}
                    alt={`Trang ${i + 1}`}
                    crossOrigin="anonymous"
                    className="w-full block"
                    loading={i < 3 ? 'eager' : 'lazy'}
                    decoding="async"
                    onLoad={e => {
                      const el = e.currentTarget
                      setImageSize(prev => ({
                        ...prev,
                        [i]: {
                          width: el.naturalWidth,
                          height: el.naturalHeight,
                        },
                      }))
                    }}
                  />

                  {showOverlay && t.status === 'done' && t.segments && t.segments.length > 0 && imageSize[i] && (
                    <div className="absolute inset-0 pointer-events-none select-none">
                      {t.segments.map((seg, segIndex) => {
                        const width = imageSize[i].width
                        const height = imageSize[i].height
                        const left = (seg.x / width) * 100
                        const top = (seg.y / height) * 100
                        const segWidth = (seg.width / width) * 100
                        const segHeight = (seg.height / height) * 100

                        return (
                          <div
                            key={`${img.id}-${segIndex}`}
                            className="absolute bg-white/90 text-black rounded-sm px-1 py-0.5 overflow-hidden"
                            style={{
                              left: `${left}%`,
                              top: `${top}%`,
                              width: `${segWidth}%`,
                              minHeight: `${Math.max(segHeight, 1.8)}%`,
                              fontSize: `clamp(10px, ${Math.max(segHeight * 0.35, 0.7)}vw, 20px)`,
                              lineHeight: 1.15,
                            }}
                            title={seg.sourceText}
                          >
                            {seg.translatedText}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {isActive && (
                    <div className="absolute inset-0 bg-blue-950/30 flex items-end justify-center pb-4 pointer-events-none">
                      <div className="bg-black/80 rounded-lg px-4 py-2 text-xs text-blue-300 animate-pulse">
                        {t.status === 'loading-model' && '⏳ Đang tải mô hình OCR (~10 MB)...'}
                        {t.status === 'ocr' && '🔍 Đang nhận diện văn bản...'}
                        {t.status === 'translating' && '🌐 Đang dịch...'}
                      </div>
                    </div>
                  )}
                </div>

                {/* OCR status panel */}
                {t.status !== 'idle' && (
                  <div className="bg-[#0d1117] border-t border-blue-900/30 px-4 py-3">
                    {/* In-progress states */}
                    {(t.status === 'loading-model' || t.status === 'ocr' || t.status === 'translating') && (
                      <p className={`text-xs animate-pulse ${t.status === 'translating' ? 'text-yellow-400' : 'text-blue-400'}`}>
                        {t.status === 'loading-model' && '⏳ Đang tải mô hình OCR (~10 MB)...'}
                        {t.status === 'ocr' && '🔍 Đang nhận diện văn bản...'}
                        {t.status === 'translating' && '🌐 Đang dịch sang tiếng Việt...'}
                      </p>
                    )}

                    {/* Error */}
                    {t.status === 'error' && (
                      <p className="text-xs text-red-400">⚠ {t.errorMsg}</p>
                    )}

                    {/* Done */}
                    {t.status === 'done' && (
                      <div className="space-y-2 text-xs text-gray-400">
                        <p>
                          {t.segments && t.segments.length > 0
                            ? `Đã chèn ${t.segments.length} đoạn dịch đúng vị trí trên ảnh.`
                            : 'Không tìm thấy văn bản để chèn trên ảnh.'}
                        </p>
                        {t.ocrText && (
                          <details>
                            <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-400 select-none">
                              Văn bản gốc OCR
                            </summary>
                            <p className="text-xs text-gray-500 mt-1 font-mono whitespace-pre-wrap leading-relaxed">
                              {t.ocrText}
                            </p>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Bottom navigation */}
      {images.length > 0 && (
        <div className="bg-[#111] border-t border-gray-800 py-6 text-center">
          <p className="text-gray-500 text-sm mb-3">Hết chương · {folderName}</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 transition-colors text-white font-semibold px-6 py-2.5 rounded-full text-sm"
          >
            ← Danh sách chương
          </Link>
        </div>
      )}
    </div>
  )
}

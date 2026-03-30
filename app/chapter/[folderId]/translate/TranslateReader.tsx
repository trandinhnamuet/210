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

interface BlockNode {
  bbox?: { x0?: number; y0?: number; x1?: number; y1?: number }
  text?: string
  confidence?: number
  paragraphs?: Array<{
    lines?: Array<{
      bbox?: { x0?: number; y0?: number; x1?: number; y1?: number }
      text?: string
      confidence?: number
      words?: Array<{
        bbox?: { x0?: number; y0?: number; x1?: number; y1?: number }
        text?: string
        confidence?: number
      }>
    }>
  }>
}

function detectApiLang(text: string): 'ja' | 'zh' {
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

function getBBox(item: unknown): { x: number; y: number; width: number; height: number } | null {
  const src = item as {
    bbox?: { x0?: number; y0?: number; x1?: number; y1?: number }
    box?: { x0?: number; y0?: number; x1?: number; y1?: number }
    x0?: number
    y0?: number
    x1?: number
    y1?: number
  }

  const x0 = src.bbox?.x0 ?? src.box?.x0 ?? src.x0
  const y0 = src.bbox?.y0 ?? src.box?.y0 ?? src.y0
  const x1 = src.bbox?.x1 ?? src.box?.x1 ?? src.x1
  const y1 = src.bbox?.y1 ?? src.box?.y1 ?? src.y1

  if (
    typeof x0 !== 'number' ||
    typeof y0 !== 'number' ||
    typeof x1 !== 'number' ||
    typeof y1 !== 'number'
  ) {
    return null
  }

  const width = Math.max(0, x1 - x0)
  const height = Math.max(0, y1 - y0)
  if (width <= 2 || height <= 2) return null

  return {
    x: Math.max(0, x0),
    y: Math.max(0, y0),
    width,
    height,
  }
}

async function fetchImageAsDataUrl(src: string): Promise<string> {
  const res = await fetch(src, { mode: 'cors', cache: 'force-cache' })
  if (!res.ok) throw new Error(`Không tải được ảnh OCR: HTTP ${res.status}`)

  const blob = await res.blob()

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Không đọc được dữ liệu ảnh để OCR'))
    reader.readAsDataURL(blob)
  })
}

function createSegment(text: string, confidence: number, item: unknown): Omit<OverlaySegment, 'translatedText'> | null {
  const box = getBBox(item)
  const cleanText = text.trim()

  if (!box || !cleanText) return null
  if (confidence < 0) return null

  return {
    sourceText: cleanText,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  }
}

function extractLineSegments(data: unknown): Omit<OverlaySegment, 'translatedText'>[] {
  const blocks = (data as { blocks?: BlockNode[] })?.blocks ?? []
  const blockSegments = blocks.flatMap(block =>
    (block.paragraphs ?? []).flatMap(paragraph =>
      (paragraph.lines ?? []).flatMap(line => {
        const lineSegment = createSegment(line.text ?? '', line.confidence ?? 0, line)
        if (lineSegment) return [lineSegment]

        return (line.words ?? [])
          .map(word => createSegment(word.text ?? '', word.confidence ?? 0, word))
          .filter((segment): segment is Omit<OverlaySegment, 'translatedText'> => Boolean(segment))
      }),
    ),
  )
    .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y))

  if (blockSegments.length > 0) return blockSegments

  const lines = (data as { lines?: Array<{
    text?: string
    confidence?: number
    bbox?: { x0?: number; y0?: number; x1?: number; y1?: number }
  }> })?.lines ?? []

  const lineSegments = lines
    .map(line => createSegment(line.text ?? '', line.confidence ?? 0, line))
    .filter((segment): segment is Omit<OverlaySegment, 'translatedText'> => Boolean(segment))
    .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y))

  if (lineSegments.length > 0) return lineSegments

  const words = (data as { words?: Array<{
    text?: string
    confidence?: number
    bbox?: { x0?: number; y0?: number; x1?: number; y1?: number }
  }> })?.words ?? []

  return words
    .map(word => createSegment(word.text ?? '', word.confidence ?? 0, word))
    .filter((segment): segment is Omit<OverlaySegment, 'translatedText'> => Boolean(segment))
    .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y))
}

async function translateWithMyMemory(text: string): Promise<string> {
  const from = detectApiLang(text)
  const url = new URL('https://api.mymemory.translated.net/get')
  url.searchParams.set('q', text.slice(0, 500))
  url.searchParams.set('langpair', `${from}|vi`)

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`)
  const data = await res.json()
  if (data.responseStatus && Number(data.responseStatus) !== 200) {
    throw new Error(data.responseDetails || 'MyMemory failed')
  }

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

  const workerRef = useRef<Worker | null>(null)
  const workerLangRef = useRef<string>('')
  const translationsRef = useRef<Record<number, ImageTranslation>>({})
  const abortRef = useRef(false)
  const langRef = useRef(lang)

  useEffect(() => { langRef.current = lang }, [lang])
  useEffect(() => { translationsRef.current = translations }, [translations])
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

      if (!workerRef.current || workerLangRef.current !== targetLang) {
        if (workerRef.current) {
          await workerRef.current.terminate()
          workerRef.current = null
        }

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
          const imageForOcr = await fetchImageAsDataUrl(images[i].src)
          const { data } = await workerRef.current!.recognize(
            imageForOcr,
            {},
            { blocks: true },
          )
          const text = data.text.trim()
          const lineSegments = extractLineSegments(data)

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
              translatedSegments.push({ ...seg, translatedText: seg.sourceText })
            }
          }

          updateTranslation(i, {
            status: 'done',
            ocrText: text,
            segments: translatedSegments,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'OCR thất bại'
          updateTranslation(i, { status: 'error', errorMsg: message })
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Lỗi OCR không xác định'
      if (currentIndex >= 0) {
        updateTranslation(currentIndex, { status: 'error', errorMsg: message })
      }
      console.error('OCR error:', error)
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
                        {t.status === 'loading-model' && '⏳ Đang tải mô hình OCR...'}
                        {t.status === 'ocr' && '🔍 Đang nhận diện văn bản...'}
                        {t.status === 'translating' && '🌐 Đang dịch...'}
                      </div>
                    </div>
                  )}
                </div>

                {t.status !== 'idle' && (
                  <div className="bg-[#0d1117] border-t border-blue-900/30 px-4 py-3">
                    {(t.status === 'loading-model' || t.status === 'ocr' || t.status === 'translating') && (
                      <p className={`text-xs animate-pulse ${t.status === 'translating' ? 'text-yellow-400' : 'text-blue-400'}`}>
                        {t.status === 'loading-model' && '⏳ Đang tải mô hình OCR...'}
                        {t.status === 'ocr' && '🔍 Đang nhận diện văn bản...'}
                        {t.status === 'translating' && '🌐 Đang dịch sang tiếng Việt...'}
                      </p>
                    )}

                    {t.status === 'error' && (
                      <p className="text-xs text-red-400">⚠ {t.errorMsg}</p>
                    )}

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

import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  isValidFolderId,
  getChapterImages,
  getFolderInfo,
  buildImageSrc,
} from '@/app/lib/chapter'

export default async function ChapterPage({
  params,
}: {
  params: Promise<{ folderId: string }>
}) {
  const { folderId } = await params

  if (!isValidFolderId(folderId)) notFound()

  const [folderInfo, images] = await Promise.all([
    getFolderInfo(folderId),
    getChapterImages(folderId),
  ])

  if (!folderInfo) notFound()

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Top navigation bar */}
      <nav className="bg-[#111]/95 border-b border-gray-800 px-4 py-3 sticky top-0 z-20 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-gray-400 hover:text-red-400 transition-colors text-sm shrink-0"
          >
            <span>←</span>
            <span className="hidden sm:inline">Trang chủ</span>
          </Link>
          <div className="h-4 w-px bg-gray-700 shrink-0" />
          <h1 className="text-sm font-semibold text-gray-200 truncate">{folderInfo.name}</h1>
          <span className="text-xs text-gray-500 ml-auto shrink-0">{images.length} trang</span>
        </div>
      </nav>

      {/* Comic strip reader: images stacked vertically */}
      <div className="flex flex-col items-center bg-black">
                  {images.length === 0 ? (
          <div className="text-center py-32 text-gray-600">
            <p className="text-5xl mb-4">🖼️</p>
            <p className="text-lg">Không có ảnh trong chương này.</p>
          </div>
        ) : (
          images.map((img, i) => {
            // Use helper from lib to build image src (handles thumbnailLink fallback)
            const src = buildImageSrc(img)
            return (
            <img
              key={img.id}
              src={src}
              alt={`Trang ${i + 1}`}
              className="w-full max-w-3xl block"
              loading={i < 3 ? 'eager' : 'lazy'}
              decoding="async"
            />
            )
          })
        )}
      </div>

      {/* Bottom navigation */}
      {images.length > 0 && (
        <div className="bg-[#111] border-t border-gray-800 py-6 text-center">
          <p className="text-gray-500 text-sm mb-3">Hết chương · {folderInfo.name}</p>
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

'use client'

import Link from 'next/link'
import { useState, useMemo } from 'react'

interface ChapterData {
  id: string
  name: string
  createdTime: string
  thumbnailSrc: string | null
  pageCount: number
}

interface Props {
  chapters: ChapterData[]
}

export default function ChapterGrid({ chapters }: Props) {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredChapters = useMemo(() => {
    if (!searchQuery.trim()) return chapters

    const query = searchQuery.toLowerCase()
    return chapters.filter((chapter) => chapter.name.toLowerCase().includes(query))
  }, [chapters, searchQuery])

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 pb-12">
      {/* Search input */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="🔍 Tìm kiếm theo tên truyện..."
          className="w-full bg-[#1a1a1a] border border-red-500/30 text-white placeholder-gray-500 rounded-lg px-4 py-3 focus:outline-none focus:border-red-500/60 transition-colors"
          value={searchQuery}
          onChange={handleSearchChange}
        />
        {searchQuery && (
          <p className="text-sm text-gray-400 mt-2">
            Tìm thấy {filteredChapters.length} / {chapters.length} truyện
          </p>
        )}
      </div>

      {filteredChapters.length === 0 ? (
        <div className="text-center py-32 text-gray-600">
          <p className="text-5xl mb-4">📭</p>
          <p className="text-lg">
            {searchQuery ? 'Không tìm thấy truyện nào phù hợp.' : 'Không tìm thấy chương nào.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filteredChapters.map((chapter) => (
            <Link key={chapter.id} href={`/chapter/${chapter.id}`} className="group block">
              <div className="rounded-lg overflow-hidden bg-[#1a1a1a] border border-gray-800 group-hover:border-red-500/60 transition-all duration-200 group-hover:shadow-[0_0_20px_rgba(239,68,68,0.15)] group-hover:-translate-y-1">
                {/* Cover image */}
                <div className="aspect-[2/3] relative bg-gray-900 overflow-hidden">
                  {chapter.thumbnailSrc ? (
                    <img
                      src={chapter.thumbnailSrc}
                      alt={chapter.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900">
                      <span className="text-5xl opacity-30">📖</span>
                    </div>
                  )}
                  {/* Overlay gradient */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                </div>
                {/* Info */}
                <div className="p-2.5">
                  <p className="text-sm font-semibold text-gray-100 truncate group-hover:text-red-400 transition-colors leading-tight">
                    {chapter.name}
                  </p>
                  <div className="mt-1 flex items-center justify-between">
                    <p className="text-xs text-gray-500">
                      {new Date(chapter.createdTime).toLocaleDateString('vi-VN', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                      })}
                    </p>
                    {chapter.pageCount > 0 && (
                      <div className="text-xs font-semibold text-red-400">
                        {chapter.pageCount}p
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

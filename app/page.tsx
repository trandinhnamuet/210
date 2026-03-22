import Link from 'next/link'

interface DriveFolder {
  id: string
  name: string
  createdTime: string
}

function extractFolderId(url: string): string {
  const match = url.match(/folders\/([a-zA-Z0-9_-]+)/)
  return match?.[1] ?? url
}

async function getFirstImageId(folderId: string, apiKey: string): Promise<string | null> {
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  url.searchParams.set('q', `'${folderId}' in parents and mimeType contains 'image/'`)
  url.searchParams.set('fields', 'files(id)')
  url.searchParams.set('orderBy', 'name')
  url.searchParams.set('pageSize', '1')
  url.searchParams.set('key', apiKey)

  const res = await fetch(url.toString(), { next: { revalidate: 3600 } })
  if (!res.ok) return null
  const data = await res.json()
  return (data.files as { id: string }[])?.[0]?.id ?? null
}

async function getFolders(): Promise<DriveFolder[]> {
  const apiKey = process.env.GOOGLE_API_KEY ?? ''
  const rootUrl = process.env.ROOT_FOLDER ?? ''
  const folderId = extractFolderId(rootUrl)

  const url = new URL('https://www.googleapis.com/drive/v3/files')
  url.searchParams.set(
    'q',
    `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  )
  url.searchParams.set('fields', 'files(id,name,createdTime)')
  url.searchParams.set('orderBy', 'createdTime desc')
  url.searchParams.set('pageSize', '200')
  url.searchParams.set('key', apiKey)

  const res = await fetch(url.toString(), { next: { revalidate: 300 } })
  if (!res.ok) return []
  const data = await res.json()
  return (data.files as DriveFolder[]) ?? []
}

export default async function HomePage() {
  const apiKey = process.env.GOOGLE_API_KEY ?? ''
  const folders = await getFolders()

  const chapters = await Promise.all(
    folders.map(async (folder) => ({
      ...folder,
      thumbnailId: await getFirstImageId(folder.id, apiKey),
    })),
  )

  return (
    <main className="min-h-screen bg-[#0d0d0d] text-white">
      {/* Header */}
      <header className="bg-[#111] border-b border-red-900/40 px-6 py-4 sticky top-0 z-20 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <span className="text-2xl">📚</span>
          <h1 className="text-2xl font-black text-red-500 tracking-widest uppercase">
            MangaReader
          </h1>
          <span className="ml-auto text-sm text-gray-500">{chapters.length} chương</span>
        </div>
      </header>

      {/* Hero banner */}
      <div className="bg-gradient-to-b from-red-950/30 to-transparent px-6 pt-8 pb-4">
        <div className="max-w-7xl mx-auto">
          <p className="text-gray-400 text-sm uppercase tracking-widest mb-1">Cập nhật mới nhất</p>
          <h2 className="text-3xl font-bold text-white">Danh sách chương</h2>
        </div>
      </div>

      {/* Chapter grid */}
      <div className="max-w-7xl mx-auto px-4 pb-12">
        {chapters.length === 0 ? (
          <div className="text-center py-32 text-gray-600">
            <p className="text-5xl mb-4">📭</p>
            <p className="text-lg">Không tìm thấy chương nào.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {chapters.map((chapter) => (
              <Link key={chapter.id} href={`/chapter/${chapter.id}`} className="group block">
                <div className="rounded-lg overflow-hidden bg-[#1a1a1a] border border-gray-800 group-hover:border-red-500/60 transition-all duration-200 group-hover:shadow-[0_0_20px_rgba(239,68,68,0.15)] group-hover:-translate-y-1">
                  {/* Cover image */}
                  <div className="aspect-[2/3] relative bg-gray-900 overflow-hidden">
                    {chapter.thumbnailId ? (
                      <img
                        src={`/api/img?id=${chapter.thumbnailId}`}
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
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(chapter.createdTime).toLocaleDateString('vi-VN', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-800/50 py-6 text-center text-gray-600 text-xs">
        MangaReader &copy; {new Date().getFullYear()}
      </footer>
    </main>
  )
}

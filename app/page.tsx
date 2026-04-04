import Link from 'next/link'
import { getChapterImages } from './lib/chapter'
import ChapterGrid from './components/ChapterGrid'

interface DriveFolder {
  id: string
  name: string
  createdTime: string
}

interface ChapterData {
  id: string
  name: string
  createdTime: string
  thumbnailSrc: string | null
  pageCount: number
}

function extractFolderId(url: string): string {
  const match = url.match(/folders\/([a-zA-Z0-9_-]+)/)
  return match?.[1] ?? url
}

async function getFirstImageSrc(folderId: string, apiKey: string): Promise<string | null> {
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  url.searchParams.set('q', `'${folderId}' in parents and mimeType contains 'image/'`)
  url.searchParams.set('fields', 'files(id,thumbnailLink)')
  url.searchParams.set('orderBy', 'name')
  url.searchParams.set('pageSize', '1')
  url.searchParams.set('key', apiKey)

  const res = await fetch(url.toString(), { next: { revalidate: 3600 } })
  if (!res.ok) return null
  const data = await res.json()
  const file = (data.files as { id: string; thumbnailLink?: string }[])?.[0]
  if (!file) return null
  // thumbnailLink is a Google CDN URL like https://lh3.googleusercontent.com/...=s220
  // Bump to a larger size suitable for card covers
  if (file.thumbnailLink) return file.thumbnailLink.replace(/=s\d+$/, '=s400')
  // Fallback: proxy-as-redirect route
  return `/api/img?id=${file.id}&size=thumb`
}

async function getPageCount(folderId: string): Promise<number> {
  try {
    const images = await getChapterImages(folderId)
    return images.length
  } catch {
    return 0
  }
}

async function getFoldersFromRoot(folderId: string, apiKey: string): Promise<DriveFolder[]> {
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

async function getFolders(): Promise<DriveFolder[]> {
  const apiKey = process.env.GOOGLE_API_KEY ?? ''
  const rootUrls = [
    process.env.ROOT_FOLDER,
    process.env.ROOT_FOLDER2,
    process.env.ROOT_FOLDER3,
    process.env.ROOT_FOLDER4,
  ].filter(Boolean) as string[]

  const results = await Promise.all(
    rootUrls.map((url) => getFoldersFromRoot(extractFolderId(url), apiKey)),
  )

  // Merge all folders, deduplicate by id, preserve createdTime desc order
  const seen = new Set<string>()
  const merged: DriveFolder[] = []
  for (const folders of results) {
    for (const folder of folders) {
      if (!seen.has(folder.id)) {
        seen.add(folder.id)
        merged.push(folder)
      }
    }
  }
  merged.sort((a, b) => b.createdTime.localeCompare(a.createdTime))
  return merged
}

async function getChaptersData(): Promise<ChapterData[]> {
  const apiKey = process.env.GOOGLE_API_KEY ?? ''
  const folders = await getFolders()

  const concurrency = parseInt(process.env.CHAPTER_FETCH_CONCURRENCY ?? '3', 10)
  const chapters: ChapterData[] = []

  for (let i = 0; i < folders.length; i += concurrency) {
    const batch = folders.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map(async (folder) => ({
        id: folder.id,
        name: folder.name,
        createdTime: folder.createdTime,
        thumbnailSrc: await getFirstImageSrc(folder.id, apiKey),
        pageCount: await getPageCount(folder.id),
      })),
    )
    chapters.push(...batchResults)
  }

  return chapters
}

export default async function HomePage() {
  const chapters = await getChaptersData()

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
      <ChapterGrid chapters={chapters} />

      {/* Footer */}
      <footer className="border-t border-gray-800/50 py-6 text-center text-gray-600 text-xs">
        MangaReader &copy; {new Date().getFullYear()}
      </footer>
    </main>
  )
}

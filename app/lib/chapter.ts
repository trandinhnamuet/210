export interface DriveFile {
  id: string
  name: string
  thumbnailLink?: string
}

const VALID_ID = /^[a-zA-Z0-9_-]+$/

export function isValidFolderId(id: string): boolean {
  return VALID_ID.test(id) && id.length <= 200
}

export function buildImageSrc(img: DriveFile): string {
  return img.thumbnailLink
    ? img.thumbnailLink.replace(/=s\d+$/, '=s1600')
    : `/api/img?id=${img.id}`
}

export async function getChapterImages(folderId: string): Promise<DriveFile[]> {
  const apiKey = process.env.GOOGLE_API_KEY ?? ''

  const url = new URL('https://www.googleapis.com/drive/v3/files')
  url.searchParams.set(
    'q',
    `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
  )
  url.searchParams.set('fields', 'files(id,name,thumbnailLink)')
  url.searchParams.set('orderBy', 'name')
  url.searchParams.set('pageSize', '500')
  url.searchParams.set('key', apiKey)

  const res = await fetch(url.toString(), { next: { revalidate: 3600 } })
  if (!res.ok) return []
  const data = await res.json()
  return (data.files as DriveFile[]) ?? []
}

export async function getFolderInfo(folderId: string): Promise<{ name: string } | null> {
  const apiKey = process.env.GOOGLE_API_KEY ?? ''

  const url = new URL(`https://www.googleapis.com/drive/v3/files/${folderId}`)
  url.searchParams.set('fields', 'id,name,trashed')
  url.searchParams.set('key', apiKey)

  const res = await fetch(url.toString(), { next: { revalidate: 3600 } })
  if (!res.ok) return null
  const data = await res.json()
  if (data.trashed) return null
  return { name: data.name ?? 'Chương' }
}

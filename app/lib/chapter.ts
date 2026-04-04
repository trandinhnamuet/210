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
  const allFiles: DriveFile[] = []
  let pageToken: string | undefined

  async function fetchWithRetry(url: string, opts: RequestInit = {}, retries = 3, backoffMs = 1000) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await fetch(url, opts)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return await res.json()
      } catch (err) {
        const last = attempt === retries - 1
        if (last) throw err
        await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, attempt)))
      }
    }
  }

  do {
    const url = new URL('https://www.googleapis.com/drive/v3/files')
    url.searchParams.set(
      'q',
      `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
    )
    url.searchParams.set('fields', 'nextPageToken,files(id,name,thumbnailLink)')
    url.searchParams.set('orderBy', 'name')
    url.searchParams.set('pageSize', '1000')
    url.searchParams.set('key', apiKey)
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    try {
      const data = await fetchWithRetry(url.toString(), { next: { revalidate: 3600 } })
      const files = (data.files as DriveFile[]) ?? []
      allFiles.push(...files)
      pageToken = data.nextPageToken
    } catch (err) {
      // Persistent fetch failure (network/timeout); stop and return what we have
      break
    }
  } while (pageToken)

  return allFiles
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

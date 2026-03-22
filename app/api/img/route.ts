import { NextRequest } from 'next/server'

const VALID_ID = /^[a-zA-Z0-9_-]+$/

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')

  if (!id || !VALID_ID.test(id) || id.length > 200) {
    return new Response('Invalid file ID', { status: 400 })
  }

  const apiKey = process.env.GOOGLE_API_KEY
  if (!apiKey) return new Response('Server misconfigured', { status: 500 })

  const upstream = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${apiKey}`,
  )

  if (!upstream.ok) {
    return new Response('Image not found', { status: upstream.status })
  }

  const contentType = upstream.headers.get('content-type') ?? 'image/jpeg'
  const body = await upstream.arrayBuffer()

  return new Response(body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  })
}

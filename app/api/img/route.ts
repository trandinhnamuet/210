import { NextRequest } from 'next/server'

const VALID_ID = /^[a-zA-Z0-9_-]+$/

// Instead of proxying through the server (which Google blocks from cloud IPs),
// redirect the browser to Google's CDN so the request comes from the user's IP.
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')
  const size = request.nextUrl.searchParams.get('size') === 'thumb' ? 'w400' : 'w1600'

  if (!id || !VALID_ID.test(id) || id.length > 200) {
    return new Response('Invalid file ID', { status: 400 })
  }

  return Response.redirect(
    `https://drive.google.com/thumbnail?id=${id}&sz=${size}`,
    302,
  )
}

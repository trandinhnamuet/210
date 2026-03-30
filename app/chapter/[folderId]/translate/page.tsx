import { notFound } from 'next/navigation'
import {
  isValidFolderId,
  getChapterImages,
  getFolderInfo,
  buildImageSrc,
} from '@/app/lib/chapter'
import TranslateReader from './TranslateReader'

export default async function TranslatePage({
  params,
}: {
  params: Promise<{ folderId: string }>
}) {
  const { folderId } = await params

  if (!isValidFolderId(folderId)) notFound()

  const [folderInfo, rawImages] = await Promise.all([
    getFolderInfo(folderId),
    getChapterImages(folderId),
  ])

  if (!folderInfo) notFound()

  const images = rawImages.map(img => ({
    id: img.id,
    src: buildImageSrc(img),
    name: img.name,
  }))

  return (
    <TranslateReader
      images={images}
      folderName={folderInfo.name}
      folderId={folderId}
    />
  )
}

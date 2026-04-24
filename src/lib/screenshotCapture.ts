import { useCallback, useEffect, useState } from 'react'
import html2canvas from 'html2canvas'

function fileToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export async function captureElement(el: HTMLElement): Promise<Blob | null> {
  try {
    const rect = el.getBoundingClientRect()
    const canvas = await html2canvas(document.body, {
      useCORS: true,
      logging: false,
      scale: window.devicePixelRatio,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      scrollX: -window.scrollX,
      scrollY: -window.scrollY,
      windowWidth: document.documentElement.offsetWidth,
      windowHeight: document.documentElement.offsetHeight,
      ignoreElements: (node) => node.hasAttribute('data-fw'),
    })
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  } catch {
    return null
  }
}

export function useScreenshotCapture() {
  const [image, setImage] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!image) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(image)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [image])

  const capture = useCallback((el: HTMLElement) => {
    captureElement(el).then((blob) => { if (blob) setImage(blob) })
  }, [])

  const clear = useCallback(() => setImage(null), [])

  const toBase64 = useCallback(async (): Promise<{ base64: string; mimeType: string } | null> => {
    if (!image) return null
    return { base64: await fileToBase64(image), mimeType: image.type }
  }, [image])

  return { image, previewUrl, capture, clear, toBase64 }
}

import { useCallback, useEffect, useState } from 'react'
import html2canvas from 'html2canvas'

const MODERN_COLOR_FUNCTION_RE = /\b(oklab|oklch)\(([^()]*)\)/gi
const UNSUPPORTED_COLOR_RE = /\b(?:oklab|oklch)\(/i
const OK_AXIS_PERCENT_SCALE = 0.4
const COLOR_PROPERTIES = [
  'background-color',
  'background-image',
  'border-bottom-color',
  'border-left-color',
  'border-right-color',
  'border-top-color',
  'box-shadow',
  'caret-color',
  'color',
  'column-rule-color',
  'fill',
  'outline-color',
  'stroke',
  'text-decoration-color',
  'text-emphasis-color',
  'text-shadow',
  '-webkit-text-fill-color',
  '-webkit-text-stroke-color',
]

function fileToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function parseNumberToken(token: string, percentScale: number) {
  if (token === 'none') return 0
  if (token.endsWith('%')) return (Number.parseFloat(token) / 100) * percentScale
  return Number.parseFloat(token)
}

function parseAlphaToken(token: string | undefined) {
  if (!token || token === 'none') return 1
  if (token.endsWith('%')) return clamp(Number.parseFloat(token) / 100, 0, 1)
  return clamp(Number.parseFloat(token), 0, 1)
}

function parseHueToken(token: string) {
  if (token === 'none') return 0
  const value = Number.parseFloat(token)
  if (token.endsWith('rad')) return value * (180 / Math.PI)
  if (token.endsWith('grad')) return value * 0.9
  if (token.endsWith('turn')) return value * 360
  return value
}

function formatRgb(value: number) {
  return Math.round(clamp(value, 0, 1) * 255)
}

function linearSrgbToSrgb(value: number) {
  return value <= 0.0031308
    ? 12.92 * value
    : 1.055 * Math.pow(value, 1 / 2.4) - 0.055
}

function oklabToRgb(l: number, a: number, b: number, alpha: number) {
  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b
  const sPrime = l - 0.0894841775 * a - 1.2914855480 * b

  const l3 = lPrime ** 3
  const m3 = mPrime ** 3
  const s3 = sPrime ** 3

  const r = linearSrgbToSrgb(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3)
  const g = linearSrgbToSrgb(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3)
  const blue = linearSrgbToSrgb(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3)

  const channels = `${formatRgb(r)}, ${formatRgb(g)}, ${formatRgb(blue)}`
  return alpha < 1 ? `rgba(${channels}, ${Number(alpha.toFixed(3))})` : `rgb(${channels})`
}

function parseModernColorFunction(name: string, body: string) {
  const [rawChannels, rawAlpha] = body.split('/')
  const channels = rawChannels.trim().split(/\s+/)
  if (channels.length < 3) return null

  const alpha = parseAlphaToken(rawAlpha?.trim())
  let l = parseNumberToken(channels[0], 1)
  let a = parseNumberToken(channels[1], OK_AXIS_PERCENT_SCALE)
  let b = parseNumberToken(channels[2], OK_AXIS_PERCENT_SCALE)

  if (name.toLowerCase() === 'oklch') {
    const chroma = parseNumberToken(channels[1], OK_AXIS_PERCENT_SCALE)
    const hue = parseHueToken(channels[2]) * (Math.PI / 180)
    a = chroma * Math.cos(hue)
    b = chroma * Math.sin(hue)
  }

  if (![l, a, b, alpha].every(Number.isFinite)) return null
  l = clamp(l, 0, 1)

  return oklabToRgb(l, a, b, alpha)
}

export function convertModernColorFunctions(value: string) {
  return value.replace(MODERN_COLOR_FUNCTION_RE, (match, name: string, body: string) => {
    return parseModernColorFunction(name, body) ?? match
  })
}

function modernColorFallback(property: string) {
  if (property === 'background-image' || property.endsWith('shadow')) return 'none'
  if (property === 'background-color' || property.includes('border') || property.includes('outline')) return 'rgba(0, 0, 0, 0)'
  return 'rgb(0, 0, 0)'
}

function sanitizeModernColorFunctions(clonedDocument: Document) {
  const clonedWindow = clonedDocument.defaultView
  if (!clonedWindow) return

  const elements = [clonedDocument.documentElement, ...Array.from(clonedDocument.querySelectorAll('*'))]
  for (const element of elements) {
    const inlineStyle = (element as HTMLElement).style
    if (!inlineStyle?.setProperty) continue

    const computedStyle = clonedWindow.getComputedStyle(element)
    for (const property of COLOR_PROPERTIES) {
      const value = computedStyle.getPropertyValue(property)
      if (!UNSUPPORTED_COLOR_RE.test(value)) continue

      const converted = convertModernColorFunctions(value)
      inlineStyle.setProperty(
        property,
        UNSUPPORTED_COLOR_RE.test(converted) ? modernColorFallback(property) : converted,
        'important',
      )
    }
  }
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
      onclone: sanitizeModernColorFunctions,
    })
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          console.warn('[FeedbackWidget] Screenshot capture failed: canvas.toBlob() returned null')
        }
        resolve(blob)
      }, 'image/png')
    })
  } catch (error) {
    console.warn('[FeedbackWidget] Screenshot capture failed:', error)
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

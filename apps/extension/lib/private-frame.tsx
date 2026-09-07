import { useEffect, useState } from 'react'
import type { ClickTarget, WidgetPage } from '../../../src/components/FeedbackWidget/types'
import { receiveFrameMessages, sendFrameMessage } from './frame-channel'

const tellHost = (payload: unknown) => { void sendFrameMessage(0, payload).catch(() => {}) }
const actions = {
  async capture() {
    try {
      const image = await sendFrameMessage<string | null>(0, { kind: 'capture' })
      return image ? (await fetch(image)).blob() : null
    } catch { return null }
  },
  selecting: (value: boolean) => tellHost({ kind: 'selecting', value }),
  track: (targets: { id: string; selector: string }[]) => tellHost({ kind: 'track', targets }),
  highlight: (selector: string) => tellHost({ kind: 'highlight', selector }),
  hide: () => tellHost({ kind: 'deactivate' }),
}

// Measure interactive surfaces; the transparent frame paints independently of these hit-test bounds.
// Include positioned descendants (e.g. the launcher menu), but never expose their contents.
export function frameBounds(padding = 8) {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-fw-crrt] *')).flatMap((element) => {
    const style = getComputedStyle(element)
    if (!['fixed', 'absolute'].includes(style.position)) return []
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      const ancestor = getComputedStyle(node)
      if (ancestor.display === 'none' || ancestor.visibility === 'hidden' || ancestor.opacity === '0') return []
    }
    const rect = element.getBoundingClientRect()
    if (style.pointerEvents === 'none' && rect.width >= innerWidth && rect.height >= innerHeight) return []
    const left = Math.max(0, rect.left - padding), top = Math.max(0, rect.top - padding)
    const right = Math.min(innerWidth, rect.right + padding), bottom = Math.min(innerHeight, rect.bottom + padding)
    return rect.width && rect.height && right > left && bottom > top ? [[left, top, right - left, bottom - top]] : []
  })
}

export function usePrivateFrame() {
  const [page, setPage] = useState<WidgetPage | null>(null)
  const [activate, setActivate] = useState(false)
  useEffect(() => {
    let alive = true, layout = ''
    const apply = (message: any) => {
      if (message.kind === 'state') {
        setPage((previous) => ({ ...message, ...actions, target: previous && previous.url === message.url ? previous.target : undefined }))
      } else if (message.kind === 'target') {
        setPage((previous) => previous && { ...previous, target: message.target as ClickTarget })
      } else if (message.kind === 'activate') window.dispatchEvent(new CustomEvent('crrt:activate'))
      else if (message.kind === 'focus') window.dispatchEvent(new Event('focus'))
      else if (message.kind === 'key') window.dispatchEvent(new KeyboardEvent('keydown', { key: message.key, shiftKey: message.shiftKey }))
      else if (message.kind === 'outside') document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    }
    const stop = receiveFrameMessages((message, from) => { if (from === 0) apply(message) })
    const pointer = (event: MouseEvent) => {
      if (event.target === document.documentElement || event.target === document.body) {
        tellHost({ kind: 'pointer', x: event.clientX, y: event.clientY })
      }
    }
    document.addEventListener('mousemove', pointer)
    void sendFrameMessage<any>(0, { kind: 'ready' }).then((message) => {
      if (alive) { apply(message); setActivate(message.activate) }
    }).catch(() => { /* A detached or restricted page has no widget surface. */ })
    const timer = window.setInterval(() => {
      const next = JSON.stringify({ rects: frameBounds() })
      if (next !== layout) { layout = next; tellHost({ kind: 'layout', ...JSON.parse(next) }) }
    }, 100)
    return () => { alive = false; stop(); window.clearInterval(timer); document.removeEventListener('mousemove', pointer) }
  }, [])
  return { page, activate }
}

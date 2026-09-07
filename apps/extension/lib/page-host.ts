import { getSelector } from '../../../src/lib/getSelector'
import { buildTextRangeAnchor } from '../../../src/lib/textAnchor'
import { captureViewport, type ScreenshotFocusRect } from '../../../src/lib/screenshotCapture'
import { toPagePercent } from '../../../src/components/FeedbackWidget/coords'
import { receiveFrameMessages, sendFrameMessage } from './frame-channel'

export function connectPageHost(frame: HTMLIFrameElement, activate: boolean, deactivate: () => void) {
  let frameId = 0, selecting = false, lastState = '', focus: ScreenshotFocusRect | null = null
  let targets: { id: string; selector: string }[] = []
  let hitRects: number[][] = []
  frame.style.pointerEvents = 'none'
  let highlighted: HTMLElement | null = null, oldOutline = '', oldOffset = ''
  const originalCursor = document.body.style.cursor
  const send = (payload: unknown) => { if (frameId) void sendFrameMessage(frameId, payload).catch(() => {}) }
  function pointer(x: number, y: number) {
    frame.style.pointerEvents = hitRects.some(([left, top, width, height]) =>
      x >= left && y >= top && x <= left + width && y <= top + height) ? 'auto' : 'none'
  }
  function highlight(element: HTMLElement | null) {
    if (highlighted) { highlighted.style.outline = oldOutline; highlighted.style.outlineOffset = oldOffset }
    highlighted = element
    if (element) { oldOutline = element.style.outline; oldOffset = element.style.outlineOffset; element.style.outline = '2px solid rgba(232,133,61,.6)'; element.style.outlineOffset = '2px' }
  }
  function state() {
    const liveIds = targets.filter(({ selector }) => {
      try { const rect = document.querySelector(selector)?.getBoundingClientRect(); return rect && (rect.width || rect.height) }
      catch { return false }
    }).map(({ id }) => id)
    return { kind: 'state', url: location.href.split('#')[0], width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight, scrollX, scrollY, liveIds }
  }
  function update() {
    const next = JSON.stringify(state())
    if (next !== lastState) { lastState = next; send(JSON.parse(next)) }
  }
  const stop = receiveFrameMessages(async (message, from) => {
    if (message.kind === 'ready' && (!frameId || from === frameId)) { frameId = from; return { ...state(), activate } }
    if (from !== frameId) throw new Error('Unregistered private frame')
    if (message.kind === 'layout') {
      // Only geometry crosses into the page DOM; never comment text or image URLs.
      if (!message.rects.every((rect: number[]) => rect.every(Number.isFinite))) throw new Error('Invalid frame bounds')
      hitRects = message.rects
      // Hit testing controls clicks, not painting: stale bounds must never clip a new surface or its shadow.
      frame.style.clipPath = 'none'
    } else if (message.kind === 'pointer') {
      pointer(message.x, message.y)
    } else if (message.kind === 'selecting') {
      selecting = message.value; document.body.style.cursor = selecting ? 'crosshair' : originalCursor; highlight(null)
      if (selecting) frame.style.pointerEvents = 'none'
    } else if (message.kind === 'track') { targets = message.targets; update() }
    else if (message.kind === 'capture') {
      // Let the composer and its loading state paint before DOM screenshot rendering takes the page thread.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const blob = await captureViewport(focus)
      if (!blob) return null
      return new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Screenshot encoding failed')); reader.readAsDataURL(blob)
      })
    } else if (message.kind === 'highlight') {
      try { const element = document.querySelector<HTMLElement>(message.selector); element?.scrollIntoView({ behavior: 'smooth', block: 'center' }); highlight(element); window.setTimeout(() => highlight(null), 1400) } catch { /* stale selector */ }
    } else if (message.kind === 'deactivate') {
      deactivate()
    }
  })
  function move(event: MouseEvent) {
    pointer(event.clientX, event.clientY)
    if (!selecting) return
    const element = event.target as HTMLElement
    highlight(element.closest('[data-crrt-extension]') ? null : element)
  }
  function click(event: MouseEvent) {
    const element = event.target as HTMLElement
    if (element.closest('[data-crrt-extension]')) return
    if (!selecting) { send({ kind: 'outside' }); return }
    event.preventDefault(); event.stopPropagation(); highlight(null)
    selecting = false; document.body.style.cursor = originalCursor
    focus = element.getBoundingClientRect()
    const selection = window.getSelection()
    const anchor = selection && !selection.isCollapsed && selection.rangeCount ? buildTextRangeAnchor(selection.getRangeAt(0), {
      getSelector, url: location.href, viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
      isExcluded: (node) => node.closest('[data-fw]') !== null,
    }) : null
    const point = anchor ? toPagePercent(anchor.midpointClient.x + scrollX, anchor.midpointClient.y + scrollY) : toPagePercent(event.pageX, event.pageY)
    send({ kind: 'target', target: { selector: anchor?.anchor.containerSelector ?? getSelector(element), ...point, url: location.href,
      ...(anchor ? { targetType: 'text_range', anchor: anchor.anchor } : {}) } })
    frame.focus({ preventScroll: true })
  }
  const key = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || (event.target as HTMLElement).closest?.('input,textarea,select,[contenteditable="true"]')) return
    send({ kind: 'key', key: event.key, shiftKey: event.shiftKey })
  }
  const activation = () => send({ kind: 'activate' })
  const focusPage = () => send({ kind: 'focus' })
  document.addEventListener('mousemove', move); window.addEventListener('click', click, true)
  window.addEventListener('keydown', key); window.addEventListener('crrt:activate', activation)
  window.addEventListener('focus', focusPage)
  const timer = window.setInterval(update, 300)
  return () => { stop(); highlight(null); document.body.style.cursor = originalCursor; window.clearInterval(timer)
    document.removeEventListener('mousemove', move); window.removeEventListener('click', click, true)
    window.removeEventListener('keydown', key); window.removeEventListener('crrt:activate', activation); window.removeEventListener('focus', focusPage) }
}

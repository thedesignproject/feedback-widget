import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const channel = vi.hoisted(() => ({ receive: vi.fn(), send: vi.fn(), stop: vi.fn(), widget: vi.fn() }))
vi.mock('./frame-channel', () => ({ receiveFrameMessages: channel.receive, sendFrameMessage: channel.send }))
import { usePrivateFrame, frameBounds } from './private-frame'
function PrivateFrame() {
  const value = usePrivateFrame()
  if (!value.page) return null
  channel.widget(value)
  return <div data-fw-crrt />
}
const state = { kind: 'state', url: 'https://site.test/page?q=1', width: 1000, height: 2000, scrollX: 0, scrollY: 0, liveIds: [], activate: true }
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); channel.receive.mockReturnValue(channel.stop); channel.send.mockResolvedValue(state) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })
const props = () => channel.widget.mock.calls[channel.widget.mock.calls.length - 1][0]
it('keeps private UI in the frame while exchanging only page interactions through the extension channel', async () => {
  const view = render(<PrivateFrame />); await act(async () => {})
  expect(props()).toMatchObject({ activate: true, page: { url: state.url } })
  const receive = channel.receive.mock.calls[0][0]
  await act(async () => { receive({ kind: 'target', target: { selector: '#target', x: 10, y: 20, url: state.url } }, 0) })
  expect(props().page.target.selector).toBe('#target')
  await act(async () => { receive({ ...state, scrollY: 50 }, 0) })
  expect(props().page.target.selector).toBe('#target')
  await act(async () => { receive({ ...state, url: 'https://site.test/next' }, 0) })
  expect(props().page.target).toBeUndefined()
  await act(async () => { receive({ ...state, url: 'untrusted' }, 9) })
  expect(props().page.url).toBe('https://site.test/next')
  const spy = vi.spyOn(window, 'dispatchEvent'), outside = vi.spyOn(document.body, 'dispatchEvent')
  for (const kind of ['activate', 'focus', 'key', 'outside', 'unknown']) receive({ kind, key: 'c', shiftKey: true }, 0)
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'crrt:activate' }))
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'focus' }))
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'keydown', key: 'c' }))
  expect(outside).toHaveBeenCalledWith(expect.objectContaining({ type: 'pointerdown' }))
  props().page.selecting(true); props().page.track([{ id: '1', selector: '#target' }]); props().page.highlight('#target'); props().page.hide()
  expect(channel.send).toHaveBeenCalledWith(0, { kind: 'highlight', selector: '#target' })
  expect(channel.send).toHaveBeenCalledWith(0, { kind: 'deactivate' })
  channel.send.mockResolvedValueOnce(null)
  expect(await props().page.capture()).toBeNull()
  channel.send.mockResolvedValueOnce('data:image/png;base64,eA==')
  const blob = new Blob(['x']); vi.spyOn(globalThis, 'fetch').mockResolvedValue({ blob: async () => blob } as Response)
  expect(await props().page.capture()).toBe(blob)
  channel.send.mockRejectedValueOnce(new Error('capture interrupted'))
  expect(await props().page.capture()).toBeNull()
  channel.send.mockRejectedValueOnce(new Error('detached')); props().page.selecting(false)
  await act(async () => { vi.advanceTimersByTime(200) })
  expect(channel.send).toHaveBeenCalledWith(0, { kind: 'layout', rects: [] })
  fireEvent.mouseMove(document.body, { clientX: 200, clientY: 300 })
  expect(channel.send).toHaveBeenLastCalledWith(0, { kind: 'pointer', x: 200, y: 300 })
  channel.send.mockClear(); fireEvent.mouseMove(view.container.firstChild!)
  expect(channel.send).not.toHaveBeenCalled()
  view.unmount(); expect(channel.stop).toHaveBeenCalled()
})
it('ignores readiness after unmount and tolerates a restricted or detached host', async () => {
  let resolve!: (value: unknown) => void
  channel.send.mockReturnValueOnce(new Promise((done) => { resolve = done }))
  const view = render(<PrivateFrame />)
  await act(async () => { channel.receive.mock.calls[0][0]({ kind: 'target', target: {} }, 0) })
  view.unmount(); await act(async () => resolve(state))
  expect(channel.widget).not.toHaveBeenCalled()
  channel.send.mockRejectedValueOnce(new Error('restricted'))
  render(<PrivateFrame />); await act(async () => {})
  expect(channel.widget).not.toHaveBeenCalled()
})
it('publishes only visible interactive rectangles, including launcher popovers and clipped edges', () => {
  const root = document.createElement('div'); root.dataset.fwCrrt = ''; document.body.append(root)
  function element(styles: string, rect: Partial<DOMRect> = {}) {
    const node = document.createElement('div'); node.style.cssText = styles; root.append(node)
    vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, right: 110, bottom: 70, width: 100, height: 50, ...rect } as DOMRect)
    return node
  }
  element('position:fixed')
  element('position:absolute', { left: -10, top: -10, right: 20, bottom: 20 })
  element('position:relative'); element('position:fixed;pointer-events:none', { width: innerWidth, height: innerHeight })
  for (const style of ['display:none', 'visibility:hidden', 'opacity:0']) element(`position:fixed;${style}`)
  element('position:fixed', { width: 0 }); element('position:fixed', { height: 0 })
  element('position:fixed', { left: 99999 }); element('position:fixed', { top: 99999 })
  expect(frameBounds()).toEqual([[2, 12, 116, 66], [0, 0, 28, 28]])
  expect(frameBounds(128)).toEqual([[0, 0, 238, 198], [0, 0, 148, 148]])
  root.remove()
})

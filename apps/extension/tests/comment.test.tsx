import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const storage = vi.hoisted(() => ({ addListener: vi.fn(), removeListener: vi.fn() }))
const sendMessage = vi.hoisted(() => vi.fn())
vi.mock('wxt/browser', () => ({ browser: { storage: { onChanged: storage }, runtime: { sendMessage, getURL: (path: string) => `chrome-extension://test${path}` } } }))
vi.mock('../lib/page-host', () => ({ connectPageHost: vi.fn(() => vi.fn()) }))
vi.mock('wxt', () => ({ defineConfig: (config: unknown) => config }))
vi.mock('wxt/utils/define-unlisted-script', () => ({ defineUnlistedScript: (main: unknown) => main }))
vi.mock('../lib/comments-api', () => ({ extensionSession: vi.fn(), createPageComment: vi.fn(), deletePageComment: vi.fn(), listPageComments: vi.fn(), updatePageComment: vi.fn() }))
vi.mock('../../../src/lib/screenshotCapture', () => ({
  useScreenshotCapture: () => {
    const [image, setImage] = useState<Blob | null>(null)
    return { image, previewUrl: image ? 'blob:preview' : null, status: image ? 'ready' : 'idle',
      capture: () => setImage(new Blob(['image'])), clear: () => setImage(null),
      toBase64: async () => image ? { base64: 'eA==', mimeType: 'image/png' } : null }
  },
}))

import script, { mountWidget } from '../entrypoints/comment'
import { connectPageHost } from '../lib/page-host'
import { ExtensionWidget, personalComments } from '../lib/personal-widget'
import autoload from '../entrypoints/autoload.content'
import config from '../wxt.config'
import { createPageComment, deletePageComment, extensionSession, listPageComments, updatePageComment, type ExtensionComment } from '../lib/comments-api'
import type { WidgetPage } from '../../../src/components/FeedbackWidget/types'
import { FeedbackWidget } from '../../../src/components/FeedbackWidget'

const comment: ExtensionComment = { id: 'c1', pageUrl: location.href.split('#')[0], pageHostname: 'localhost', x: 10, y: 20, selector: '#target', body: 'First', screenshotUrl: 'https://signed/one', createdAt: '2026-09-03', updatedAt: '2026-09-03' }
let target: HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  sendMessage.mockResolvedValue({ ok: true })
  vi.mocked(extensionSession).mockResolvedValue({ email: 'user@example.com', accessToken: 'token' })
  vi.mocked(listPageComments).mockResolvedValue({ items: [comment], total: 1 })
  vi.mocked(createPageComment).mockResolvedValue({ ...comment, id: 'new', body: 'New' })
  vi.mocked(updatePageComment).mockResolvedValue(comment); vi.mocked(deletePageComment).mockResolvedValue()
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Public widget endpoints must not be used'))
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 100, height: 40 } as DOMRect)
  target = document.createElement('article'); target.id = 'target'; target.textContent = 'Page target'; document.body.append(target)
})
afterEach(() => { cleanup(); target.remove(); document.querySelector('[data-crrt-extension]')?.remove(); vi.restoreAllMocks(); vi.useRealTimers() })

function setup(activate = false, page?: WidgetPage) {
  const host = document.createElement('div'); host.dataset.crrtExtension = 'true'; host.dataset.fw = ''; document.body.append(host)
  const shadow = host.attachShadow({ mode: 'closed' })
  const container = document.createElement('div'); shadow.append(container)
  const view = render(<ExtensionWidget activate={activate} page={page} />, { container })
  return { ...view, host, shadow, ui: within(container) }
}

async function selectTarget(view: ReturnType<typeof setup>) {
  fireEvent.click(view.ui.getByRole('button', { name: 'Open CRRT menu' }))
  const drop = await view.ui.findByRole('menuitem', { name: /Drop comment/ })
  fireEvent.pointerDown(drop, { bubbles: true, composed: true })
  expect(view.ui.getByRole('menuitem', { name: /Drop comment/ })).toBe(drop)
  fireEvent.click(drop)
  fireEvent.mouseMove(target)
  expect(target.style.outlineWidth).toBe('2px')
  fireEvent.mouseMove(view.host); expect(target.style.outline).toBe('')
  fireEvent.mouseMove(target)
  fireEvent.click(target, { clientX: 30, clientY: 40 })
  return view.ui.findByPlaceholderText('Leave your comment…')
}

it('mounts the actual idle widget, highlights selection, and sends through the private adapter', async () => {
  const view = setup()
  await waitFor(() => expect(listPageComments).toHaveBeenCalledWith(location.href.split('#')[0], 1))
  expect(view.ui.getByRole('button', { name: 'Open CRRT menu' }).parentElement?.parentElement).toHaveStyle({ right: '24px', top: '50%' })
  fireEvent.click(target); expect(view.ui.queryByPlaceholderText('Leave your comment…')).toBeNull()
  const textarea = await selectTarget(view)
  const avatar = view.ui.getByTitle('Signed in as user@example.com')
  expect(avatar).toHaveTextContent('U')
  expect(avatar.style.background).toBe('var(--fw-surface-raised)')
  expect(avatar.style.color).toBe('var(--fw-foreground)')
  expect(target.style.outline).toBe('')
  fireEvent.keyDown(textarea, { key: 'f', bubbles: true, composed: true })
  expect(view.ui.getByRole('button', { name: 'Open CRRT menu' }).parentElement?.parentElement).toHaveStyle({ opacity: '1' })
  expect(view.ui.queryByRole('button', { name: 'Close sidebar' })).toBeNull()
  fireEvent.change(textarea, { target: { value: 'New' } })
  fireEvent.click(view.container.querySelector('button[title]')!) // personal identity never opens the name editor
  fireEvent.click(view.ui.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(createPageComment).toHaveBeenCalledWith(expect.objectContaining({ body: 'New', screenshot: { base64: 'eA==', mimeType: 'image/png' } })))
  expect(globalThis.fetch).not.toHaveBeenCalled()
  expect(sendMessage).not.toHaveBeenCalled()
  fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent.keyDown(window, { key: 'A', shiftKey: true })
  expect(view.ui.queryByText('Open agent')).toBeNull()
})

it('preserves a draft and screenshot when tokens refresh for the same account', async () => {
  const view = setup()
  await act(async () => {})
  const textarea = await selectTarget(view)
  fireEvent.change(textarea, { target: { value: 'Do not lose this draft' } })
  vi.mocked(extensionSession).mockResolvedValue({ email: 'user@example.com', accessToken: 'refreshed-token' })
  await act(async () => { storage.addListener.mock.calls[0][0]() })
  expect(view.ui.getByPlaceholderText('Leave your comment…')).toBe(textarea)
  expect(textarea).toHaveValue('Do not lose this draft')
  expect(view.ui.getByRole('button', { name: 'Remove screenshot' })).toBeInTheDocument()
  expect(view.ui.getByTitle('Signed in as user@example.com')).toHaveTextContent('U')
  vi.mocked(extensionSession).mockRejectedValueOnce(new Error('refresh offline'))
  await act(async () => { storage.addListener.mock.calls[0][0]() })
  expect(textarea).toHaveValue('Do not lose this draft')
})

it('uses the current account email initial without asking for a display name', async () => {
  vi.mocked(extensionSession).mockResolvedValue({ email: 'admin@crrt.local', accessToken: 'token' })
  const view = setup()
  await view.ui.findByRole('button', { name: 'Open CRRT menu' })
  await selectTarget(view)
  expect(view.ui.getByTitle('Signed in as admin@crrt.local')).toHaveTextContent('A')
  fireEvent.click(view.ui.getByTitle('Signed in as admin@crrt.local'))
  expect(view.ui.queryByPlaceholderText('Your name')).toBeNull()
})

it('ignores stale account refreshes and failures after unmount, and handles initial auth failure', async () => {
  let resolve!: (session: any) => void, reject!: (error: Error) => void
  vi.mocked(extensionSession).mockReturnValueOnce(new Promise((done) => { resolve = done }))
  const view = setup()
  await act(async () => { storage.addListener.mock.calls[0][0]() })
  await act(async () => resolve(null))
  expect(view.ui.getByRole('button', { name: 'Open CRRT menu' })).toBeInTheDocument()
  vi.mocked(extensionSession).mockReturnValueOnce(new Promise((_, fail) => { reject = fail }))
  await act(async () => { storage.addListener.mock.calls[0][0](); storage.addListener.mock.calls[0][0]() })
  await act(async () => reject(new Error('stale failure')))
  vi.mocked(extensionSession).mockReturnValueOnce(new Promise((_, fail) => { reject = fail }))
  await act(async () => { storage.addListener.mock.calls[0][0]() })
  view.unmount(); await act(async () => reject(new Error('late failure')))
  vi.mocked(extensionSession).mockRejectedValueOnce(new Error('initial failure'))
  const another = setup(); await act(async () => {})
  expect(another.ui.getByRole('button', { name: 'Open CRRT menu' })).toBeInTheDocument()
})

it('does not renew private images for the regular project widget', async () => {
  const view = render(<FeedbackWidget projectId="project" />)
  await act(async () => { fireEvent.focus(window) })
  expect(listPageComments).not.toHaveBeenCalled()
  view.unmount()
})

it('uses host page geometry, targets, selectors and navigation in the isolated editor', async () => {
  const page: WidgetPage = { url: location.href.split('#')[0], width: 2000, height: 3000, scrollX: 10, scrollY: 20,
    liveIds: ['c1'], capture: vi.fn(), selecting: vi.fn(), track: vi.fn(), highlight: vi.fn(), hide: vi.fn() }
  const view = setup(false, page); await act(async () => {})
  const hide = view.ui.getByRole('button', { name: 'Hide CRRT on this tab' })
  expect(hide).toHaveStyle({ opacity: '0', pointerEvents: 'none' })
  fireEvent.mouseEnter(hide.parentElement!.parentElement!); expect(hide).toHaveStyle({ opacity: '1', pointerEvents: 'auto' })
  fireEvent.mouseLeave(hide.parentElement!.parentElement!); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 140)) })
  expect(hide).toHaveStyle({ opacity: '0' })
  fireEvent.focus(hide); expect(hide).toHaveStyle({ opacity: '1' })
  fireEvent.mouseEnter(hide); expect(hide).toHaveStyle({ color: '#FFFFFF' })
  fireEvent.mouseLeave(hide); expect(hide).toHaveStyle({ color: 'rgba(255, 255, 255, 0.78)' })
  fireEvent.click(hide); expect(page.hide).toHaveBeenCalledOnce()
  fireEvent.blur(hide); fireEvent.mouseLeave(hide.parentElement!.parentElement!)
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 140)) })
  expect(hide).toHaveStyle({ opacity: '0' })
  const pin = view.container.querySelector('[data-fw-pin]')!
  expect(pin).toHaveStyle({ left: '190px', top: '569px' })
  expect(page.track).toHaveBeenCalledWith([{ id: 'c1', selector: '#target' }])
  fireEvent.click(pin)
  fireEvent.click(view.container.querySelector('[data-fw-pin-backdrop]')!)
  await act(async () => { fireEvent.keyDown(window, { key: 'c' }) })
  expect(page.selecting).toHaveBeenCalledWith(true)
  fireEvent.mouseMove(target); fireEvent.click(target)
  expect(target.style.outline).toBe('')
  expect(view.ui.queryByPlaceholderText('Leave your comment…')).toBeNull()
  view.rerender(<ExtensionWidget activate={false} page={{ ...page, target: { selector: '#target', x: 1, y: 2, url: page.url } }} />)
  await view.ui.findByPlaceholderText('Leave your comment…')
  fireEvent.keyDown(window, { key: 'Escape' }); fireEvent.keyDown(window, { key: 'f' })
  fireEvent.click(view.ui.getByText('First'))
  expect(page.highlight).toHaveBeenCalledWith('#target')
  view.rerender(<ExtensionWidget activate={false} page={{ ...page, url: 'https://site.test/next', liveIds: [] }} />)
  await waitFor(() => expect(listPageComments).toHaveBeenCalledWith('https://site.test/next', 1))
  expect(view.container.querySelector('[data-fw-pin]')).toBeNull()
})

it('renews private pin images without resetting edits and ignores offline or late refreshes', async () => {
  vi.useFakeTimers()
  const view = setup(); await act(async () => {})
  fireEvent.click(view.container.querySelector('[data-fw-pin]')!)
  fireEvent.click(view.ui.getByRole('button', { name: 'More options' }))
  fireEvent.click(view.ui.getByRole('button', { name: 'Edit' }))
  const editor = view.ui.getAllByRole('textbox')[0]
  fireEvent.change(editor, { target: { value: 'Unsaved edit' } })
  vi.mocked(listPageComments).mockResolvedValueOnce({ items: [{ ...comment, screenshotUrl: 'https://signed/fresh' }], total: 1 })
  await act(async () => { vi.advanceTimersByTime(240_000) })
  expect(editor).toHaveValue('Unsaved edit')
  expect(view.container.querySelector('img[src="https://signed/fresh"]')).not.toBeNull()
  vi.mocked(listPageComments).mockResolvedValueOnce({ items: [], total: 0 })
  await act(async () => fireEvent.focus(window))
  vi.mocked(listPageComments).mockRejectedValueOnce(new Error('offline'))
  await act(async () => fireEvent.focus(window))
  let resolve!: (value: any) => void
  vi.mocked(listPageComments).mockReturnValueOnce(new Promise((done) => { resolve = done }))
  await act(async () => { fireEvent.focus(window); fireEvent.focus(window) })
  await act(async () => resolve({ items: [], total: 0 }))
  vi.mocked(listPageComments).mockReturnValueOnce(new Promise((done) => { resolve = done }))
  fireEvent.focus(window); view.unmount()
  await act(async () => resolve({ items: [], total: 0 }))
})

it('opens extension sign-in from the logged-out carrot and restores the menu after login', async () => {
  vi.mocked(extensionSession).mockResolvedValue(null)
  const view = setup()
  await act(async () => {})
  expect(sendMessage).not.toHaveBeenCalled()
  expect(listPageComments).not.toHaveBeenCalled()
  fireEvent.click(view.ui.getByRole('button', { name: 'Open CRRT menu' }))
  await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'auth:open-popup' }))
  expect(view.ui.getByRole('button', { name: 'Open CRRT menu' })).toHaveAttribute('aria-expanded', 'false')
  expect(view.ui.queryByRole('menuitem', { name: /Drop comment/ })).toBeNull()
  expect(view.ui.queryByPlaceholderText('Leave your comment…')).toBeNull()
  vi.mocked(extensionSession).mockResolvedValue({ email: 'user@example.com', accessToken: 'token' })
  await act(async () => { storage.addListener.mock.calls[0][0]() })
  fireEvent.click(view.ui.getByRole('button', { name: 'Open CRRT menu' }))
  await view.ui.findByRole('button', { name: 'Close CRRT menu' })
  expect(sendMessage).toHaveBeenCalledTimes(1)
  expect(globalThis.fetch).not.toHaveBeenCalled()
})

it('keeps the launcher closed and shows retry guidance when popup or auth fails', async () => {
  vi.mocked(extensionSession).mockResolvedValue(null)
  const view = setup()
  await act(async () => {})
  for (const response of [{ ok: false, error: 'not supported' }, undefined]) {
    sendMessage.mockResolvedValueOnce(response)
    await act(async () => { fireEvent.click(view.ui.getByRole('button', { name: 'Open CRRT menu' })) })
    expect(view.ui.getByRole('alert')).toHaveTextContent('Click CRRT in Chrome’s toolbar to sign in.')
    fireEvent.click(view.ui.getByRole('button', { name: 'Dismiss error' }))
  }
  for (const reason of [new Error('Auth unavailable'), 'offline']) {
    vi.mocked(extensionSession).mockRejectedValueOnce(reason)
    await act(async () => { fireEvent.click(view.ui.getByRole('button', { name: 'Open CRRT menu' })) })
    expect(view.ui.getByRole('alert')).toHaveTextContent(reason instanceof Error ? reason.message : 'Could not open CRRT')
    fireEvent.click(view.ui.getByRole('button', { name: 'Dismiss error' }))
  }
  expect(view.ui.getByRole('button', { name: 'Open CRRT menu' })).toHaveAttribute('aria-expanded', 'false')
})

it('persists edits/deletes and leaves failed mutations visible for retry', async () => {
  const view = setup(); await waitFor(() => expect(view.container.querySelector('[data-fw-pin]')).not.toBeNull())
  fireEvent.click(view.container.querySelector('[data-fw-pin]')!)
  expect(view.ui.queryByRole('button', { name: 'Approve' })).toBeNull()
  fireEvent.click(view.ui.getByRole('button', { name: 'More options' }))
  fireEvent.click(view.ui.getByRole('button', { name: 'Edit' }))
  const editor = view.ui.getAllByRole('textbox')[0]
  fireEvent.change(editor, { target: { value: 'Updated' } })
  vi.mocked(updatePageComment).mockRejectedValueOnce(new Error('edit down'))
  fireEvent.click(view.ui.getAllByRole('button', { name: 'Save' })[0])
  await view.ui.findByText('edit down')
  fireEvent.click(view.ui.getByRole('button', { name: 'Dismiss error' }))
  fireEvent.click(view.ui.getAllByRole('button', { name: 'Save' })[0])
  await waitFor(() => expect(view.ui.queryAllByRole('textbox')).toHaveLength(0))
  expect(updatePageComment).toHaveBeenLastCalledWith('c1', 'Updated')
  fireEvent.click(view.ui.getByRole('button', { name: 'More options' }))
  vi.mocked(deletePageComment).mockRejectedValueOnce(new Error('delete down'))
  fireEvent.click(view.ui.getByRole('button', { name: 'Delete' }))
  await view.ui.findByText('delete down')
  expect(view.container.querySelector('[data-fw-pin]')).not.toBeNull()
  fireEvent.keyDown(window, { key: 'f' })
  fireEvent.click(view.ui.getByRole('button', { name: 'More' }))
  expect(view.ui.queryByRole('button', { name: 'Approve' })).toBeNull()
  fireEvent.click(view.ui.getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(view.container.querySelector('[data-fw-pin]')).toBeNull())
  expect(deletePageComment).toHaveBeenCalledWith('c1')
  expect(globalThis.fetch).not.toHaveBeenCalled()
})

it('shows load and submit errors; clearing auth removes private pins', async () => {
  vi.mocked(listPageComments).mockRejectedValueOnce(new Error('load down'))
  const view = setup(); await view.ui.findByText('load down')
  const textarea = await selectTarget(view)
  fireEvent.click(view.ui.getByRole('button', { name: 'Remove screenshot' }))
  fireEvent.change(textarea, { target: { value: 'New' } })
  vi.mocked(createPageComment).mockRejectedValueOnce('offline')
  fireEvent.click(view.ui.getByRole('button', { name: 'Send' })); await view.ui.findByText('Could not save comment')
  vi.mocked(createPageComment).mockRejectedValueOnce(new Error('Sign in from the extension'))
  fireEvent.click(view.ui.getByRole('button', { name: 'Send' })); await view.ui.findByText('Sign in from the extension')
  expect(createPageComment).toHaveBeenLastCalledWith(expect.objectContaining({ screenshot: null }))
  vi.mocked(extensionSession).mockResolvedValue({ email: 'another@example.com', accessToken: 'other' })
  await act(async () => { storage.addListener.mock.calls[0][0]() })
  await waitFor(() => expect(view.container.querySelector('[data-fw-pin]')).not.toBeNull())
  vi.mocked(extensionSession).mockResolvedValue(null)
  await act(async () => { storage.addListener.mock.calls[0][0]() })
  expect(view.container.querySelector('[data-fw-pin]')).toBeNull()
  expect(view.ui.queryByRole('textbox')).toBeNull()
  view.unmount(); expect(storage.removeListener).toHaveBeenCalled()
})

it('paginates personal pins, preserves text anchors, and refreshes on SPA navigation', async () => {
  const anchor = { kind: 'text_range', selectedText: 'quote' } as const
  vi.mocked(listPageComments).mockResolvedValueOnce({ items: [comment], total: 2 }).mockResolvedValueOnce({ items: [{ ...comment, id: 'c2' }], total: 2 })
  expect(await personalComments.list(location.href)).toHaveLength(2)
  expect(listPageComments).toHaveBeenLastCalledWith(location.href, 2)
  vi.mocked(listPageComments).mockResolvedValueOnce({ items: [], total: 2 })
  expect(await personalComments.list(location.href)).toEqual([])
  await personalComments.create({ pageUrl: location.href, body: 'quote', selector: '#target', x: 1, y: 2, targetType: 'text_range', anchor })
  expect(createPageComment).toHaveBeenLastCalledWith(expect.objectContaining({ targetType: 'text_range', anchor, screenshot: null }))
  const view = setup(true)
  await waitFor(() => expect(listPageComments).toHaveBeenCalled())
  const original = location.href
  history.pushState({}, '', '/next?query=retained#fragment')
  await waitFor(() => expect(listPageComments).toHaveBeenCalledWith(location.href.split('#')[0], 1))
  view.unmount(); history.replaceState({}, '', original)
})

it('ignores a late load failure after the widget unmounts', async () => {
  let reject!: (error: Error) => void
  vi.mocked(listPageComments).mockReturnValueOnce(new Promise((_, fail) => { reject = fail }))
  const view = setup(); await waitFor(() => expect(listPageComments).toHaveBeenCalled())
  view.unmount()
  await act(async () => { reject(new Error('late failure')) })
  expect(view.container).toBeEmptyDOMElement()
})

it('autoloads only in an activated tab, avoids duplicate widgets, and supports popup activation', async () => {
  expect(autoload.matches).toEqual(['http://*/*', 'https://*/*'])
  expect(config.manifest).toMatchObject({ host_permissions: ['http://*/*', 'https://*/*'] })
  expect((config.vite as () => unknown)()).toEqual({ build: { assetsInlineLimit: Infinity } })
  const icons = { 16: 'icon.png', 32: 'icon.png', 48: 'icon.png', 128: 'icon.png' }
  expect(config.manifest).toMatchObject({ icons, action: { default_icon: icons } })
  const assets: { absoluteSrc: string; relativeDest: string }[] = []
  const hooks = config.hooks as { 'build:publicAssets': (wxt: { config: { root: string } }, files: typeof assets) => void }
  hooks['build:publicAssets']({ config: { root: resolve('apps/extension') } }, assets)
  expect(assets).toHaveLength(1)
  expect(assets[0].relativeDest).toBe('icon.png')
  expect(readFileSync(assets[0].absoluteSrc)).toEqual(readFileSync('branding/design-system-crrt/Frame 11.png'))
  const spy = vi.spyOn(window, 'dispatchEvent')
  const attach = vi.spyOn(Element.prototype, 'attachShadow')
  sendMessage.mockResolvedValueOnce({ ok: true, data: false })
  await act(async () => { await autoload.main({} as never) })
  expect(document.querySelector('[data-crrt-extension]')).toBeNull()
  sendMessage.mockResolvedValueOnce({ ok: true, data: true })
  await act(async () => { await autoload.main({} as never) })
  const host = document.querySelector('[data-crrt-extension]')!
  expect(attach).toHaveBeenCalledWith({ mode: 'closed' })
  expect(attach.mock.results[0].value.querySelector('[data-fw-crrt]')).toBeNull()
  expect(attach.mock.results[0].value.querySelector('iframe')).toHaveAttribute('src', 'chrome-extension://test/private.html')
  const frame = attach.mock.results[0].value.querySelector('iframe') as HTMLIFrameElement
  expect(frame).toHaveAttribute('allow', 'microphone')
  const page = new DOMParser().parseFromString(readFileSync('apps/extension/entrypoints/private/index.html', 'utf8'), 'text/html')
  expect(frame.style.colorScheme).toBe('light')
  expect(page.documentElement.style.colorScheme).toBe(frame.style.colorScheme)
  expect(frame.style.background).toBe('transparent')
  expect(page.documentElement.style.background).toBe('transparent')
  expect(page.body.style.background).toBe('transparent')
  expect(host.shadowRoot).toBeNull()
  mountWidget(); expect(document.querySelectorAll('[data-crrt-extension]')).toHaveLength(1)
  expect(spy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'crrt:activate' }))
  await act(async () => { (script as unknown as () => void)() })
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'crrt:activate' }))
  const deactivate = vi.mocked(connectPageHost).mock.calls[0][2]
  deactivate(); deactivate()
  expect(document.querySelector('[data-crrt-extension]')).toBeNull()
  expect(sendMessage).toHaveBeenCalledWith({ type: 'comment:deactivate' })
})

it('keeps private text, signed images, and mutation controls inaccessible to page DOM scripts', async () => {
  const view = setup()
  await waitFor(() => expect(view.container.querySelector('[data-fw-pin]')).not.toBeNull())
  fireEvent.click(view.container.querySelector('[data-fw-pin]')!)
  expect(view.ui.getAllByText('First').length).toBeGreaterThan(0)
  expect(view.container.querySelector('img[src="https://signed/one"]')).not.toBeNull()
  // Test code holds the root directly; the visited page has only the shared host.
  expect(view.host.shadowRoot).toBeNull()
  expect(view.host.textContent).toBe('')
  expect(document.querySelector('[data-crrt-extension] button')).toBeNull()
  expect(document.querySelector('img[src="https://signed/one"]')).toBeNull()
  fireEvent.click(view.host)
  expect(deletePageComment).not.toHaveBeenCalled()
  expect(updatePageComment).not.toHaveBeenCalled()
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  listener: undefined as ((message: unknown, sender: unknown, respond: (response: unknown) => void) => boolean) | undefined,
  removed: undefined as ((tabId: number) => void) | undefined,
  session: {} as Record<string, unknown>,
}))
const browser = vi.hoisted(() => ({
  action: { openPopup: vi.fn() },
  tabs: {
    query: vi.fn(),
    onRemoved: { addListener: vi.fn((value) => { state.removed = value }) },
  },
  storage: { session: {
    get: vi.fn(async (key: string) => ({ [key]: state.session[key] })),
    set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(state.session, values) }),
    remove: vi.fn(async (key: string) => { delete state.session[key] }),
  } },
  scripting: { executeScript: vi.fn() },
  runtime: { onMessage: { addListener: vi.fn((value) => { state.listener = value }) } },
}))
vi.mock('wxt/browser', () => ({ browser }))
vi.mock('wxt/utils/define-background', () => ({ defineBackground: vi.fn((main) => main) }))
vi.mock('../lib/auth', () => ({ createExtensionSupabase: vi.fn(() => 'client'), handleAuthMessage: vi.fn(), isAuthMessage: vi.fn() }))
vi.mock('../lib/frame-channel', () => ({ relayFrameMessage: vi.fn() }))

import background, { activateCurrentTab } from '../entrypoints/background'
import { handleAuthMessage, isAuthMessage } from '../lib/auth'
import { relayFrameMessage } from '../lib/frame-channel'

beforeEach(() => { vi.clearAllMocks(); state.listener = undefined; state.removed = undefined; state.session = {} })

function send(message: unknown, sender: unknown = {}) {
  return new Promise((resolve) => {
    // Simulate Chrome's callback contract, not native Promise listener support.
    expect(state.listener!(message, sender, resolve)).toBe(true)
  })
}

describe('extension background', () => {
  it('relays private frame messages with their browser-provided sender', async () => {
    ;(background as unknown as () => void)()
    vi.mocked(relayFrameMessage).mockResolvedValueOnce('reply')
    await expect(send({ type: 'private:relay' })).resolves.toEqual({ ok: true, data: 'reply' })
    expect(relayFrameMessage).toHaveBeenCalledWith({ type: 'private:relay' }, {})
  })
  it('opens the existing action popup and reports browser failures', async () => {
    ;(background as unknown as () => void)()
    vi.mocked(isAuthMessage).mockReturnValue(false)
    browser.action.openPopup.mockResolvedValueOnce(undefined)
    await expect(send({ type: 'auth:open-popup' })).resolves.toEqual({ ok: true })
    expect(browser.action.openPopup).toHaveBeenCalledOnce()
    expect(browser.scripting.executeScript).not.toHaveBeenCalled()
    browser.action.openPopup.mockRejectedValueOnce(new Error('Popup unavailable'))
    await expect(send({ type: 'auth:open-popup' })).resolves.toEqual({ ok: false, error: 'Popup unavailable' })
  })

  it('activates regular pages using temporary tab access', async () => {
    browser.tabs.query.mockResolvedValue([{ id: 7, url: 'https://example.com' }])
    await activateCurrentTab()
    expect(browser.storage.session.set).toHaveBeenCalledWith({ 'crrt:active-tab:7': true })
    expect(browser.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ['comment.js'] })
  })

  it('exposes activation only to the browser-provided tab and clears closed tabs', async () => {
    ;(background as unknown as () => void)()
    vi.mocked(isAuthMessage).mockReturnValue(false)
    state.session['crrt:active-tab:7'] = true
    await expect(send({ type: 'comment:is-active' }, { tab: { id: 7 } })).resolves.toEqual({ ok: true, data: true })
    await expect(send({ type: 'comment:is-active' }, { tab: { id: 8 } })).resolves.toEqual({ ok: true, data: false })
    await expect(send({ type: 'comment:is-active' }, {})).resolves.toEqual({ ok: true, data: false })
    state.removed!(7)
    await vi.waitFor(() => expect(browser.storage.session.remove).toHaveBeenCalledWith('crrt:active-tab:7'))
  })

  it('deactivates only the tab identified by Chrome', async () => {
    ;(background as unknown as () => void)()
    vi.mocked(isAuthMessage).mockReturnValue(false)
    state.session['crrt:active-tab:7'] = true
    state.session['crrt:active-tab:8'] = true
    await expect(send({ type: 'comment:deactivate' }, { tab: { id: 7 } })).resolves.toEqual({ ok: true })
    expect(state.session).toEqual({ 'crrt:active-tab:8': true })
    await expect(send({ type: 'comment:deactivate' }, {})).resolves.toEqual({ ok: false, error: 'Tab activation unavailable' })
  })

  it('rolls back activation when injection fails', async () => {
    browser.tabs.query.mockResolvedValue([{ id: 7, url: 'https://example.com' }])
    browser.scripting.executeScript.mockRejectedValueOnce(new Error('restricted'))
    await expect(activateCurrentTab()).rejects.toThrow('restricted')
    expect(browser.storage.session.remove).toHaveBeenCalledWith('crrt:active-tab:7')
  })

  it('rejects missing, internal, and malformed tabs', async () => {
    for (const tabs of [[], [{ id: 0, url: 'https://example.com' }], [{ id: 1, url: 'chrome://settings' }], [{ id: 1 }]]) {
      browser.tabs.query.mockResolvedValueOnce(tabs)
      await expect(activateCurrentTab()).rejects.toThrow(/regular web page/)
    }
  })

  it('routes auth, activation, unknown messages, and failures', async () => {
    ;(background as unknown as () => void)()
    vi.mocked(isAuthMessage).mockReturnValueOnce(true)
    vi.mocked(handleAuthMessage).mockResolvedValueOnce({ email: 'u@example.com', accessToken: 't' })
    await expect(send({ type: 'auth:get' })).resolves.toMatchObject({ ok: true })

    vi.mocked(isAuthMessage).mockReturnValue(false)
    browser.tabs.query.mockResolvedValue([{ id: 7, url: 'http://example.com' }])
    await expect(send({ type: 'comment:activate' })).resolves.toEqual({ ok: true })
    await expect(send({ type: 'unknown' })).resolves.toBeUndefined()
    await expect(send(null)).resolves.toBeUndefined()

    vi.mocked(isAuthMessage).mockReturnValueOnce(true); vi.mocked(handleAuthMessage).mockRejectedValueOnce(new Error('down'))
    await expect(send({ type: 'auth:get' })).resolves.toEqual({ ok: false, error: 'down' })
    vi.mocked(isAuthMessage).mockImplementationOnce(() => { throw 'bad' })
    await expect(send({ type: 'auth:get' })).resolves.toEqual({ ok: false, error: 'Unexpected extension error' })
  })
})

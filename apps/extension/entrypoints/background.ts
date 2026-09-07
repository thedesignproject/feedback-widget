import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'
import { createExtensionSupabase, handleAuthMessage, isAuthMessage } from '../lib/auth'
import { relayFrameMessage } from '../lib/frame-channel'

type MessageResponse = { ok: true; data?: unknown } | { ok: false; error: string }
const activeTabKey = (tabId: number) => `crrt:active-tab:${tabId}`

async function currentWebTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !/^https?:/.test(tab.url ?? '')) throw new Error('Open a regular web page to start commenting')
  return tab
}

export async function isTabActive(tabId: number) {
  const key = activeTabKey(tabId)
  const stored = await browser.storage.session.get(key)
  return stored[key] === true
}

export async function activateCurrentTab(): Promise<void> {
  const tab = await currentWebTab()
  const key = activeTabKey(tab.id!)
  await browser.storage.session.set({ [key]: true })
  try {
    await browser.scripting.executeScript({ target: { tabId: tab.id! }, files: ['comment.js'] })
  } catch (error) {
    await browser.storage.session.remove(key)
    throw error
  }
}

export default defineBackground(() => {
  const client = createExtensionSupabase()
  async function handleMessage(message: unknown, sender: unknown): Promise<MessageResponse | undefined> {
    try {
      if ((message as { type?: string } | null)?.type === 'private:relay') return { ok: true, data: await relayFrameMessage(message, sender) }
      if (isAuthMessage(message)) return { ok: true, data: await handleAuthMessage(client, message) }
      if ((message as { type?: unknown } | null)?.type === 'auth:open-popup') {
        await browser.action.openPopup()
        return { ok: true }
      }
      if ((message as { type?: unknown } | null)?.type === 'comment:activate') {
        await activateCurrentTab()
        return { ok: true }
      }
      if ((message as { type?: unknown } | null)?.type === 'comment:is-active') {
        const tabId = (sender as { tab?: { id?: number } } | null)?.tab?.id
        return { ok: true, data: typeof tabId === 'number' && await isTabActive(tabId) }
      }
      if ((message as { type?: unknown } | null)?.type === 'comment:deactivate') {
        const tabId = (sender as { tab?: { id?: number } } | null)?.tab?.id
        if (typeof tabId !== 'number') throw new Error('Tab activation unavailable')
        await browser.storage.session.remove(activeTabKey(tabId))
        return { ok: true }
      }
      return undefined
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Unexpected extension error' }
    }
  }
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    void handleMessage(message, sender).then(sendResponse)
    // Keep the channel open on Chrome versions without Promise listener support.
    return true
  })
  browser.tabs.onRemoved.addListener((tabId) => {
    void browser.storage.session.remove(activeTabKey(tabId))
  })
})

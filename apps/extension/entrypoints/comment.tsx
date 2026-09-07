import { browser } from 'wxt/browser'
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script'
import { connectPageHost } from '../lib/page-host'

export function mountWidget(activate = false) {
  if (document.querySelector('[data-crrt-extension]')) {
    if (activate) window.dispatchEvent(new CustomEvent('crrt:activate'))
    return
  }
  const host = document.createElement('div')
  host.dataset.crrtExtension = 'true'; host.dataset.fw = 'true'
  const frame = document.createElement('iframe')
  frame.title = 'CRRT private comments'
  frame.allow = 'microphone'
  // Match private.html's root scheme so Chrome keeps the embedded canvas transparent on dark sites.
  frame.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;background:transparent;z-index:2147483647;clip-path:inset(100%);color-scheme:light;'
  // The extension origin, not the shadow root, isolates typing and private image requests.
  frame.src = browser.runtime.getURL('/private.html')
  host.attachShadow({ mode: 'closed' }).append(frame)
  document.documentElement.append(host)
  let cleaned = false
  let disconnect = () => {}
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    disconnect()
    host.remove()
    window.removeEventListener('crrt:deactivate', deactivate)
  }
  const deactivate = () => {
    cleanup()
    void browser.runtime.sendMessage({ type: 'comment:deactivate' }).catch(() => {})
  }
  disconnect = connectPageHost(frame, activate, deactivate)
  window.addEventListener('crrt:deactivate', deactivate)
  window.addEventListener('pagehide', cleanup, { once: true })
}

export default defineUnlistedScript(() => mountWidget(true))

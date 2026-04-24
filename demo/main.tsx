import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

const legacyDocMatch = window.location.pathname.match(/^\/d\/([^/?#]+)/)
if (legacyDocMatch) {
  const search = new URLSearchParams(window.location.search)
  const token = search.get('token') ?? ''
  const next = new URLSearchParams({ fw_share: legacyDocMatch[1] })
  if (token) next.set('token', token)
  window.history.replaceState(null, '', `/?${next.toString()}`)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

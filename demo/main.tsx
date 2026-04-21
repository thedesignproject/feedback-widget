import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { DocView } from './DocView'

const isDocRoute = /^\/d\//.test(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDocRoute ? <DocView /> : <App />}
  </StrictMode>
)

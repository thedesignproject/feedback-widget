import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Unmount React trees between tests so state and window listeners don't leak.
// Without this, the widget's window click handler stacks across tests, a later
// dispatched click fires multiple handlers, and sidebars from prior tests
// remain visible in the DOM under query.
afterEach(() => {
  cleanup()
})

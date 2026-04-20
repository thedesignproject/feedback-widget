import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { FeedbackWidget } from '../components/FeedbackWidget'

interface FetchCall {
  url: string
  init?: RequestInit
}

function mockFetch(
  postResponder?: (init?: RequestInit) => Response | Promise<Response>,
) {
  const calls: FetchCall[] = []
  const impl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    if (init?.method === 'POST') {
      return postResponder
        ? postResponder(init)
        : new Response(JSON.stringify({ success: true }), { status: 200 })
    }
    if (init?.method === 'DELETE') {
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }
    return new Response('[]', { status: 200 })
  })
  vi.stubGlobal('fetch', impl)
  return calls
}

// Drive the widget into 'commenting' mode by:
//  1. Clicking the floating trigger button (idle → selecting).
//  2. Dispatching a click on a target node (selecting → commenting with target).
// Returns the textarea and the Send button for the caller to interact with.
async function enterCommentingMode() {
  // Clean up any target node left over from a previous test (render's auto-
  // cleanup removes the widget root, but not nodes we appended by hand).
  document.querySelectorAll('[data-test-target]').forEach((n) => n.remove())

  const targetNode = document.createElement('article')
  targetNode.setAttribute('data-test-target', '')
  document.body.appendChild(targetNode)

  // Wait until the widget's root is mounted before reaching for the trigger.
  const trigger = await waitFor(() => {
    const roots = document.querySelectorAll('[data-fw]')
    for (const root of roots) {
      const btn = root.querySelector<HTMLButtonElement>(':scope > button')
      if (btn) return btn
    }
    throw new Error('trigger button not found yet')
  })
  await act(async () => {
    fireEvent.click(trigger)
  })

  const evt = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    clientX: 120,
    clientY: 200,
  })
  await act(async () => {
    targetNode.dispatchEvent(evt)
  })

  const textarea = await waitFor(() => {
    const el = document.querySelector<HTMLTextAreaElement>('textarea')
    if (!el) throw new Error('textarea not mounted yet')
    return el
  })

  const sendButton = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent?.includes('Send'),
  ) as HTMLButtonElement | undefined
  if (!sendButton) throw new Error('Send button not found')

  return { textarea, sendButton, targetNode }
}

describe('<FeedbackWidget />', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fetches existing comments for the configured projectId on mount', async () => {
    const calls = mockFetch()
    render(<FeedbackWidget projectId="my-site" apiBase="https://x.example/api" />)

    await waitFor(() => {
      const getCall = calls.find((c) => !c.init || c.init.method === undefined)
      expect(getCall?.url).toBe('https://x.example/api/comments?projectId=my-site')
    })
  })

  it('URL-encodes projectId with special characters', async () => {
    const calls = mockFetch()
    render(<FeedbackWidget projectId="acme/internal" apiBase="https://x.example/api" />)

    await waitFor(() => {
      expect(calls[0]?.url).toBe('https://x.example/api/comments?projectId=acme%2Finternal')
    })
  })

  it('renders a widget-scoped DOM root with the data-fw marker', () => {
    mockFetch()
    render(<FeedbackWidget projectId="p" apiBase="https://x.example/api" />)
    const roots = document.querySelectorAll('[data-fw]')
    expect(roots.length).toBeGreaterThan(0)
  })

  it('does not crash when the GET endpoint is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    // Should mount cleanly even if the API is offline — sidebar just stays empty.
    expect(() =>
      render(<FeedbackWidget projectId="p" apiBase="https://x.example/api" />),
    ).not.toThrow()
  })

  it('rerenders and refetches when projectId changes', async () => {
    const calls = mockFetch()
    const { rerender } = render(
      <FeedbackWidget projectId="first" apiBase="https://x.example/api" />,
    )
    await waitFor(() => expect(calls.some((c) => c.url.includes('projectId=first'))).toBe(true))

    rerender(<FeedbackWidget projectId="second" apiBase="https://x.example/api" />)
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('projectId=second'))).toBe(true),
    )
  })

  describe('submit flow', () => {
    it('POSTs the comment with projectId + url + selector and shows it in the sidebar', async () => {
      const calls = mockFetch()
      render(<FeedbackWidget projectId="proj" apiBase="https://x.example/api" />)

      const { textarea, sendButton } = await enterCommentingMode()
      fireEvent.change(textarea, { target: { value: 'bug here' } })
      fireEvent.click(sendButton)

      await waitFor(() => {
        const post = calls.find((c) => c.init?.method === 'POST')
        expect(post).toBeDefined()
        expect(post?.url).toBe('https://x.example/api/comments')
        const body = JSON.parse(String(post?.init?.body))
        expect(body.projectId).toBe('proj')
        expect(body.comment).toBe('bug here')
        expect(typeof body.element).toBe('string')
        expect(body.element.length).toBeGreaterThan(0)
      })

      await waitFor(() => {
        expect(document.body.textContent).toContain('bug here')
      })
    })

    it('duplicate Send clicks in the same tick produce exactly one POST', async () => {
      const calls = mockFetch(
        () =>
          new Promise<Response>((resolve) =>
            setTimeout(
              () =>
                resolve(new Response(JSON.stringify({ success: true }), { status: 200 })),
              30,
            ),
          ),
      )
      render(<FeedbackWidget projectId="proj" apiBase="https://x.example/api" />)

      const { textarea, sendButton } = await enterCommentingMode()
      fireEvent.change(textarea, { target: { value: 'rapid' } })

      fireEvent.click(sendButton)
      fireEvent.click(sendButton)
      fireEvent.click(sendButton)

      await waitFor(() => {
        const posts = calls.filter((c) => c.init?.method === 'POST')
        expect(posts.length).toBe(1)
      })
    })

    it('a failed POST does not add a ghost comment to the sidebar', async () => {
      const calls = mockFetch(
        () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }),
      )
      render(<FeedbackWidget projectId="proj" apiBase="https://x.example/api" />)
      // Suppress the component's warn-log for the expected failure.
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const { textarea, sendButton } = await enterCommentingMode()
      fireEvent.change(textarea, { target: { value: 'should not appear' } })
      fireEvent.click(sendButton)

      await waitFor(() => {
        const posts = calls.filter((c) => c.init?.method === 'POST')
        expect(posts.length).toBe(1)
      })

      // Give React a tick to flush any state updates.
      await new Promise((r) => setTimeout(r, 20))

      // The textarea still holds the typed draft (the widget only clears on
      // success). The assertion we care about: the sidebar comment list does
      // NOT contain an entry with that text.
      const sidebarRows = Array.from(
        document.querySelectorAll<HTMLDivElement>('div[style*="border-radius: 8px"]'),
      ).filter((el) => el.style.borderLeftColor === 'rgb(59, 130, 246)')
      const hasGhost = sidebarRows.some((el) =>
        el.textContent?.includes('should not appear'),
      )
      expect(hasGhost).toBe(false)

      // Sanity: widget surfaced the failure via console.warn.
      expect(console.warn).toHaveBeenCalled()
    })
  })
})

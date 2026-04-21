import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { FeedbackWidget } from '../components/FeedbackWidget'

interface FetchCall {
  url: string
  init?: RequestInit
}

function mockFetch(responders?: {
  publicResponder?: (init?: RequestInit) => Response | Promise<Response>
  legacyResponder?: (init?: RequestInit) => Response | Promise<Response>
}) {
  const calls: FetchCall[] = []
  const impl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const parsedUrl = String(url)
    calls.push({ url: parsedUrl, init })

    if (parsedUrl.endsWith('/v1/public/comments')) {
      return responders?.publicResponder
        ? responders.publicResponder(init)
        : new Response(JSON.stringify({ id: '1' }), { status: 201 })
    }

    if (parsedUrl.endsWith('/comments')) {
      return responders?.legacyResponder
        ? responders.legacyResponder(init)
        : new Response(JSON.stringify({ success: true }), { status: 200 })
    }

    return new Response('{}', { status: 404 })
  })

  vi.stubGlobal('fetch', impl)
  return calls
}

async function enterCommentingMode() {
  document.querySelectorAll('[data-test-target]').forEach((node) => node.remove())
  const targetNode = document.createElement('article')
  targetNode.setAttribute('data-test-target', '')
  targetNode.textContent = 'Target'
  document.body.appendChild(targetNode)

  await act(async () => {
    fireEvent.click(await waitFor(() => {
      const button = document.querySelector('button[data-fw]')
      if (!button) throw new Error('feedback trigger not found')
      return button
    }))
  })

  await act(async () => {
    targetNode.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 120,
    }))
  })

  const textarea = await waitFor(() => {
    const field = document.querySelector<HTMLTextAreaElement>('textarea')
    if (!field) throw new Error('textarea not found')
    return field
  })

  const getSendButton = () => {
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="Send"]')
    if (!button) throw new Error('send button not found')
    return button
  }

  return { textarea, getSendButton }
}

describe('<FeedbackWidget />', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not fetch comments on mount', () => {
    const calls = mockFetch()
    render(<FeedbackWidget projectId="proj" apiBase="https://x.example/api" />)
    expect(calls).toHaveLength(0)
  })

  it('POSTs feedback to the new public endpoint', async () => {
    const calls = mockFetch()
    render(<FeedbackWidget projectId="proj" apiBase="https://x.example/api" />)

    const { textarea, getSendButton } = await enterCommentingMode()
    fireEvent.change(textarea, { target: { value: 'new public feedback' } })
    fireEvent.click(getSendButton())

    await waitFor(() => {
      expect(calls.some((call) => call.url === 'https://x.example/api/v1/public/comments')).toBe(true)
    })

    const post = calls.find((call) => call.url.endsWith('/v1/public/comments'))
    expect(post).toBeDefined()
    const body = JSON.parse(String(post?.init?.body))
    expect(body.projectKey).toBe('proj')
    expect(body.body).toBe('new public feedback')
    expect(body.pageUrl).toBe(window.location.href)
    expect(typeof body.selector).toBe('string')
  })

  it('prefers explicit projectKey when provided', async () => {
    const calls = mockFetch()
    render(<FeedbackWidget projectId="legacy-id" projectKey="pub_123" apiBase="https://x.example/api" />)

    const { textarea, getSendButton } = await enterCommentingMode()
    fireEvent.change(textarea, { target: { value: 'uses project key' } })
    fireEvent.click(getSendButton())

    await waitFor(() => {
      const post = calls.find((call) => call.url.endsWith('/v1/public/comments'))
      expect(post).toBeDefined()
      const body = JSON.parse(String(post?.init?.body))
      expect(body.projectKey).toBe('pub_123')
    })
  })

  it('falls back to the legacy endpoint when the new route is unavailable', async () => {
    const calls = mockFetch({
      publicResponder: () => new Response(JSON.stringify({ error: 'missing' }), { status: 404 }),
    })
    render(<FeedbackWidget projectId="proj" apiBase="https://x.example/api" />)

    const { textarea, getSendButton } = await enterCommentingMode()
    fireEvent.change(textarea, { target: { value: 'legacy fallback' } })
    fireEvent.click(getSendButton())

    await waitFor(() => {
      expect(calls.some((call) => call.url === 'https://x.example/api/comments')).toBe(true)
    })

    const legacyPost = calls.find((call) => call.url === 'https://x.example/api/comments')
    const body = JSON.parse(String(legacyPost?.init?.body))
    expect(body.projectId).toBe('proj')
    expect(body.comment).toBe('legacy fallback')
  })

  it('guards against duplicate sends in the same tick', async () => {
    const calls = mockFetch({
      publicResponder: () =>
        new Promise<Response>((resolve) =>
          setTimeout(() => resolve(new Response(JSON.stringify({ id: '1' }), { status: 201 })), 30),
        ),
    })
    render(<FeedbackWidget projectId="proj" apiBase="https://x.example/api" />)

    const { textarea, getSendButton } = await enterCommentingMode()
    fireEvent.change(textarea, { target: { value: 'rapid fire' } })

    const sendButton = getSendButton()
    fireEvent.click(sendButton)
    fireEvent.click(sendButton)
    fireEvent.click(sendButton)

    await waitFor(() => {
      const posts = calls.filter((call) => call.url.endsWith('/v1/public/comments'))
      expect(posts).toHaveLength(1)
    })
  })
})

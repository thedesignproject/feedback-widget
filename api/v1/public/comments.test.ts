import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../_lib/store.js', () => ({
  getProject: vi.fn(),
  createPublicComment: vi.fn(),
  listComments: vi.fn(),
  updateReviewStatus: vi.fn(),
}))

import { createPublicComment, getProject, listComments, updateReviewStatus } from '../../_lib/store.js'
import handler from './comments.js'

interface MockRes {
  statusCode: number
  body: unknown
  headers: Record<string, string>
  status(code: number): MockRes
  json(data: unknown): MockRes
  end(): MockRes
  setHeader(key: string, value: string): void
}

function mockReq(overrides: Record<string, unknown> = {}) {
  return { method: 'POST', query: {}, body: {}, headers: {}, ...overrides }
}

function mockRes(): MockRes {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code
      return this
    },
    json(data) {
      this.body = data
      return this
    },
    end() {
      return this
    },
    setHeader(key, value) {
      this.headers[key] = value
    },
  }
}

const call = (req: unknown, res: unknown) =>
  (handler as unknown as (req: unknown, res: unknown) => Promise<unknown>)(req, res)

beforeEach(() => {
  vi.mocked(getProject).mockReset()
  vi.mocked(createPublicComment).mockReset()
  vi.mocked(listComments).mockReset()
  vi.mocked(updateReviewStatus).mockReset()
})

describe('api/v1/public/comments', () => {
  it('answers CORS preflight for cross-origin PATCH requests', async () => {
    const res = mockRes()
    await call(mockReq({
      method: 'OPTIONS',
      headers: {
        origin: 'https://client.example',
        'access-control-request-headers': 'content-type, x-client-version',
      },
    }), res)

    expect(res.statusCode).toBe(204)
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*')
    expect(res.headers['Access-Control-Allow-Methods']).toContain('PATCH')
    expect(res.headers['Access-Control-Allow-Headers']).toBe('content-type, x-client-version')
    expect(res.headers['Access-Control-Max-Age']).toBe('86400')
  })

  it('returns 400 when projectKey is missing on GET', async () => {
    const res = mockRes()
    await call(mockReq({ method: 'GET', query: {} }), res)
    expect(res.statusCode).toBe(400)
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*')
  })

  it('returns 404 when the project key is unknown', async () => {
    vi.mocked(getProject).mockResolvedValue(null)
    const res = mockRes()

    await call(mockReq({
      body: {
        projectKey: 'missing',
        pageUrl: 'https://example.com',
        selector: 'body',
        x: 10,
        y: 20,
        body: 'Hi',
      },
    }), res)

    expect(res.statusCode).toBe(404)
  })

  it('creates a public comment', async () => {
    vi.mocked(getProject).mockResolvedValue({
      publicKey: 'demo-project',
      slug: 'demo-project',
      name: 'Demo',
      createdAt: '',
      updatedAt: '',
    })
    vi.mocked(createPublicComment).mockResolvedValue({
      id: 'comment-1',
      projectId: 'demo-project',
      pageUrl: 'https://example.com',
      selector: 'body',
      x: 10,
      y: 20,
      body: 'Hello',
      reviewStatus: 'open',
      implementationStatus: 'unassigned',
      claimedByAgentId: null,
      imageUrl: null,
      authorName: null,
      createdAt: '',
      updatedAt: '',
    })

    const res = mockRes()
    await call(mockReq({
      headers: { origin: 'https://example.com' },
      body: {
        projectKey: 'demo-project',
        pageUrl: 'https://example.com',
        selector: 'body',
        x: 10,
        y: 20,
        body: 'Hello',
      },
    }), res)

    expect(res.statusCode).toBe(201)
    expect(createPublicComment).toHaveBeenCalledWith({
      projectKey: 'demo-project',
      pageUrl: 'https://example.com',
      selector: 'body',
      x: 10,
      y: 20,
      body: 'Hello',
      imageUrl: null,
      authorName: null,
    })
  })

  it('updates a comment review status for widget compatibility', async () => {
    vi.mocked(updateReviewStatus).mockResolvedValue({
      id: 'comment-1',
      projectId: 'demo-project',
      pageUrl: 'https://example.com',
      selector: 'body',
      x: 10,
      y: 20,
      body: 'Hello',
      reviewStatus: 'accepted',
      implementationStatus: 'unassigned',
      claimedByAgentId: null,
      imageUrl: null,
      authorName: null,
      createdAt: '',
      updatedAt: '',
    })

    const res = mockRes()
    await call(mockReq({
      method: 'PATCH',
      headers: { origin: 'https://example.com' },
      body: { id: 'comment-1', reviewStatus: 'accepted' },
    }), res)

    expect(updateReviewStatus).toHaveBeenCalledWith('comment-1', 'accepted')
    expect(res.statusCode).toBe(200)
    expect((res.body as Record<string, unknown>).reviewStatus).toBe('accepted')
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*')
  })
})

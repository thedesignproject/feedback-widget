import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../_lib/store', () => ({
  getProject: vi.fn(),
  createPublicComment: vi.fn(),
}))

import { createPublicComment, getProject } from '../../_lib/store'
import handler from './comments'

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
})

describe('api/v1/public/comments', () => {
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

  it('creates a public comment when the origin is allowed', async () => {
    vi.mocked(getProject).mockResolvedValue({
      publicKey: 'demo-project',
      slug: 'demo-project',
      name: 'Demo',
      allowedOrigins: ['https://example.com'],
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
    })
  })
})


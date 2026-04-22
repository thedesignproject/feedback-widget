import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockEq = vi.fn()
const mockOrder = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: mockSelect,
      insert: mockInsert,
    })),
  })),
}))

import handler from '../../../../api/v1/public/comments.js'

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
  mockSelect.mockReset()
  mockInsert.mockReset()
  mockEq.mockReset()
  mockOrder.mockReset()
})

describe('api/v1/public/comments', () => {
  it('returns 400 when projectKey is missing on GET', async () => {
    const res = mockRes()
    await call(mockReq({ method: 'GET', query: {} }), res)
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when required POST fields are missing', async () => {
    const res = mockRes()
    await call(mockReq({ body: { projectKey: 'p' } }), res)
    expect(res.statusCode).toBe(400)
  })

  it('inserts a comment and returns 201', async () => {
    const row = {
      id: 'comment-1',
      project_id: 'demo-project',
      url: 'https://example.com',
      element: 'body',
      x: 10,
      y: 20,
      comment: 'Hello',
      created_at: '2026-04-22T00:00:00Z',
    }
    mockInsert.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [row], error: null }),
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
    expect((res.body as Record<string, unknown>).projectId).toBe('demo-project')
    expect((res.body as Record<string, unknown>).body).toBe('Hello')
  })
})

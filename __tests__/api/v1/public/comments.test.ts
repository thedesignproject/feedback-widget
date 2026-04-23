import { beforeEach, describe, expect, it, vi } from 'vitest'

// Env vars must be set before handler import so getSupabase() doesn't throw
process.env.SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_KEY = 'test-key'

const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockEq = vi.fn()
const mockOrder = vi.fn()
const mockUpdateEq = vi.fn()
const mockUpdateSelect = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
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
  mockUpdate.mockReset()
  mockEq.mockReset()
  mockOrder.mockReset()
  mockUpdateEq.mockReset()
  mockUpdateSelect.mockReset()

  // Default chain for GET: from().select().eq().order()
  mockOrder.mockResolvedValue({ data: [], error: null })
  mockEq.mockReturnValue({ order: mockOrder })
  mockSelect.mockReturnValue({ eq: mockEq })

  // Default chain for PATCH: from().update().eq().select()
  mockUpdateSelect.mockResolvedValue({ data: [], error: null })
  mockUpdateEq.mockReturnValue({ select: mockUpdateSelect })
  mockUpdate.mockReturnValue({ eq: mockUpdateEq })
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
    expect((res.body as Record<string, unknown>).reviewStatus).toBe('open')
  })

  it('updates a comment review status', async () => {
    const row = {
      id: 'comment-1',
      project_id: 'demo-project',
      url: 'https://example.com',
      element: 'body',
      x: 10,
      y: 20,
      comment: 'Hello',
      status: 'approved',
      created_at: '2026-04-22T00:00:00Z',
    }
    mockUpdateSelect.mockResolvedValue({ data: [row], error: null })

    const res = mockRes()
    await call(mockReq({
      method: 'PATCH',
      headers: { origin: 'https://example.com' },
      body: { id: 'comment-1', reviewStatus: 'accepted' },
    }), res)

    expect(mockUpdate).toHaveBeenCalledWith({ status: 'approved' })
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'comment-1')
    expect(res.statusCode).toBe(200)
    expect((res.body as Record<string, unknown>).reviewStatus).toBe('accepted')
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*')
  })
})

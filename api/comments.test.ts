import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}))

import { createClient } from '@supabase/supabase-js'
import handler from './comments'

interface MockRes {
  statusCode: number
  body: unknown
  status(code: number): MockRes
  json(data: unknown): MockRes
  end(): MockRes
}

function mockReq(overrides: Record<string, unknown> = {}) {
  return { method: 'GET', query: {}, body: {}, ...overrides }
}

function mockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: null,
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
  }
  return res
}

const call = (req: unknown, res: unknown) =>
  (handler as unknown as (req: unknown, res: unknown) => Promise<unknown>)(req, res)

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_KEY = 'test-key'
  vi.mocked(createClient).mockReset()
})

describe('api/comments', () => {
  describe('dispatch', () => {
    it('returns 204 for OPTIONS', async () => {
      const res = mockRes()
      await call(mockReq({ method: 'OPTIONS' }), res)
      expect(res.statusCode).toBe(204)
    })

    it('returns 400 for PATCH without id', async () => {
      const res = mockRes()
      await call(mockReq({ method: 'PATCH', body: {} }), res)
      expect(res.statusCode).toBe(400)
      expect((res.body as { error: string }).error).toMatch(/id/i)
    })

    it('returns 500 when env vars missing', async () => {
      delete process.env.SUPABASE_URL
      const res = mockRes()
      await call(mockReq({ method: 'GET', query: { projectId: 'x' } }), res)
      expect(res.statusCode).toBe(500)
      expect((res.body as { error: string }).error).toMatch(/misconfigured/)
    })
  })

  describe('GET', () => {
    it('returns 400 without projectId', async () => {
      const res = mockRes()
      await call(mockReq({ method: 'GET', query: {} }), res)
      expect(res.statusCode).toBe(400)
    })

    it('returns rows for valid projectId', async () => {
      vi.mocked(createClient).mockReturnValue({
        from: () => ({
          select: () => ({
            eq: () => ({
              order: () =>
                Promise.resolve({ data: [{ id: '1', project_id: 'x' }], error: null }),
            }),
          }),
        }),
      } as never)
      const res = mockRes()
      await call(mockReq({ method: 'GET', query: { projectId: 'x' } }), res)
      expect(res.statusCode).toBe(200)
      expect(res.body).toEqual([{ id: '1', project_id: 'x' }])
    })
  })

  describe('POST', () => {
    const validBody = {
      projectId: 'x',
      url: 'u',
      element: 'e',
      comment: 'c',
      x: 10,
      y: 20,
    }

    it('returns 400 with missing required fields', async () => {
      const res = mockRes()
      await call(mockReq({ method: 'POST', body: { projectId: 'x' } }), res)
      expect(res.statusCode).toBe(400)
    })

    it('returns 400 when x is non-numeric', async () => {
      const res = mockRes()
      await call(
        mockReq({ method: 'POST', body: { ...validBody, x: 'nope' } }),
        res,
      )
      expect(res.statusCode).toBe(400)
      expect((res.body as { error: string }).error).toMatch(/finite/)
    })

    it('returns 400 when y is NaN', async () => {
      const res = mockRes()
      await call(mockReq({ method: 'POST', body: { ...validBody, y: NaN } }), res)
      expect(res.statusCode).toBe(400)
    })

    it('returns 200 on successful insert', async () => {
      vi.mocked(createClient).mockReturnValue({
        from: () => ({
          insert: () => ({
            select: () => Promise.resolve({ data: [{ id: '1' }], error: null }),
          }),
        }),
      } as never)
      const res = mockRes()
      await call(mockReq({ method: 'POST', body: validBody }), res)
      expect(res.statusCode).toBe(200)
      expect(res.body).toEqual({ success: true })
    })

    it('returns 500 when insert returns no row (silent RLS failure)', async () => {
      vi.mocked(createClient).mockReturnValue({
        from: () => ({
          insert: () => ({
            select: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      } as never)
      const res = mockRes()
      await call(mockReq({ method: 'POST', body: validBody }), res)
      expect(res.statusCode).toBe(500)
      expect((res.body as { error: string }).error).toMatch(/no row/)
    })

    it('returns 500 when supabase returns an error', async () => {
      vi.mocked(createClient).mockReturnValue({
        from: () => ({
          insert: () => ({
            select: () =>
              Promise.resolve({ data: null, error: { message: 'boom' } }),
          }),
        }),
      } as never)
      const res = mockRes()
      await call(mockReq({ method: 'POST', body: validBody }), res)
      expect(res.statusCode).toBe(500)
    })
  })

  describe('DELETE (smoke cleanup)', () => {
    beforeEach(() => {
      process.env.SMOKE_CLEANUP_TOKEN = 'secret-abc'
    })

    it('returns 501 when SMOKE_CLEANUP_TOKEN is not configured', async () => {
      delete process.env.SMOKE_CLEANUP_TOKEN
      const res = mockRes()
      await call(
        mockReq({
          method: 'DELETE',
          headers: { 'x-smoke-cleanup-token': 'secret-abc' },
          query: { projectId: 'smoke-x' },
        }),
        res,
      )
      expect(res.statusCode).toBe(501)
    })

    it('returns 401 when token header is missing', async () => {
      const res = mockRes()
      await call(
        mockReq({ method: 'DELETE', headers: {}, query: { projectId: 'smoke-x' } }),
        res,
      )
      expect(res.statusCode).toBe(401)
    })

    it('returns 401 when token header is wrong', async () => {
      const res = mockRes()
      await call(
        mockReq({
          method: 'DELETE',
          headers: { 'x-smoke-cleanup-token': 'nope' },
          query: { projectId: 'smoke-x' },
        }),
        res,
      )
      expect(res.statusCode).toBe(401)
    })

    it('returns 400 without projectId', async () => {
      const res = mockRes()
      await call(
        mockReq({
          method: 'DELETE',
          headers: { 'x-smoke-cleanup-token': 'secret-abc' },
          query: {},
        }),
        res,
      )
      expect(res.statusCode).toBe(400)
    })

    it('refuses to delete non-smoke projectIds', async () => {
      const res = mockRes()
      await call(
        mockReq({
          method: 'DELETE',
          headers: { 'x-smoke-cleanup-token': 'secret-abc' },
          query: { projectId: 'production-data' },
        }),
        res,
      )
      expect(res.statusCode).toBe(400)
      expect((res.body as { error: string }).error).toMatch(/smoke-\*/)
    })

    it('deletes smoke rows on valid request', async () => {
      const deleteMock = vi.fn(() => ({
        eq: () => Promise.resolve({ error: null }),
      }))
      vi.mocked(createClient).mockReturnValue({
        from: () => ({ delete: deleteMock }),
      } as never)
      const res = mockRes()
      await call(
        mockReq({
          method: 'DELETE',
          headers: { 'x-smoke-cleanup-token': 'secret-abc' },
          query: { projectId: 'smoke-1234' },
        }),
        res,
      )
      expect(res.statusCode).toBe(200)
      expect(deleteMock).toHaveBeenCalled()
    })

    it('returns 500 when supabase returns an error', async () => {
      vi.mocked(createClient).mockReturnValue({
        from: () => ({
          delete: () => ({
            eq: () => Promise.resolve({ error: { message: 'rls denied' } }),
          }),
        }),
      } as never)
      const res = mockRes()
      await call(
        mockReq({
          method: 'DELETE',
          headers: { 'x-smoke-cleanup-token': 'secret-abc' },
          query: { projectId: 'smoke-x' },
        }),
        res,
      )
      expect(res.statusCode).toBe(500)
    })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../_lib/auth.js', () => ({ requireProjectCommentCapability: vi.fn(), requireUser: vi.fn() }))
vi.mock('../../../_lib/external-work-sync.js', () => ({ closeLinkedExternalWork: vi.fn() }))
vi.mock('../../../_lib/store.js', () => ({ getComment: vi.fn(), listCommentExternalWork: vi.fn() }))

import handler from './external-work-sync.js'
import { requireProjectCommentCapability, requireUser } from '../../../_lib/auth.js'
import { closeLinkedExternalWork } from '../../../_lib/external-work-sync.js'
import { getComment, listCommentExternalWork } from '../../../_lib/store.js'

function response() {
  return {
    statusCode: 200, body: null as unknown, headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this },
    json(body: unknown) { this.body = body; return this },
    end() { return this },
    setHeader(key: string, value: string) { this.headers[key] = value },
  }
}
const call = (req: unknown, res: unknown) => (handler as unknown as (req: unknown, res: unknown) => Promise<unknown>)(req, res)

const work = {
  provider: 'linear', state: 'created', externalId: 'issue', externalKey: 'WEB-7', externalUrl: 'https://linear.app/issue/WEB-7',
  lifecycleStatus: 'closed', syncAction: null, closedAt: 'later', createdAt: 'now', updatedAt: 'later', leaseToken: 'private',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireUser).mockResolvedValue({ userId: 'u', email: 'u@example.com' })
  vi.mocked(getComment).mockResolvedValue({
    id: 'comment', projectId: 'project', reviewStatus: 'rejected', updatedAt: 'rejected-version',
  } as never)
  vi.mocked(requireProjectCommentCapability).mockResolvedValue({ role: 'member' })
  vi.mocked(listCommentExternalWork).mockResolvedValue([work, { ...work, state: 'creating', externalId: null }] as never)
})

describe('external work close retry API', () => {
  it('validates method, authentication, and identifiers', async () => {
    let res = response()
    await call({ method: 'OPTIONS', query: {}, headers: {} }, res)
    expect(res.statusCode).toBe(204)
    res = response()
    await call({ method: 'GET', query: {}, headers: {} }, res)
    expect(res.statusCode).toBe(405)
    vi.mocked(requireUser).mockResolvedValueOnce(null)
    res = response()
    await call({ method: 'POST', query: {}, headers: {} }, res)
    expect(res.body).toBeNull()
    res = response()
    await call({ method: 'POST', query: {}, headers: {} }, res)
    expect(res.statusCode).toBe(400)
  })

  it('requires a manageable rejected comment', async () => {
    vi.mocked(getComment).mockResolvedValueOnce(null)
    let res = response()
    await call({ method: 'POST', query: { commentId: 'comment' }, headers: {} }, res)
    expect(res.statusCode).toBe(404)

    vi.mocked(requireProjectCommentCapability).mockResolvedValueOnce(null)
    res = response()
    await call({ method: 'POST', query: { commentId: 'comment' }, headers: {} }, res)
    expect(closeLinkedExternalWork).not.toHaveBeenCalled()

    vi.mocked(getComment).mockResolvedValueOnce({ id: 'comment', projectId: 'project', reviewStatus: 'accepted' } as never)
    res = response()
    await call({ method: 'POST', query: { commentId: 'comment' }, headers: {} }, res)
    expect(res.statusCode).toBe(409)
  })

  it('retries all providers and returns only safe completed creation records', async () => {
    const res = response()
    await call({ method: 'POST', query: { commentId: 'comment' }, headers: {} }, res)
    expect(closeLinkedExternalWork).toHaveBeenCalledWith('project', 'comment', 'rejected-version')
    expect(res.body).toEqual({ externalWork: [{
      provider: 'linear', externalId: 'issue', externalKey: 'WEB-7', externalUrl: 'https://linear.app/issue/WEB-7',
      lifecycleStatus: 'closed', syncAction: null, closedAt: 'later', createdAt: 'now', updatedAt: 'later',
    }] })
    expect(JSON.stringify(res.body)).not.toContain('private')
  })

  it('returns operation failures without leaking provider or opaque values', async () => {
    vi.mocked(closeLinkedExternalWork).mockRejectedValueOnce(new Error('sync failed'))
    let res = response()
    await call({ method: 'POST', query: { commentId: 'comment' }, headers: {} }, res)
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'External work synchronization failed' })

    vi.mocked(getComment).mockRejectedValueOnce('opaque')
    res = response()
    await call({ method: 'POST', query: { commentId: 'comment' }, headers: {} }, res)
    expect(res.body).toEqual({ error: 'External work synchronization failed' })
  })
})

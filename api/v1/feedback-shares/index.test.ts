import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../_lib/auth.js', () => ({
  requireReviewer: vi.fn(() => true),
}))

vi.mock('../../_lib/store.js', () => ({
  addShareItems: vi.fn(),
  createFeedbackEvent: vi.fn(),
  createShare: vi.fn(),
  listAcceptedCommentsByIds: vi.fn(),
  listAcceptedCommentsForPage: vi.fn(),
}))

vi.mock('../../_lib/tokens.js', () => ({
  encryptToken: vi.fn(() => 'cipher'),
  generateAccessToken: vi.fn(() => 'token-123'),
  generateSlug: vi.fn(() => 'slug1234'),
  hashToken: vi.fn(() => 'hash123'),
}))

import handler from './index.js'
import {
  addShareItems,
  createFeedbackEvent,
  createShare,
  listAcceptedCommentsByIds,
  listAcceptedCommentsForPage,
} from '../../_lib/store.js'

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
  process.env.APP_URL = 'https://app.example'
  vi.mocked(listAcceptedCommentsForPage).mockReset()
  vi.mocked(listAcceptedCommentsByIds).mockReset()
  vi.mocked(createShare).mockReset()
  vi.mocked(addShareItems).mockReset()
  vi.mocked(createFeedbackEvent).mockReset()
})

describe('api/v1/feedback-shares', () => {
  it('creates a page-scoped share from accepted comments', async () => {
    vi.mocked(listAcceptedCommentsForPage).mockResolvedValue([
      { id: 'comment-1' },
      { id: 'comment-2' },
    ] as never)
    vi.mocked(createShare).mockResolvedValue({
      id: 'share-1',
      slug: 'slug1234',
      expiresAt: '2026-04-28T12:00:00.000Z',
    } as never)

    const res = mockRes()
    await call(mockReq({
      body: {
        projectId: 'demo-project',
        scopeType: 'page',
        pageUrl: 'https://example.com/pricing',
      },
    }), res)

    expect(res.statusCode).toBe(201)
    expect(createShare).toHaveBeenCalled()
    expect(addShareItems).toHaveBeenCalledWith('share-1', ['comment-1', 'comment-2'])
    expect(res.body).toMatchObject({
      shareId: 'share-1',
      slug: 'slug1234',
      token: 'token-123',
      tokenUrl: 'https://app.example/api/v1/agent/shares/slug1234/state?token=token-123',
    })
  })
})


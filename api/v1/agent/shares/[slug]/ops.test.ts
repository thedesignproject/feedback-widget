import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../_lib/shares.js', () => ({
  requireAgentShare: vi.fn(async () => ({
    share: {
      id: 'share-1',
      slug: 'slug1234',
      projectId: 'demo-project',
    },
    token: 'token-123',
  })),
}))

vi.mock('../../../../_lib/store.js', () => ({
  createFeedbackEvent: vi.fn(async () => ({ id: 91 })),
  getComment: vi.fn(async () => ({
    id: 'comment-1',
    claimedByAgentId: null,
  })),
  getOperationKey: vi.fn(async () => null),
  saveOperationKey: vi.fn(async () => undefined),
  shareContainsComment: vi.fn(async () => true),
  updateImplementationStatus: vi.fn(async () => ({
    id: 'comment-1',
    implementationStatus: 'done',
    claimedByAgentId: 'codex-local',
  })),
}))

import handler from './ops.js'
import {
  createFeedbackEvent,
  saveOperationKey,
  updateImplementationStatus,
} from '../../../../_lib/store.js'

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
  return {
    method: 'POST',
    query: { slug: 'slug1234' },
    body: {},
    headers: {
      authorization: 'Bearer token-123',
      'x-agent-id': 'codex-local',
      'idempotency-key': 'op-1',
    },
    ...overrides,
  }
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
  vi.mocked(updateImplementationStatus).mockClear()
  vi.mocked(createFeedbackEvent).mockClear()
  vi.mocked(saveOperationKey).mockClear()
})

describe('api/v1/agent/shares/[slug]/ops', () => {
  it('completes a comment and records the operation key', async () => {
    const res = mockRes()

    await call(mockReq({
      body: {
        op: 'comment.complete',
        commentId: 'comment-1',
        payload: {
          note: 'Shipped the CTA fix.',
        },
      },
    }), res)

    expect(res.statusCode).toBe(200)
    expect(updateImplementationStatus).toHaveBeenCalledWith('comment-1', {
      implementationStatus: 'done',
      claimedByAgentId: 'codex-local',
    })
    expect(createFeedbackEvent).toHaveBeenCalled()
    expect(saveOperationKey).toHaveBeenCalledWith('share-1', 'codex-local', 'op-1', 91)
  })
})


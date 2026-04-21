import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getAgentId, getStringQuery, handleOptions, jsonError, methodNotAllowed, setCors } from '../../../../_lib/http.js'
import { createFeedbackEvent, getComment, getOperationKey, saveOperationKey, shareContainsComment, updateImplementationStatus } from '../../../../_lib/store.js'
import { requireAgentShare } from '../../../../_lib/shares.js'
import type { ImplementationStatus } from '../../../../_lib/status.js'

type AgentOp = 'comment.claim' | 'comment.start' | 'comment.note' | 'comment.block' | 'comment.complete' | 'comment.reopen'

const VALID_OPS = new Set<AgentOp>([
  'comment.claim',
  'comment.start',
  'comment.note',
  'comment.block',
  'comment.complete',
  'comment.reopen',
])

function eventTypeForOp(op: AgentOp) {
  switch (op) {
    case 'comment.claim':
      return 'comment.claimed'
    case 'comment.start':
      return 'comment.started'
    case 'comment.note':
      return 'comment.noted'
    case 'comment.block':
      return 'comment.blocked'
    case 'comment.complete':
      return 'comment.completed'
    case 'comment.reopen':
      return 'comment.reopened'
  }
}

function patchForOp(op: AgentOp, agentId: string): { implementationStatus?: ImplementationStatus, claimedByAgentId?: string | null } | null {
  switch (op) {
    case 'comment.claim':
      return { implementationStatus: 'claimed', claimedByAgentId: agentId }
    case 'comment.start':
      return { implementationStatus: 'in_progress', claimedByAgentId: agentId }
    case 'comment.block':
      return { implementationStatus: 'blocked', claimedByAgentId: agentId }
    case 'comment.complete':
      return { implementationStatus: 'done', claimedByAgentId: agentId }
    case 'comment.reopen':
      return { implementationStatus: 'unassigned', claimedByAgentId: null }
    case 'comment.note':
      return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, ['POST', 'OPTIONS'])) return
  if (req.method !== 'POST') return methodNotAllowed(req, res, ['POST', 'OPTIONS'])

  try {
    const slug = getStringQuery(req.query.slug)
    if (!slug) return jsonError(req, res, 400, 'Missing slug')

    const authorized = await requireAgentShare(req, res, slug)
    if (!authorized) return

    const agentId = getAgentId(req)
    const idempotencyKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined
    const op = req.body?.op as AgentOp | undefined
    const commentId = req.body?.commentId as string | undefined
    const payload = typeof req.body?.payload === 'object' && req.body?.payload ? req.body.payload : {}

    if (!agentId) return jsonError(req, res, 400, 'Missing X-Agent-Id')
    if (!idempotencyKey) return jsonError(req, res, 400, 'Missing Idempotency-Key')
    if (!op || !VALID_OPS.has(op)) return jsonError(req, res, 400, 'Invalid op')
    if (!commentId) return jsonError(req, res, 400, 'Missing commentId')

    const existingKey = await getOperationKey(authorized.share.id, agentId, idempotencyKey)
    if (existingKey) {
      setCors(req, res, ['POST', 'OPTIONS'])
      return res.status(200).json({
        success: true,
        duplicate: true,
        feedbackEventId: existingKey.feedback_event_id,
      })
    }

    const inShare = await shareContainsComment(authorized.share, commentId)
    if (!inShare) return jsonError(req, res, 404, 'Comment not found in share')

    const comment = await getComment(commentId)
    if (!comment) return jsonError(req, res, 404, 'Comment not found')

    if (comment.claimedByAgentId && comment.claimedByAgentId !== agentId && op !== 'comment.reopen') {
      return jsonError(req, res, 409, 'Comment is claimed by another agent')
    }

    const patch = patchForOp(op, agentId)
    const updatedComment = patch
      ? await updateImplementationStatus(commentId, patch)
      : comment

    const feedbackEvent = await createFeedbackEvent({
      shareId: authorized.share.id,
      commentId,
      actorType: 'agent',
      actorId: agentId,
      eventType: eventTypeForOp(op),
      payload: {
        ...(payload as Record<string, unknown>),
        idempotencyKey,
      },
    })

    await saveOperationKey(authorized.share.id, agentId, idempotencyKey, feedbackEvent.id)

    setCors(req, res, ['POST', 'OPTIONS'])
    return res.status(200).json({
      success: true,
      feedbackEventId: feedbackEvent.id,
      comment: updatedComment,
    })
  } catch (error) {
    return jsonError(req, res, 500, error instanceof Error ? error.message : 'Unexpected error')
  }
}


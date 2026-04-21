import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireReviewer } from '../../../../lib/auth'
import { createFeedbackEvent, findActiveSharesForComment, updateReviewStatus } from '../../../../lib/store'
import { getStringQuery, handleOptions, jsonError, methodNotAllowed, setCors } from '../../../../lib/http'
import type { ReviewStatus } from '../../../../lib/status'

const VALID_STATUSES = new Set<ReviewStatus>(['open', 'accepted', 'rejected'])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, ['PATCH', 'OPTIONS'])) return
  if (req.method !== 'PATCH') return methodNotAllowed(req, res, ['PATCH', 'OPTIONS'])
  if (!requireReviewer(req, res)) return

  try {
    const commentId = getStringQuery(req.query.commentId)
    const reviewStatus = req.body?.reviewStatus as ReviewStatus | undefined

    if (!commentId) return jsonError(req, res, 400, 'Missing commentId')
    if (!reviewStatus || !VALID_STATUSES.has(reviewStatus)) {
      return jsonError(req, res, 400, 'reviewStatus must be open, accepted, or rejected')
    }

    const comment = await updateReviewStatus(commentId, reviewStatus)
    const activeShares = await findActiveSharesForComment(commentId)
    await Promise.all(activeShares.map((share) => createFeedbackEvent({
      shareId: share.id,
      commentId,
      actorType: 'reviewer',
      actorId: 'reviewer',
      eventType: 'comment.reviewed',
      payload: { reviewStatus },
    })))

    setCors(req, res, ['PATCH', 'OPTIONS'])
    return res.status(200).json(comment)
  } catch (error) {
    return jsonError(req, res, 500, error instanceof Error ? error.message : 'Unexpected error')
  }
}


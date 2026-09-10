import type { VercelRequest, VercelResponse } from '@vercel/node'
import { waitUntil } from '@vercel/functions'
import { requireProjectCommentCapability, requireUser } from '../../../_lib/auth.js'
import { createFeedbackEvent, findActiveSharesForComment, getComment, updateReviewStatus } from '../../../_lib/store.js'
import { getStringQuery, handleOptions, jsonError, methodNotAllowed, setCors } from '../../../_lib/http.js'
import type { ReviewStatus } from '../../../_lib/status.js'
import { closeLinkedGithubIssue } from '../../../_lib/external-work-sync.js'

const VALID_STATUSES = new Set<ReviewStatus>(['open', 'accepted', 'rejected'])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, ['PATCH', 'OPTIONS'])) return
  if (req.method !== 'PATCH') return methodNotAllowed(req, res, ['PATCH', 'OPTIONS'])
  const user = await requireUser(req, res)
  if (!user) return

  try {
    const commentId = getStringQuery(req.query.commentId)
    const reviewStatus = req.body?.reviewStatus as ReviewStatus | undefined

    if (!commentId) return jsonError(req, res, 400, 'Missing commentId')
    if (!reviewStatus || !VALID_STATUSES.has(reviewStatus)) {
      return jsonError(req, res, 400, 'reviewStatus must be open, accepted, or rejected')
    }

    const existing = await getComment(commentId)
    if (!existing || !existing.projectId) return jsonError(req, res, 404, 'Comment not found')
    if (!(await requireProjectCommentCapability(req, res, user, existing, 'feedback:manage'))) return

    const comment = await updateReviewStatus(existing.projectId, commentId, reviewStatus)
    if (reviewStatus === 'rejected') {
      waitUntil(closeLinkedGithubIssue(existing.projectId, commentId, comment.updatedAt).catch(() => undefined))
    }
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

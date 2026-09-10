import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireProjectCommentCapability, requireUser } from '../../../_lib/auth.js'
import { closeLinkedExternalWork } from '../../../_lib/external-work-sync.js'
import { getStringQuery, handleOptions, jsonError, methodNotAllowed, setCors } from '../../../_lib/http.js'
import { getComment, listCommentExternalWork } from '../../../_lib/store.js'

const METHODS = ['POST', 'OPTIONS']

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, METHODS)) return
  if (req.method !== 'POST') return methodNotAllowed(req, res, METHODS)
  const user = await requireUser(req, res)
  if (!user) return
  const commentId = getStringQuery(req.query.commentId)
  if (!commentId) return jsonError(req, res, 400, 'Missing commentId')

  try {
    const comment = await getComment(commentId)
    if (!comment?.projectId) return jsonError(req, res, 404, 'Comment not found')
    if (!(await requireProjectCommentCapability(req, res, user, comment, 'feedback:manage'))) return
    if (comment.reviewStatus !== 'rejected') return jsonError(req, res, 409, 'comment_not_rejected')

    await closeLinkedExternalWork(comment.projectId, commentId, comment.updatedAt)
    const work = await listCommentExternalWork(commentId)
    const externalWork = work.flatMap((item) => (
      item.state === 'created' && item.externalId && item.externalKey && item.externalUrl
        ? [{
            provider: item.provider,
            externalId: item.externalId,
            externalKey: item.externalKey,
            externalUrl: item.externalUrl,
            lifecycleStatus: item.lifecycleStatus,
            syncAction: item.syncAction,
            closedAt: item.closedAt,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          }]
        : []
    ))
    setCors(req, res, METHODS)
    return res.status(200).json({ externalWork })
  } catch {
    return jsonError(req, res, 500, 'External work synchronization failed')
  }
}

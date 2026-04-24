import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireReviewer } from '../../_lib/auth.js'
import { createFeedbackEvent, createShare, addShareItems, listAcceptedCommentsByIds, listAcceptedCommentsForPage } from '../../_lib/store.js'
import { generateAccessToken, generateSlug, hashToken, encryptToken } from '../../_lib/tokens.js'
import { getAppUrl, handleOptions, jsonError, methodNotAllowed, setCors } from '../../_lib/http.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, ['POST', 'OPTIONS'])) return
  if (req.method !== 'POST') return methodNotAllowed(req, res, ['POST', 'OPTIONS'])
  if (!requireReviewer(req, res)) return

  try {
    const { projectId, scopeType, pageUrl, commentIds } = req.body ?? {}
    if (!projectId || (scopeType !== 'page' && scopeType !== 'selection')) {
      return jsonError(req, res, 400, 'scopeType must be page or selection')
    }

    const comments = scopeType === 'page'
      ? await listAcceptedCommentsForPage(projectId, pageUrl)
      : await listAcceptedCommentsByIds(projectId, Array.isArray(commentIds) ? commentIds : [])

    if (scopeType === 'page' && !pageUrl) {
      return jsonError(req, res, 400, 'pageUrl is required for page-scoped shares')
    }

    if (comments.length === 0) {
      return jsonError(req, res, 400, 'No accepted comments matched this share request')
    }

    const token = generateAccessToken()
    const slug = generateSlug()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const share = await createShare({
      projectKey: projectId,
      scopeType,
      scopePageUrl: scopeType === 'page' ? pageUrl : null,
      slug,
      accessTokenHash: hashToken(token),
      accessTokenCiphertext: encryptToken(token),
      createdBy: 'reviewer',
      expiresAt,
    })

    await addShareItems(share.id, comments.map((comment) => comment.id))
    await createFeedbackEvent({
      shareId: share.id,
      actorType: 'reviewer',
      actorId: 'reviewer',
      eventType: 'share.created',
      payload: {
        scopeType,
        commentCount: comments.length,
      },
    })

    const tokenUrl = `${getAppUrl(req)}/api/v1/agent/shares/${share.slug}/state?token=${encodeURIComponent(token)}`

    setCors(req, res, ['POST', 'OPTIONS'])
    return res.status(201).json({
      shareId: share.id,
      slug: share.slug,
      token,
      tokenUrl,
      expiresAt,
      commentCount: comments.length,
    })
  } catch (error) {
    return jsonError(req, res, 500, error instanceof Error ? error.message : 'Unexpected error')
  }
}

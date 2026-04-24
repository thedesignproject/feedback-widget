import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireReviewer } from '../../../_lib/auth.js'
import { getAppUrl, handleOptions, jsonError, methodNotAllowed, setCors, getStringQuery } from '../../../_lib/http.js'
import { getProject, getRepoConfig, getShareById } from '../../../_lib/store.js'
import { buildPrompt } from '../../../_lib/prompts.js'
import { decryptToken } from '../../../_lib/tokens.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, ['GET', 'OPTIONS'])) return
  if (req.method !== 'GET') return methodNotAllowed(req, res, ['GET', 'OPTIONS'])
  if (!requireReviewer(req, res)) return

  try {
    const shareId = getStringQuery(req.query.shareId)
    const target = getStringQuery(req.query.target) || 'generic'
    if (!shareId) return jsonError(req, res, 400, 'Missing shareId')

    const share = await getShareById(shareId)
    if (!share) return jsonError(req, res, 404, 'Share not found')

    const project = await getProject(share.projectId)
    if (!project) return jsonError(req, res, 404, 'Project not found')

    const repoConfig = await getRepoConfig(share.projectId)
    const token = decryptToken(share.accessTokenCiphertext)
    const base = getAppUrl(req)
    const prompt = buildPrompt(target, {
      appUrl: base,
      slug: share.slug,
      token,
      pageUrl: share.scopePageUrl,
      projectKey: project.publicKey,
      projectName: project.name,
      repoConfig,
    })

    setCors(req, res, ['GET', 'OPTIONS'])
    return res.status(200).json({
      shareId: share.id,
      target,
      prompt,
      tokenUrl: `${base}/api/v1/agent/shares/${share.slug}/state?token=${encodeURIComponent(token)}`,
    })
  } catch (error) {
    return jsonError(req, res, 500, error instanceof Error ? error.message : 'Unexpected error')
  }
}

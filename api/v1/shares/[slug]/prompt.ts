import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getStringQuery, handleOptions, jsonError, methodNotAllowed, setCors } from '../../../_lib/http.js'
import { getProject, getRepoConfig } from '../../../_lib/store.js'
import { buildPrompt } from '../../../_lib/prompts.js'
import { requireAgentShare } from '../../../_lib/shares.js'

function appUrl() {
  return process.env.APP_URL || 'http://localhost:3000'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, ['GET', 'OPTIONS'])) return
  if (req.method !== 'GET') return methodNotAllowed(req, res, ['GET', 'OPTIONS'])

  try {
    const slug = getStringQuery(req.query.slug)
    if (!slug) return jsonError(req, res, 400, 'Missing slug')

    const authorized = await requireAgentShare(req, res, slug)
    if (!authorized) return

    const target = getStringQuery(req.query.target) || 'generic'
    const project = await getProject(authorized.share.projectId)
    if (!project) return jsonError(req, res, 404, 'Project not found')

    const repoConfig = await getRepoConfig(authorized.share.projectId)
    const base = appUrl()
    const prompt = buildPrompt(target, {
      appUrl: base,
      slug: authorized.share.slug,
      token: authorized.token,
      pageUrl: authorized.share.scopePageUrl,
      projectKey: project.publicKey,
      projectName: project.name,
      repoConfig,
    })

    setCors(req, res, ['GET', 'OPTIONS'])
    return res.status(200).json({
      slug: authorized.share.slug,
      target,
      prompt,
      docUrl: `${base}/?fw_share=${encodeURIComponent(authorized.share.slug)}&token=${encodeURIComponent(authorized.token)}`,
    })
  } catch (error) {
    return jsonError(req, res, 500, error instanceof Error ? error.message : 'Unexpected error')
  }
}

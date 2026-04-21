import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createPublicComment, getProject } from '../../../lib/store'
import { handleOptions, jsonError, methodNotAllowed, setCors } from '../../../lib/http'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, ['POST', 'OPTIONS'])) return
  if (req.method !== 'POST') return methodNotAllowed(req, res, ['POST', 'OPTIONS'])

  try {
    const { projectKey, projectId, pageUrl, selector, x, y, body } = req.body ?? {}
    const resolvedProjectKey = typeof projectKey === 'string' ? projectKey : projectId

    if (!resolvedProjectKey || !pageUrl || !selector || !body) {
      return jsonError(req, res, 400, 'Missing required fields: projectKey, pageUrl, selector, body')
    }

    if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
      return jsonError(req, res, 400, 'x and y must be finite numbers')
    }

    const project = await getProject(resolvedProjectKey)
    if (!project) {
      return jsonError(req, res, 404, 'Project not found')
    }

    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null
    const allowedOrigins = project.allowedOrigins || []
    if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes('*') && !allowedOrigins.includes(origin)) {
      return jsonError(req, res, 403, 'Origin not allowed for this project')
    }

    const comment = await createPublicComment({
      projectKey: resolvedProjectKey,
      pageUrl,
      selector,
      x,
      y,
      body,
    })

    setCors(req, res, ['POST', 'OPTIONS'])
    return res.status(201).json(comment)
  } catch (error) {
    return jsonError(req, res, 500, error instanceof Error ? error.message : 'Unexpected error')
  }
}


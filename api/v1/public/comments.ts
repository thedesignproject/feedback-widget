import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createPublicComment, getProject, listComments } from '../../_lib/store.js'
import { getStringQuery, handleOptions, isOriginAllowed, jsonError, methodNotAllowed, setCors } from '../../_lib/http.js'

const METHODS = ['GET', 'POST', 'OPTIONS']

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, METHODS)) return
  if (req.method === 'GET') return handleGet(req, res)
  if (req.method === 'POST') return handlePost(req, res)
  return methodNotAllowed(req, res, METHODS)
}

async function handleGet(req: VercelRequest, res: VercelResponse) {
  try {
    const projectKey = getStringQuery(req.query.projectKey)
    if (!projectKey) return jsonError(req, res, 400, 'Missing projectKey')

    const pageUrl = getStringQuery(req.query.pageUrl)
    const comments = await listComments(projectKey, pageUrl ? { pageUrl } : {})

    setCors(req, res, METHODS)
    return res.status(200).json(comments)
  } catch (error) {
    return jsonError(req, res, 500, error instanceof Error ? error.message : 'Unexpected error')
  }
}

async function handlePost(req: VercelRequest, res: VercelResponse) {
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

    if (!isOriginAllowed(req, project)) {
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

    setCors(req, res, METHODS)
    return res.status(201).json(comment)
  } catch (error) {
    return jsonError(req, res, 500, error instanceof Error ? error.message : 'Unexpected error')
  }
}

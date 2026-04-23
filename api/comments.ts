import type { VercelRequest, VercelResponse } from '@vercel/node'
import v1Handler from './v1/public/comments.js'

/**
 * Legacy proxy — old widget versions still call /api/comments.
 * Maps old field names to v1 format, forwards to the real handler,
 * then maps the response back to old field names.
 * Remove once all clients are on the new widget.
 */

function mapResponseToLegacy(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(mapResponseToLegacy)
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    return {
      id: d.id,
      project_id: d.projectId ?? d.project_id,
      url: d.pageUrl ?? d.url,
      x: d.x,
      y: d.y,
      element: d.selector ?? d.element,
      comment: d.body ?? d.comment,
      status: d.reviewStatus ?? d.status ?? 'pending',
      created_at: d.createdAt ?? d.created_at,
    }
  }
  return data
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Map request fields
  if (req.method === 'GET') {
    if (req.query.projectId && !req.query.projectKey) {
      req.query.projectKey = req.query.projectId
    }
  }

  if (req.method === 'POST') {
    const body = req.body ?? {}
    if (body.projectId && !body.projectKey) body.projectKey = body.projectId
    if (body.url && !body.pageUrl) body.pageUrl = body.url
    if (body.element && !body.selector) body.selector = body.element
    if (body.comment && !body.body) body.body = body.comment
    req.body = body
  }

  // Intercept response to map fields back to legacy format
  const origJson = res.json.bind(res)
  res.json = (data: unknown) => origJson(mapResponseToLegacy(data))

  return v1Handler(req, res)
}

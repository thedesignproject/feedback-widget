import type { VercelRequest, VercelResponse } from '@vercel/node'
import v1Handler from './v1/public/comments.js'

/**
 * Legacy proxy — old widget versions still call /api/comments.
 * Maps old field names to v1 format and forwards to the real handler.
 * Remove once all clients are on the new widget.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // GET: map ?projectId= to ?projectKey=
  if (req.method === 'GET') {
    if (req.query.projectId && !req.query.projectKey) {
      req.query.projectKey = req.query.projectId
    }
    return v1Handler(req, res)
  }

  // POST: map old field names to v1 format
  if (req.method === 'POST') {
    const body = req.body ?? {}
    if (body.projectId && !body.projectKey) body.projectKey = body.projectId
    if (body.url && !body.pageUrl) body.pageUrl = body.url
    if (body.element && !body.selector) body.selector = body.element
    if (body.comment && !body.body) body.body = body.comment
    req.body = body
    return v1Handler(req, res)
  }

  // OPTIONS, PATCH, DELETE — forward as-is
  return v1Handler(req, res)
}

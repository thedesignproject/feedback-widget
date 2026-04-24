import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getStringQuery, handleOptions, jsonError, methodNotAllowed, setCors } from '../../../../_lib/http.js'
import { listFeedbackEvents } from '../../../../_lib/store.js'
import { requireAgentShare } from '../../../../_lib/shares.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, ['GET', 'OPTIONS'])) return
  if (req.method !== 'GET') return methodNotAllowed(req, res, ['GET', 'OPTIONS'])

  try {
    const slug = getStringQuery(req.query.slug)
    if (!slug) return jsonError(req, res, 400, 'Missing slug')

    const authorized = await requireAgentShare(req, res, slug)
    if (!authorized) return

    const after = Number.parseInt(getStringQuery(req.query.after) || '0', 10)
    const requestedLimit = Number.parseInt(getStringQuery(req.query.limit) || '100', 10)
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, requestedLimit)) : 100
    const events = await listFeedbackEvents(authorized.share.id, Number.isFinite(after) ? after : 0, limit)

    setCors(req, res, ['GET', 'OPTIONS'])
    return res.status(200).json({
      events,
      nextCursor: events.length > 0 ? events[events.length - 1].id : after,
    })
  } catch (error) {
    return jsonError(req, res, 500, error instanceof Error ? error.message : 'Unexpected error')
  }
}


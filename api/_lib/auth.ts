import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getReviewerToken, jsonError } from './http'

export function requireReviewer(req: VercelRequest, res: VercelResponse) {
  const configured = process.env.REVIEWER_API_TOKEN
  if (!configured) {
    jsonError(req, res, 500, 'Server misconfigured: missing REVIEWER_API_TOKEN')
    return false
  }

  const presented = getReviewerToken(req)
  if (!presented || presented !== configured) {
    jsonError(req, res, 401, 'Unauthorized')
    return false
  }

  return true
}


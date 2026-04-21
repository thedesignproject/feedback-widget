import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getBearerToken, jsonError } from './http.js'
import { getShareBySlug } from './store.js'
import { hashToken } from './tokens.js'

export async function requireAgentShare(req: VercelRequest, res: VercelResponse, slug: string) {
  const token = getBearerToken(req)
  if (!token) {
    jsonError(req, res, 401, 'Missing share token')
    return null
  }

  const share = await getShareBySlug(slug)
  if (!share) {
    jsonError(req, res, 404, 'Share not found')
    return null
  }

  if (share.revokedAt) {
    jsonError(req, res, 410, 'Share revoked')
    return null
  }

  if (new Date(share.expiresAt).getTime() <= Date.now()) {
    jsonError(req, res, 410, 'Share expired')
    return null
  }

  if (hashToken(token) !== share.accessTokenHash) {
    jsonError(req, res, 401, 'Invalid share token')
    return null
  }

  return { share, token }
}


import type { VercelRequest, VercelResponse } from '@vercel/node'

const DEFAULT_HEADERS = 'Content-Type, Authorization, X-Agent-Id, Idempotency-Key, X-Reviewer-Token, X-Share-Token, X-Smoke-Cleanup-Token'

function safeSetHeader(res: VercelResponse, key: string, value: string) {
  if (typeof res.setHeader === 'function') {
    res.setHeader(key, value)
  }
}

export function setCors(req: VercelRequest, res: VercelResponse, methods: string[]) {
  const requestedHeaders = Array.isArray(req.headers['access-control-request-headers'])
    ? req.headers['access-control-request-headers'].join(', ')
    : req.headers['access-control-request-headers']

  safeSetHeader(res, 'Access-Control-Allow-Origin', '*')
  safeSetHeader(res, 'Access-Control-Allow-Methods', methods.join(', '))
  safeSetHeader(res, 'Access-Control-Allow-Headers', requestedHeaders || DEFAULT_HEADERS)
  safeSetHeader(res, 'Access-Control-Max-Age', '86400')
}

export function handleOptions(req: VercelRequest, res: VercelResponse, methods: string[]) {
  setCors(req, res, methods)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true
  }
  return false
}

export function methodNotAllowed(req: VercelRequest, res: VercelResponse, methods: string[]) {
  setCors(req, res, methods)
  return res.status(405).json({ error: 'Method not allowed' })
}

export function jsonError(req: VercelRequest, res: VercelResponse, status: number, error: string) {
  setCors(req, res, ['GET', 'POST', 'PATCH', 'OPTIONS'])
  return res.status(status).json({ error })
}

export function getStringQuery(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function getBearerToken(req: VercelRequest): string | undefined {
  const auth = req.headers.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim()
  }

  const shareToken = req.headers['x-share-token']
  if (typeof shareToken === 'string' && shareToken.length > 0) {
    return shareToken
  }

  return getStringQuery(req.query.token)
}

export function getReviewerToken(req: VercelRequest): string | undefined {
  const auth = req.headers.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim()
  }

  const reviewer = req.headers['x-reviewer-token']
  return typeof reviewer === 'string' && reviewer.length > 0 ? reviewer : undefined
}

function firstHeaderValue(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) return undefined
  return raw.split(',')[0]?.trim() || undefined
}

export function getAppUrl(req: VercelRequest): string {
  const host = firstHeaderValue(req.headers['x-forwarded-host'])
    || firstHeaderValue(req.headers.host)
    || process.env.VERCEL_URL

  if (host) {
    const normalizedHost = host.replace(/^https?:\/\//, '').replace(/\/$/, '')
    const proto = firstHeaderValue(req.headers['x-forwarded-proto'])
      || (normalizedHost.startsWith('localhost') || normalizedHost.startsWith('127.0.0.1') ? 'http' : 'https')

    return `${proto}://${normalizedHost}`.replace(/\/$/, '')
  }

  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')
}

export function getAgentId(req: VercelRequest): string | undefined {
  const header = req.headers['x-agent-id']
  if (typeof header === 'string' && header.length > 0) {
    return header
  }

  const bodyAgentId = (req.body as { agentId?: unknown } | undefined)?.agentId
  return typeof bodyAgentId === 'string' && bodyAgentId.length > 0 ? bodyAgentId : undefined
}

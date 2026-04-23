import type { VercelRequest, VercelResponse } from '@vercel/node'

const DEFAULT_HEADERS = 'Content-Type, Authorization, X-Agent-Id, Idempotency-Key, X-Reviewer-Token, X-Share-Token, X-Smoke-Cleanup-Token'

function safeSetHeader(res: VercelResponse, key: string, value: string) {
  if (typeof res.setHeader === 'function') {
    res.setHeader(key, value)
  }
}

export function setCors(req: VercelRequest, res: VercelResponse, methods: string[]) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '*'
  safeSetHeader(res, 'Access-Control-Allow-Origin', origin)
  safeSetHeader(res, 'Access-Control-Allow-Methods', methods.join(', '))
  safeSetHeader(res, 'Access-Control-Allow-Headers', DEFAULT_HEADERS)
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

export function isOriginAllowed(req: VercelRequest, project: { allowedOrigins?: string[] | null }) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null
  if (!origin) return true
  const allowed = project.allowedOrigins || []
  if (allowed.length === 0) return true
  if (allowed.includes('*')) return true
  return allowed.includes(origin)
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

export function getAgentId(req: VercelRequest): string | undefined {
  const header = req.headers['x-agent-id']
  if (typeof header === 'string' && header.length > 0) {
    return header
  }

  const bodyAgentId = (req.body as { agentId?: unknown } | undefined)?.agentId
  return typeof bodyAgentId === 'string' && bodyAgentId.length > 0 ? bodyAgentId : undefined
}


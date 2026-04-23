import type { VercelRequest, VercelResponse } from '@vercel/node'

export const CORS_METHODS = ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] as const

const DEFAULT_ALLOWED_HEADERS = 'Content-Type, Authorization'

function headerValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.join(', ')
  return value
}

export function setCors(req: VercelRequest, res: VercelResponse) {
  const requestedHeaders = headerValue(req.headers['access-control-request-headers'])

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', CORS_METHODS.join(', '))
  res.setHeader('Access-Control-Allow-Headers', requestedHeaders || DEFAULT_ALLOWED_HEADERS)
  res.setHeader('Access-Control-Max-Age', '86400')
}

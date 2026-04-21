import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createShare, getProject, getProjectShare } from '../../_lib/store.js'
import { encryptToken, generateAccessToken, generateSlug, hashToken } from '../../_lib/tokens.js'
import { decryptToken } from '../../_lib/tokens.js'
import { getStringQuery, handleOptions, jsonError, methodNotAllowed, setCors } from '../../_lib/http.js'

function appUrl() {
  return process.env.APP_URL || 'http://localhost:3000'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, ['GET', 'OPTIONS'])) return
  if (req.method !== 'GET') return methodNotAllowed(req, res, ['GET', 'OPTIONS'])

  try {
    const projectKey = getStringQuery(req.query.projectKey)
    if (!projectKey) return jsonError(req, res, 400, 'Missing projectKey')

    const project = await getProject(projectKey)
    if (!project) return jsonError(req, res, 404, 'Project not found')

    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null
    const allowedOrigins = project.allowedOrigins || []
    if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes('*') && !allowedOrigins.includes(origin)) {
      return jsonError(req, res, 403, 'Origin not allowed for this project')
    }

    let share = await getProjectShare(projectKey)
    let token: string

    if (share) {
      token = decryptToken(share.accessTokenCiphertext)
    } else {
      token = generateAccessToken()
      const slug = generateSlug()
      const expiresAt = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString()
      share = await createShare({
        projectKey,
        scopeType: 'project',
        scopePageUrl: null,
        slug,
        accessTokenHash: hashToken(token),
        accessTokenCiphertext: encryptToken(token),
        createdBy: 'system',
        expiresAt,
      })
    }

    const base = appUrl()
    const docUrl = `${base}/d/${share.slug}?token=${encodeURIComponent(token)}`

    setCors(req, res, ['GET', 'OPTIONS'])
    return res.status(200).json({
      projectKey: project.publicKey,
      projectName: project.name,
      doc: {
        slug: share.slug,
        token,
        docUrl,
        promptUrl: `${base}/api/v1/shares/${share.slug}/prompt?token=${encodeURIComponent(token)}`,
      },
    })
  } catch (error) {
    return jsonError(req, res, 500, error instanceof Error ? error.message : 'Unexpected error')
  }
}

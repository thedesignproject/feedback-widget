import type { VercelRequest, VercelResponse } from '@vercel/node'
import { exchangeLinearCode, getLinearWorkspace, verifyLinearOAuthState } from '../../../_lib/linear.js'
import { encryptToken } from '../../../_lib/tokens.js'
import { getProjectMember, upsertProjectIntegration } from '../../../_lib/store.js'
import { widgetCallbackHtml } from '../../../_lib/widget-github-auth.js'
import { getStringQuery, jsonError, methodNotAllowed } from '../../../_lib/http.js'

function html(res: VercelResponse, body: string) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  return res.status(200).send(body)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return methodNotAllowed(req, res, ['GET'])
  const code = getStringQuery(req.query.code)
  const state = getStringQuery(req.query.state)
  if (!code || !state) return jsonError(req, res, 400, 'Missing code or state')
  const verified = verifyLinearOAuthState(state)
  if (!verified) return jsonError(req, res, 400, 'Invalid or expired state')
  try {
    const membership = await getProjectMember(verified.userId, verified.projectKey)
    if (membership?.role !== 'admin') throw new Error('linear_oauth_forbidden')
    const tokens = await exchangeLinearCode(code, verified.redirectUri)
    const workspace = await getLinearWorkspace(tokens.accessToken)
    const firstTeam = workspace.teams[0] ?? null
    await upsertProjectIntegration({
      projectKey: verified.projectKey,
      provider: 'linear',
      accessTokenCiphertext: encryptToken(tokens.accessToken),
      refreshTokenCiphertext: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
      tokenExpiresAt: tokens.expiresAt,
      grantedScopes: tokens.grantedScopes,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      containerId: firstTeam?.id ?? null,
      containerName: firstTeam ? `${firstTeam.key} · ${firstTeam.name}` : null,
      createdBy: verified.userId,
    })
    return html(res, widgetCallbackHtml(verified.origin, {
      type: 'crrt:linear-connect', ok: true, projectKey: verified.projectKey,
    }))
  } catch {
    return html(res, widgetCallbackHtml(verified.origin, {
      type: 'crrt:linear-connect', ok: false, error: 'linear_oauth_failed',
    }))
  }
}

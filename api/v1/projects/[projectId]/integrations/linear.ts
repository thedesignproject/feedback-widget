import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireUser } from '../../../../_lib/auth.js'
import { getLinearAccessToken } from '../../../../_lib/linear-connection.js'
import { buildLinearAuthorizeUrl, createLinearOAuthState, getLinearWorkspace, hasLinearWriteScope } from '../../../../_lib/linear.js'
import {
  deleteProjectIntegration,
  getProjectIntegration,
  getProjectMember,
  updateProjectIntegrationDestination,
} from '../../../../_lib/store.js'
import { firstHeaderValue, getAppUrl, getStringQuery, handleOptions, jsonError, methodNotAllowed, setCors } from '../../../../_lib/http.js'

const METHODS = ['GET', 'PATCH', 'DELETE', 'OPTIONS']

function browserOrigin(req: VercelRequest) {
  const raw = firstHeaderValue(req.headers.origin)
  try { return raw ? new URL(raw).origin : getAppUrl(req) } catch { return getAppUrl(req) }
}

function redirectUri(req: VercelRequest) {
  const configured = process.env.LINEAR_REDIRECT_URI?.trim()
  return configured || `${getAppUrl(req)}/v1/integrations/linear/callback`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, METHODS)) return
  if (!METHODS.includes(req.method ?? '')) return methodNotAllowed(req, res, METHODS)
  const user = await requireUser(req, res)
  if (!user) return
  const projectKey = getStringQuery(req.query.projectId)
  if (!projectKey) return jsonError(req, res, 400, 'Missing projectId')
  try {
    const membership = await getProjectMember(user.userId, projectKey)
    if (membership?.role !== 'admin') return jsonError(req, res, 403, 'Admin role required')

    if (req.method === 'DELETE') {
      await deleteProjectIntegration(projectKey, 'linear')
      setCors(req, res, METHODS)
      return res.status(204).end()
    }

    if (req.method === 'GET' && getStringQuery(req.query.action) === 'authorize') {
      const callback = redirectUri(req)
      const state = createLinearOAuthState({
        projectKey,
        userId: user.userId,
        origin: browserOrigin(req),
        redirectUri: callback,
      })
      setCors(req, res, METHODS)
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json({ authorizeUrl: buildLinearAuthorizeUrl(state, callback) })
    }

    const integration = await getProjectIntegration(projectKey, 'linear')
    if (!integration) {
      setCors(req, res, METHODS)
      return res.status(200).json({ connected: false, provider: 'linear', destinations: [] })
    }
    const token = await getLinearAccessToken(integration)
    const workspace = await getLinearWorkspace(token)

    if (req.method === 'PATCH') {
      const containerId = typeof req.body?.containerId === 'string' ? req.body.containerId : ''
      const team = workspace.teams.find((candidate) => candidate.id === containerId)
      if (!team) return jsonError(req, res, 400, 'invalid_linear_team')
      await updateProjectIntegrationDestination(projectKey, 'linear', team.id, `${team.key} · ${team.name}`)
    }

    const current = await getProjectIntegration(projectKey, 'linear')
    setCors(req, res, METHODS)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({
      connected: Boolean(current?.containerId),
      provider: 'linear',
      reauthorizationRequired: !hasLinearWriteScope(integration.grantedScopes),
      workspace: current?.workspaceName ?? workspace.name,
      selectedDestinationId: req.method === 'PATCH'
        ? (typeof req.body?.containerId === 'string' ? req.body.containerId : null)
        : integration.containerId,
      destinations: workspace.teams.map((team) => ({ id: team.id, name: `${team.key} · ${team.name}` })),
    })
  } catch (error) {
    const known = error instanceof Error && ['missing_linear_oauth_credentials', 'linear_reauthorization_required'].includes(error.message)
    if (!known) console.error('Linear project integration failed')
    return jsonError(req, res, known ? 409 : 502, known && error instanceof Error ? error.message : 'Linear integration request failed')
  }
}

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const LINEAR_AUTHORIZE_URL = 'https://linear.app/oauth/authorize'
const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token'
const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'
const STATE_TTL_SECONDS = 10 * 60

export type LinearOAuthState = {
  type: 'linear-oauth'
  projectKey: string
  userId: string
  origin: string
  redirectUri: string
  nonce: string
  exp: number
}

export type LinearTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: string | null
  grantedScopes: string | null
}

function credentials() {
  const clientId = process.env.LINEAR_CLIENT_ID?.trim()
  const clientSecret = process.env.LINEAR_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) throw new Error('missing_linear_oauth_credentials')
  return { clientId, clientSecret }
}

function stateSecret() {
  const secret = process.env.WIDGET_AUTH_SECRET?.trim()
  if (!secret) throw new Error('missing_widget_auth_secret')
  return secret
}

function sign(body: string) {
  return createHmac('sha256', stateSecret()).update(body).digest('base64url')
}

export function createLinearOAuthState(
  input: Pick<LinearOAuthState, 'projectKey' | 'userId' | 'origin' | 'redirectUri'>,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const payload: LinearOAuthState = {
    ...input,
    type: 'linear-oauth',
    nonce: randomBytes(16).toString('base64url'),
    exp: nowSeconds + STATE_TTL_SECONDS,
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(body)}`
}

export function verifyLinearOAuthState(token: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const [body, signature, extra] = token.split('.')
  if (!body || !signature || extra !== undefined) return null
  const expected = Buffer.from(sign(body))
  const actual = Buffer.from(signature)
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<LinearOAuthState>
    if (
      value.type !== 'linear-oauth'
      || typeof value.projectKey !== 'string'
      || typeof value.userId !== 'string'
      || typeof value.origin !== 'string'
      || typeof value.redirectUri !== 'string'
      || typeof value.nonce !== 'string'
      || typeof value.exp !== 'number'
      || value.exp < nowSeconds
    ) return null
    return value as LinearOAuthState
  } catch {
    return null
  }
}

export function buildLinearAuthorizeUrl(state: string, redirectUri: string) {
  const { clientId } = credentials()
  const url = new URL(LINEAR_AUTHORIZE_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'read,write')
  url.searchParams.set('actor', 'user')
  url.searchParams.set('state', state)
  return url.toString()
}

function parseTokens(body: Record<string, unknown>): LinearTokens {
  if (typeof body.access_token !== 'string') throw new Error('linear_token_exchange_failed')
  const expiresIn = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : null
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1_000).toISOString() : null,
    grantedScopes: typeof body.scope === 'string' ? body.scope : null,
  }
}

async function tokenRequest(params: URLSearchParams) {
  const response = await fetch(LINEAR_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
  const body = await response.json() as Record<string, unknown>
  if (!response.ok) throw new Error('linear_token_exchange_failed')
  return parseTokens(body)
}

export function exchangeLinearCode(code: string, redirectUri: string) {
  const { clientId, clientSecret } = credentials()
  return tokenRequest(new URLSearchParams({
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
  }))
}

export function refreshLinearToken(refreshToken: string) {
  const { clientId, clientSecret } = credentials()
  return tokenRequest(new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  }))
}

export function hasLinearWriteScope(grantedScopes: string | null | undefined) {
  return Boolean(grantedScopes?.split(/[ ,]+/).includes('write'))
}

async function linearGraphql<T>(accessToken: string, query: string, variables?: Record<string, unknown>) {
  let response: Response
  try {
    response = await fetch(LINEAR_GRAPHQL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new Error('linear_result_indeterminate')
  }
  let body: { data?: T; errors?: unknown[] }
  try {
    body = await response.json() as { data?: T; errors?: unknown[] }
  } catch {
    throw new Error('linear_result_indeterminate')
  }
  if (!response.ok || body.errors?.length || !body.data) throw new Error('linear_request_failed')
  return body.data
}

export async function getLinearWorkspace(accessToken: string) {
  const data = await linearGraphql<{
    viewer: { organization: { id: string; name: string } }
    teams: { nodes: Array<{ id: string; key: string; name: string }> }
  }>(accessToken, 'query CRRTLinearSetup { viewer { organization { id name } } teams { nodes { id key name } } }')
  const organization = data.viewer?.organization
  const teams = data.teams?.nodes
  if (!organization?.id || !organization.name || !Array.isArray(teams)) throw new Error('linear_workspace_invalid')
  return { id: organization.id, name: organization.name, teams: teams.filter((team) => team.id && team.name && team.key) }
}

export async function createLinearIssue(accessToken: string, input: { teamId: string; title: string; description: string }) {
  const data = await linearGraphql<{
    issueCreate: { success: boolean; issue: { id: string; identifier: string; url: string } | null }
  }>(accessToken, 'mutation CRRTIssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }', {
    input: { teamId: input.teamId, title: input.title, description: input.description },
  })
  const issue = data.issueCreate?.issue
  if (!data.issueCreate?.success || !issue?.id || !issue.identifier || !issue.url) throw new Error('linear_issue_create_failed')
  let externalUrl: string
  try {
    const url = new URL(issue.url)
    if (url.protocol !== 'https:' || url.hostname !== 'linear.app') throw new Error('invalid')
    externalUrl = url.toString()
  } catch {
    throw new Error('linear_issue_create_failed')
  }
  return { externalId: issue.id, externalKey: issue.identifier, externalUrl }
}

export async function closeLinearIssue(accessToken: string, input: {
  issueId: string
  comment: string
  marker: string
  beforeClose?: () => Promise<boolean>
}) {
  const context = await linearGraphql<{
    issue: {
      state: { type: string } | null
      team: { states: { nodes: Array<{ id: string; name: string; position: number }> } }
      comments: {
        nodes: Array<{ body: string }>
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
      }
    } | null
  }>(accessToken, `query CRRTIssueCloseContext($issueId: String!, $after: String) {
    issue(id: $issueId) {
      state { type }
      team { states(filter: { type: { eq: "canceled" } }) { nodes { id name position } } }
      comments(first: 100, after: $after) { nodes { body } pageInfo { hasNextPage endCursor } }
    }
  }`, { issueId: input.issueId, after: null })
  const issue = context.issue
  if (!issue) throw new Error('linear_issue_not_found')
  if (
    !Array.isArray(issue.comments?.nodes)
    || typeof issue.comments.pageInfo?.hasNextPage !== 'boolean'
  ) throw new Error('linear_request_failed')
  let hasMarker = issue.comments.nodes.some((comment) => comment.body.includes(input.marker))
  let pageInfo = issue.comments.pageInfo
  while (!hasMarker && pageInfo.hasNextPage) {
    if (!pageInfo.endCursor) throw new Error('linear_request_failed')
    const page = await linearGraphql<{
      issue: { comments: {
        nodes: Array<{ body: string }>
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
      } } | null
    }>(accessToken, `query CRRTIssueCloseComments($issueId: String!, $after: String!) {
      issue(id: $issueId) {
        comments(first: 100, after: $after) { nodes { body } pageInfo { hasNextPage endCursor } }
      }
    }`, { issueId: input.issueId, after: pageInfo.endCursor })
    if (!page.issue) throw new Error('linear_issue_not_found')
    hasMarker = page.issue.comments.nodes.some((comment) => comment.body.includes(input.marker))
    pageInfo = page.issue.comments.pageInfo
  }
  if (issue.state?.type !== 'canceled') {
    const canceled = [...issue.team.states.nodes].sort((a, b) => a.position - b.position)[0]
    if (!canceled?.id) throw new Error('linear_canceled_state_unavailable')
    if (input.beforeClose && !(await input.beforeClose())) throw new Error('external_work_sync_cancelled')
    const updated = await linearGraphql<{ issueUpdate: { success: boolean } }>(
      accessToken,
      'mutation CRRTIssueReject($issueId: String!, $input: IssueUpdateInput!) { issueUpdate(id: $issueId, input: $input) { success } }',
      { issueId: input.issueId, input: { stateId: canceled.id } },
    )
    if (!updated.issueUpdate?.success) throw new Error('linear_issue_close_failed')
  }
  if (hasMarker) return
  if (input.beforeClose && !(await input.beforeClose())) throw new Error('external_work_sync_cancelled')
  const commented = await linearGraphql<{ commentCreate: { success: boolean } }>(
    accessToken,
    'mutation CRRTIssueRejectComment($input: CommentCreateInput!) { commentCreate(input: $input) { success } }',
    { input: { issueId: input.issueId, body: `${input.comment}\n\n${input.marker}` } },
  )
  if (!commented.commentCreate?.success) throw new Error('linear_issue_comment_failed')
}

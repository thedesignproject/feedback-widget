import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const JIRA_AUTHORIZE_URL = 'https://auth.atlassian.com/authorize'
const JIRA_TOKEN_URL = 'https://auth.atlassian.com/oauth/token'
const ATLASSIAN_API_URL = 'https://api.atlassian.com'
const STATE_TTL_SECONDS = 10 * 60

export type JiraOAuthState = {
  type: 'jira-oauth'
  projectKey: string
  userId: string
  origin: string
  redirectUri: string
  nonce: string
  exp: number
}

export type JiraTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: string | null
}

export type JiraDestination = {
  id: string
  cloudId: string
  siteName: string
  siteUrl: string
  projectId: string
  projectKey: string
  projectName: string
}

function credentials() {
  const clientId = process.env.JIRA_CLIENT_ID?.trim()
  const clientSecret = process.env.JIRA_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) throw new Error('missing_jira_oauth_credentials')
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

export function createJiraOAuthState(
  input: Pick<JiraOAuthState, 'projectKey' | 'userId' | 'origin' | 'redirectUri'>,
  nowSeconds = Math.floor(Date.now() / 1_000),
) {
  const payload: JiraOAuthState = {
    ...input,
    type: 'jira-oauth',
    nonce: randomBytes(16).toString('base64url'),
    exp: nowSeconds + STATE_TTL_SECONDS,
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(body)}`
}

export function verifyJiraOAuthState(token: string, nowSeconds = Math.floor(Date.now() / 1_000)) {
  const [body, signature, extra] = token.split('.')
  if (!body || !signature || extra !== undefined) return null
  const expected = Buffer.from(sign(body))
  const actual = Buffer.from(signature)
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<JiraOAuthState>
    if (
      value.type !== 'jira-oauth'
      || typeof value.projectKey !== 'string'
      || typeof value.userId !== 'string'
      || typeof value.origin !== 'string'
      || typeof value.redirectUri !== 'string'
      || typeof value.nonce !== 'string'
      || typeof value.exp !== 'number'
      || value.exp < nowSeconds
    ) return null
    return value as JiraOAuthState
  } catch {
    return null
  }
}

export function buildJiraAuthorizeUrl(state: string, redirectUri: string) {
  const { clientId } = credentials()
  const url = new URL(JIRA_AUTHORIZE_URL)
  url.searchParams.set('audience', 'api.atlassian.com')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('scope', 'read:jira-work write:jira-work offline_access')
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('prompt', 'consent')
  return url.toString()
}

function parseTokens(body: Record<string, unknown>): JiraTokens {
  if (typeof body.access_token !== 'string') throw new Error('jira_token_exchange_failed')
  const expiresIn = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : null
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1_000).toISOString() : null,
  }
}

async function tokenRequest(payload: Record<string, string>) {
  let response: Response
  let body: Record<string, unknown>
  try {
    response = await fetch(JIRA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    body = await response.json() as Record<string, unknown>
  } catch {
    throw new Error('jira_token_exchange_failed')
  }
  if (!response.ok) throw new Error('jira_token_exchange_failed')
  return parseTokens(body)
}

export function exchangeJiraCode(code: string, redirectUri: string) {
  const { clientId, clientSecret } = credentials()
  return tokenRequest({
    grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret,
    code, redirect_uri: redirectUri,
  })
}

export function refreshJiraToken(refreshToken: string) {
  const { clientId, clientSecret } = credentials()
  return tokenRequest({
    grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret,
    refresh_token: refreshToken,
  })
}

async function jiraRequest<T>(accessToken: string, path: string, init: RequestInit = {}, indeterminate = false) {
  let response: Response
  try {
    response = await fetch(`${ATLASSIAN_API_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new Error(indeterminate ? 'jira_result_indeterminate' : 'jira_request_failed')
  }
  if (!response.ok) {
    const code = response.status === 401
      ? 'jira_reauthorization_required'
      : response.status === 403
        ? 'jira_permission_denied'
        : response.status === 404
          ? 'jira_resource_not_found'
          : response.status === 409
            ? 'jira_conflict'
            : response.status === 429
              ? 'jira_rate_limited'
              : 'jira_request_failed'
    throw new Error(code)
  }
  if (response.status === 204) return undefined as T
  let body: T
  try { body = await response.json() as T }
  catch { throw new Error(indeterminate ? 'jira_result_indeterminate' : 'jira_request_failed') }
  return body
}

type JiraResource = { id: string; name: string; url: string; scopes?: string[] }

export async function getJiraDestinations(accessToken: string) {
  const resources = await jiraRequest<JiraResource[]>(accessToken, '/oauth/token/accessible-resources')
  const sites = resources.filter((resource) => (
    resource.id && resource.name && resource.url
    && (!resource.scopes || resource.scopes.some((scope) => scope.includes(':jira-work')))
  )).slice(0, 10)
  const groups = await Promise.all(sites.map(async (site) => {
    const result = await jiraRequest<{ values?: Array<{ id: string; key: string; name: string }> }>(
      accessToken,
      `/ex/jira/${encodeURIComponent(site.id)}/rest/api/3/project/search?maxResults=100`,
    )
    return (result.values ?? []).filter((project) => project.id && project.key && project.name).map((project): JiraDestination => ({
      id: `${site.id}:${project.id}`,
      cloudId: site.id,
      siteName: site.name,
      siteUrl: site.url,
      projectId: project.id,
      projectKey: project.key,
      projectName: project.name,
    }))
  }))
  return groups.flat()
}

async function getJiraIssueType(accessToken: string, cloudId: string, projectId: string) {
  const result = await jiraRequest<{ issueTypes?: Array<{ id: string; name: string; subtask?: boolean }> }>(
    accessToken,
    `/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3/issue/createmeta/${encodeURIComponent(projectId)}/issuetypes?maxResults=100`,
  )
  const types = (result.issueTypes ?? []).filter((type) => type.id && !type.subtask)
  const preferred = ['task', 'story', 'bug']
    .map((name) => types.find((type) => type.name.toLowerCase() === name))
    .find(Boolean)
  const issueType = preferred ?? types[0]
  if (!issueType) throw new Error('jira_issue_type_unavailable')
  return issueType.id
}

function adf(text: string) {
  const lines = text.split('\n')
  return {
    type: 'doc', version: 1,
    content: lines.map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  }
}

export async function createJiraIssue(accessToken: string, input: {
  cloudId: string
  siteUrl: string
  projectId: string
  title: string
  description: string
}) {
  const issueTypeId = await getJiraIssueType(accessToken, input.cloudId, input.projectId)
  const result = await jiraRequest<{ id?: string; key?: string }>(
    accessToken,
    `/ex/jira/${encodeURIComponent(input.cloudId)}/rest/api/3/issue`,
    {
      method: 'POST',
      body: JSON.stringify({ fields: {
        project: { id: input.projectId },
        issuetype: { id: issueTypeId },
        summary: input.title,
        description: adf(input.description),
      } }),
    },
    true,
  )
  if (!result.id || !result.key) throw new Error('jira_issue_create_failed')
  let site: URL
  try { site = new URL(input.siteUrl) }
  catch { throw new Error('jira_site_invalid') }
  if (site.protocol !== 'https:' || !site.hostname.endsWith('.atlassian.net')) throw new Error('jira_site_invalid')
  return { externalId: result.id, externalKey: result.key, externalUrl: `${site.origin}/browse/${encodeURIComponent(result.key)}` }
}

type JiraTransition = {
  id: string
  name: string
  to?: { statusCategory?: { key?: string } }
  fields?: Record<string, { required?: boolean; hasDefaultValue?: boolean }>
}

function selectJiraRejectionTransition(transitions: JiraTransition[]) {
  const done = transitions.filter((transition) => (
    transition.id && transition.to?.statusCategory?.key === 'done'
  ))
  const compatible = done.filter((transition) => Object.values(transition.fields ?? {}).every((field) => (
    !field.required || field.hasDefaultValue
  )))
  if (done.length > 0 && compatible.length === 0) throw new Error('jira_transition_fields_required')
  const preferredNames = [/reject/i, /won.?t do/i, /not planned/i, /cancel/i, /declin/i, /close/i]
  for (const pattern of preferredNames) {
    const transition = compatible.find((candidate) => pattern.test(candidate.name))
    if (transition) return transition
  }
  return compatible.length === 1 ? compatible[0] : null
}

export async function closeJiraIssue(accessToken: string, input: {
  cloudId: string
  issueId: string
  comment: string
  marker: string
  beforeClose?: () => Promise<boolean>
}) {
  const issuePath = `/ex/jira/${encodeURIComponent(input.cloudId)}/rest/api/3/issue/${encodeURIComponent(input.issueId)}`
  const issue = await jiraRequest<{ fields?: { status?: { statusCategory?: { key?: string } } } }>(
    accessToken,
    `${issuePath}?fields=status`,
  )
  const statusCategory = issue.fields?.status?.statusCategory?.key
  if (!statusCategory) throw new Error('jira_issue_status_invalid')

  const commentBody = adf(`${input.comment}\n\n${input.marker}`)
  if (statusCategory === 'done') {
    let startAt = 0
    for (;;) {
      const comments = await jiraRequest<{
        comments?: Array<{ body?: unknown }>
        startAt?: number
        total?: number
        isLast?: boolean
      }>(accessToken, `${issuePath}/comment?maxResults=100&startAt=${startAt}`)
      const page = comments.comments ?? []
      if (page.some((comment) => JSON.stringify(comment.body).includes(input.marker))) return
      const next = (typeof comments.startAt === 'number' ? comments.startAt : startAt) + page.length
      if (
        page.length === 0
        || comments.isLast === true
        || (typeof comments.total === 'number' && next >= comments.total)
        || (comments.total === undefined && page.length < 100)
      ) break
      startAt = next
    }
    if (input.beforeClose && !(await input.beforeClose())) throw new Error('external_work_sync_cancelled')
    await jiraRequest(accessToken, `${issuePath}/comment`, {
      method: 'POST',
      body: JSON.stringify({ body: commentBody }),
    }, true)
    return
  }

  const transitionResult = await jiraRequest<{ transitions?: JiraTransition[] }>(
    accessToken,
    `${issuePath}/transitions?expand=transitions.fields`,
  )
  const transition = selectJiraRejectionTransition(transitionResult.transitions ?? [])
  if (!transition) throw new Error('jira_rejection_transition_unavailable')
  if (input.beforeClose && !(await input.beforeClose())) throw new Error('external_work_sync_cancelled')
  await jiraRequest(accessToken, `${issuePath}/transitions`, {
    method: 'POST',
    body: JSON.stringify({
      transition: { id: transition.id },
      update: { comment: [{ add: { body: commentBody } }] },
    }),
  }, true)
}

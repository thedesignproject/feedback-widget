import { createHmac } from 'node:crypto'

const MAX_GITHUB_ISSUE_BODY_BYTES = 65_536
export const MAX_GITHUB_ISSUE_TITLE_LENGTH = 120

export type GithubIssueComment = {
  id: string
  body: string
  authorName: string | null
  pageUrl: string | null
  imageUrl: string | null
  selector: string | null
  x: number | null
  y: number | null
  targetType: 'element_point' | 'text_range'
  anchor: Record<string, unknown> | null
}

export type GithubIssueContent = {
  title: string
  summary: string
  implementationContext: string
}

const githubHeaders = (accessToken: string) => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
  'X-GitHub-Api-Version': '2022-11-28',
})

async function githubRequest(url: string, accessToken: string, init: RequestInit = {}) {
  try {
    return await fetch(url, {
      ...init,
      headers: { ...githubHeaders(accessToken), ...init.headers },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new Error('github_issue_request_failed')
  }
}

async function githubJson(response: Response) {
  try {
    return await response.json() as Record<string, unknown>
  } catch {
    throw new Error('github_issue_request_failed')
  }
}

function markerSecret() {
  const secret = process.env.WIDGET_AUTH_SECRET
  if (!secret) throw new Error('missing_widget_auth_secret')
  return secret
}

export function createCommentIssueMarker(commentId: string) {
  const signature = createHmac('sha256', markerSecret())
    .update(`crrt-comment-issue:v1:${commentId}`)
    .digest('base64url')
  return `<!-- crrt-comment:${commentId}:${signature} -->`
}

export function createCommentRejectionMarker(commentId: string) {
  const signature = createHmac('sha256', markerSecret())
    .update(`crrt-comment-rejection:v1:${commentId}`)
    .digest('base64url')
  return `<!-- crrt-rejection:${commentId}:${signature} -->`
}

function validHttpUrl(value: string | null) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function validGithubIssueUrl(value: string, owner: string, repo: string, issueNumber: number) {
  try {
    const url = new URL(value)
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !match) return null
    if (decodeURIComponent(match[1]).toLowerCase() !== owner.toLowerCase()) return null
    if (decodeURIComponent(match[2]).toLowerCase() !== repo.toLowerCase()) return null
    if (Number(match[3]) !== issueNumber) return null
    return url.toString()
  } catch {
    return null
  }
}

function present(anchor: Record<string, unknown>, key: string) {
  const value = anchor[key]
  if (typeof value === 'string') return value.trim() ? value : null
  return value === null || value === undefined ? null : JSON.stringify(value)
}

function normalizeGithubIssueTitle(value: string) {
  const title = value.trim().replace(/\s+/g, ' ')
  if (!title) throw new Error('github_issue_title_invalid')
  const characters = Array.from(title)
  return characters.length <= MAX_GITHUB_ISSUE_TITLE_LENGTH
    ? title
    : `${characters.slice(0, MAX_GITHUB_ISSUE_TITLE_LENGTH - 1).join('').trimEnd()}…`
}

export function formatGithubIssueBody(
  comment: GithubIssueComment,
  content: GithubIssueContent,
  marker = createCommentIssueMarker(comment.id),
) {
  const sections = [
    `## Summary\n\n${content.summary}`,
    `## Feedback\n\n${comment.body}${comment.authorName ? `\n\n— ${comment.authorName}` : ''}`,
  ]
  const screenshotUrl = validHttpUrl(comment.imageUrl)
  if (screenshotUrl) sections.push(`## Screenshot\n\n![Feedback screenshot](${screenshotUrl})`)
  const pageUrl = validHttpUrl(comment.pageUrl)
  if (pageUrl) sections.push(`## Page\n\n${pageUrl}`)

  const selected: string[] = []
  if (comment.selector) selected.push(`Selector: \`${comment.selector}\``)
  if (typeof comment.x === 'number' && typeof comment.y === 'number'
    && Number.isFinite(comment.x) && Number.isFinite(comment.y)) {
    selected.push(`Coordinates: ${comment.x}, ${comment.y}`)
  }
  if (comment.targetType) selected.push(`Target type: ${comment.targetType}`)
  if (comment.anchor) {
    const labels: Record<string, string> = {
      selectedText: 'Selected text',
      prefix: 'Prefix',
      suffix: 'Suffix',
      containerSelector: 'Container selector',
      startOffset: 'Start offset',
      endOffset: 'End offset',
      rangeClientRects: 'Client rectangles',
      createdAtViewport: 'Viewport',
    }
    for (const [key, label] of Object.entries(labels)) {
      const value = present(comment.anchor, key)
      if (value !== null) selected.push(`${label}: ${value}`)
    }
  }
  if (selected.length) sections.push(`## Selected element\n\n${selected.join('\n')}`)
  sections.push(`## Implementation context\n\n${content.implementationContext}`)
  sections.push(marker)
  return sections.join('\n\n')
}

export function formatEditableGithubIssueBody(body: string, marker: string) {
  const content = body.trim()
  if (!content) throw new Error('github_issue_body_invalid')
  const withoutMarkers = content.replace(/<!--\s*crrt-comment:[\s\S]*?-->/gi, '').trim()
  const result = `${withoutMarkers}\n\n${marker}`
  if (Buffer.byteLength(result, 'utf8') > MAX_GITHUB_ISSUE_BODY_BYTES) {
    throw new Error('github_issue_content_too_large')
  }
  return result
}

export async function findGithubIssueByMarker(input: {
  accessToken: string
  owner: string
  repo: string
  marker: string
}) {
  const query = encodeURIComponent(`repo:${input.owner}/${input.repo} is:issue in:body "${input.marker}"`)
  const response = await githubRequest(
    `https://api.github.com/search/issues?q=${query}&per_page=10`,
    input.accessToken,
  )
  const body = await githubJson(response)
  if (!response.ok || !Array.isArray(body.items)) throw new Error('github_issue_search_failed')
  const matches = (body.items as Array<Record<string, unknown>>)
    .filter((item) => typeof item.body === 'string' && item.body.includes(input.marker))
  if (matches.length === 0) return null
  if (matches.length > 1) throw new Error('github_issue_recovery_ambiguous')
  const issue = matches[0]
  if (
    typeof issue.number !== 'number'
    || typeof issue.html_url !== 'string'
    || typeof issue.created_at !== 'string'
  ) throw new Error('github_issue_search_failed')
  const issueUrl = validGithubIssueUrl(issue.html_url, input.owner, input.repo, issue.number)
  if (!issueUrl) throw new Error('github_issue_search_failed')
  return { issueNumber: issue.number, issueUrl, createdAt: issue.created_at }
}

export async function createGithubIssue(input: {
  accessToken: string
  owner: string
  repo: string
  title: string
  body: string
}) {
  if (Buffer.byteLength(input.body, 'utf8') > MAX_GITHUB_ISSUE_BODY_BYTES) {
    throw new Error('github_issue_content_too_large')
  }
  const title = normalizeGithubIssueTitle(input.title)
  const path = `${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`
  let response: Response
  try {
    response = await fetch(`https://api.github.com/repos/${path}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title, body: input.body }),
      headers: githubHeaders(input.accessToken),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    // The request may have reached GitHub even though no response arrived.
    // Callers must persist an indeterminate state and recover by marker.
    throw new Error('github_issue_result_indeterminate')
  }
  if (!response.ok) {
    let providerMessage: string | null = null
    try {
      const body = await response.json() as Record<string, unknown>
      providerMessage = typeof body.message === 'string' ? body.message : null
    } catch {
      // The status and request id still make malformed provider responses useful.
    }
    console.error('GitHub issue creation failed', {
      status: response.status,
      providerMessage,
      requestId: response.headers.get('x-github-request-id'),
    })
    throw new Error('github_issue_create_failed')
  }

  let issue: Record<string, unknown>
  try {
    issue = await response.json() as Record<string, unknown>
  } catch {
    throw new Error('github_issue_result_indeterminate')
  }
  if (
    typeof issue.number !== 'number'
    || typeof issue.html_url !== 'string'
    || typeof issue.created_at !== 'string'
  ) throw new Error('github_issue_result_indeterminate')
  const issueUrl = validGithubIssueUrl(issue.html_url, input.owner, input.repo, issue.number)
  if (!issueUrl) throw new Error('github_issue_result_indeterminate')
  return { issueNumber: issue.number, issueUrl, createdAt: issue.created_at }
}

export async function closeGithubIssue(input: {
  accessToken: string
  owner: string
  repo: string
  issueNumber: number
  comment: string
  marker: string
  beforeClose?: () => Promise<boolean>
}) {
  const path = `${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`
  const issueUrl = `https://api.github.com/repos/${path}/issues/${input.issueNumber}`
  if (input.beforeClose && !(await input.beforeClose())) throw new Error('external_work_sync_cancelled')
  const closeResponse = await githubRequest(issueUrl, input.accessToken, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'closed', state_reason: 'not_planned' }),
  })
  if (!closeResponse.ok) throw new Error('github_issue_close_failed')

  for (let page = 1; ; page += 1) {
    const commentsResponse = await githubRequest(
      `${issueUrl}/comments?per_page=100&page=${page}`,
      input.accessToken,
    )
    const commentsBody = await githubJson(commentsResponse)
    if (!commentsResponse.ok || !Array.isArray(commentsBody)) throw new Error('github_issue_comments_failed')
    if (commentsBody.some((comment) => (
      typeof comment === 'object'
      && comment !== null
      && typeof (comment as { body?: unknown }).body === 'string'
      && (comment as { body: string }).body.includes(input.marker)
    ))) return
    if (commentsBody.length < 100) break
  }

  const commentResponse = await githubRequest(`${issueUrl}/comments`, input.accessToken, {
    method: 'POST',
    body: JSON.stringify({ body: `${input.comment}\n\n${input.marker}` }),
  })
  if (!commentResponse.ok) throw new Error('github_issue_comment_failed')
}

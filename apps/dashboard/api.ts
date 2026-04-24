export interface Project {
  publicKey: string
  slug: string
  name: string
  allowedOrigins: string[]
  createdAt: string
  updatedAt: string
}

export interface CommentRecord {
  id: string
  projectId: string
  pageUrl: string
  selector: string
  x: number
  y: number
  body: string
  reviewStatus: 'open' | 'accepted' | 'rejected'
  implementationStatus: 'unassigned' | 'claimed' | 'in_progress' | 'blocked' | 'done'
  claimedByAgentId: string | null
  createdAt: string
  updatedAt: string
}

export interface ShareCreationResponse {
  shareId: string
  slug: string
  token: string
  tokenUrl: string
  expiresAt: string
  commentCount: number
}

export interface ShareState {
  share: {
    id: string
    slug: string
    scopeType: 'page' | 'selection'
    scopePageUrl: string | null
    expiresAt: string
    revision: number
  }
  project: {
    publicKey: string
    slug: string
    name: string
    repoUrl: string | null
    localPath: string | null
    defaultBranch: string
    installCommand: string
    devCommand: string | null
    testCommand: string | null
    buildCommand: string | null
    agentInstructions: string | null
  }
  comments: CommentRecord[]
  presence: Array<{
    agentId: string
    status: string
    summary: string | null
    lastSeenAt: string
  }>
  capabilities: {
    presence: boolean
    ops: boolean
  }
}

export interface ShareEventsResponse {
  events: Array<{
    id: number
    shareId: string
    commentId: string | null
    actorType: string
    actorId: string
    eventType: string
    payload: Record<string, unknown>
    createdAt: string
  }>
  nextCursor: number
}

function authHeaders(reviewerToken?: string) {
  const headers: Record<string, string> = {}
  if (reviewerToken) {
    headers.Authorization = `Bearer ${reviewerToken}`
  }
  return headers
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const payload = await response.text()
    throw new Error(payload || `Request failed with ${response.status}`)
  }

  return response.json() as Promise<T>
}

export function listProjects(apiBase: string, reviewerToken: string) {
  return requestJson<Project[]>(`${apiBase}/v1/projects`, {
    headers: {
      ...authHeaders(reviewerToken),
    },
  })
}

export function listComments(apiBase: string, reviewerToken: string, projectId: string, pageUrl?: string) {
  const query = new URLSearchParams()
  if (pageUrl) query.set('pageUrl', pageUrl)
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return requestJson<CommentRecord[]>(`${apiBase}/v1/projects/${encodeURIComponent(projectId)}/comments${suffix}`, {
    headers: {
      ...authHeaders(reviewerToken),
    },
  })
}

export function updateReviewStatus(apiBase: string, reviewerToken: string, commentId: string, reviewStatus: CommentRecord['reviewStatus']) {
  return requestJson<CommentRecord>(`${apiBase}/v1/comments/${encodeURIComponent(commentId)}/review-status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(reviewerToken),
    },
    body: JSON.stringify({ reviewStatus }),
  })
}

export function createShare(apiBase: string, reviewerToken: string, body: Record<string, unknown>) {
  return requestJson<ShareCreationResponse>(`${apiBase}/v1/feedback-shares`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(reviewerToken),
    },
    body: JSON.stringify(body),
  })
}

export function getPrompt(apiBase: string, reviewerToken: string, shareId: string, target: 'codex' | 'claude-code' | 'generic') {
  return requestJson<{ prompt: string, tokenUrl: string }>(
    `${apiBase}/v1/feedback-shares/${encodeURIComponent(shareId)}/prompt?target=${encodeURIComponent(target)}`,
    {
      headers: {
        ...authHeaders(reviewerToken),
      },
    },
  )
}

export function getShareState(apiBase: string, slug: string, token: string) {
  return requestJson<ShareState>(`${apiBase}/v1/agent/shares/${encodeURIComponent(slug)}/state`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

export function getShareEvents(apiBase: string, slug: string, token: string, after: number) {
  return requestJson<ShareEventsResponse>(
    `${apiBase}/v1/agent/shares/${encodeURIComponent(slug)}/events?after=${after}&limit=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  )
}

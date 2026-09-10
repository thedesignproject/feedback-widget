export interface Project {
  publicKey: string
  slug: string
  name: string
  allowedOrigins: string[]
  createdAt: string
  updatedAt: string
  role?: ProjectMemberRole
  capabilities?: ProjectCapability[]
}

export type ProjectCapability = 'feedback:read' | 'feedback:create' | 'feedback:manage' | 'agent:operate' | 'integrations:send' | 'project:manage'

export type CommentTargetType = 'element_point' | 'text_range'

// Mirrors the widget's TextRangeAnchor (the dashboard cannot import from src/)
export interface TextRangeAnchorRecord {
  kind: 'text_range'
  selectedText: string
  normalizedText: string
  prefix: string
  suffix: string
  containerSelector: string
  startOffset: number
  endOffset: number
  rangeClientRects?: Array<{ left: number; top: number; width: number; height: number }>
  createdFromUrl: string
  createdAtViewport?: { width: number; height: number; scrollX: number; scrollY: number }
}

export interface CommentRecord {
  id: string
  projectId: string
  pageUrl: string | null
  selector: string | null
  x: number | null
  y: number | null
  body: string
  visibility?: 'shared' | 'internal'
  reviewStatus: 'open' | 'accepted' | 'rejected'
  implementationStatus: 'unassigned' | 'claimed' | 'in_progress' | 'blocked' | 'done'
  claimedByAgentId: string | null
  imageUrl: string | null
  authorName: string | null
  targetType?: CommentTargetType
  anchor?: TextRangeAnchorRecord | null
  githubIssue?: GitHubIssueRecord | null
  externalWork?: ExternalWorkRecord[]
  createdAt: string
  updatedAt: string
}

export interface GitHubIssueRecord {
  issueNumber: number
  issueUrl: string
  createdAt: string
}

export interface GitHubIssueCreationResponse extends GitHubIssueRecord {
  created: boolean
}

export type ExternalWorkProvider = 'github' | 'linear' | 'jira'

export interface ExternalWorkRecord {
  provider: ExternalWorkProvider
  externalId: string
  externalKey: string
  externalUrl: string
  lifecycleStatus: 'active' | 'closing' | 'closed' | 'failed' | 'blocked'
  syncAction?: 'retry' | 'reconnect' | 'check_permissions' | 'check_issue' | 'configure_workflow' | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ExternalWorkDraft {
  provider: ExternalWorkProvider
  connected: boolean
  destination: string | null
  existing: (GitHubIssueRecord & { externalUrl?: string }) | { externalId: string; externalKey: string; externalUrl: string; createdAt: string } | null
  draft: { title: string; body: string }
}

export interface ProjectTrackerIntegration {
  provider: 'linear' | 'jira'
  connected: boolean
  workspace?: string
  selectedDestinationId?: string | null
  destinations: Array<{ id: string; name: string }>
  reauthorizationRequired?: boolean
}

export interface ExtensionCommentRecord {
  id: string
  projectId: string | null
  pageUrl: string
  pageHostname: string
  x: number
  y: number
  selector: string
  body: string
  screenshotUrl: string | null
  authorName: string | null
  createdAt: string
  updatedAt: string
  targetType?: CommentTargetType
  anchor?: TextRangeAnchorRecord | null
}

export interface ExtensionCommentsPage {
  items: ExtensionCommentRecord[]
  page: number
  limit: number
  total: number
}

export interface ProjectSessionResponse {
  projectKey: string
  projectName: string
  doc: { slug: string; token: string; docUrl: string; promptUrl: string }
}

export interface SharePromptResponse {
  slug: string
  target: string
  prompt: string
  docUrl: string
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

function authHeaders(accessToken?: string) {
  const headers: Record<string, string> = {}
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }
  return headers
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const text = await response.text()

  if (!response.ok) {
    throw new Error(text || `Request failed with ${response.status}`)
  }

  try {
    return JSON.parse(text) as T
  } catch {
    const preview = text.slice(0, 80).replace(/\s+/g, ' ').trim()
    throw new Error(`Expected JSON from ${url} but got: ${preview || '(empty body)'}. Is the API server running?`)
  }
}

export interface AdminUser {
  id: string
  email: string | null
  createdAt: string
  lastSignInAt: string | null
  emailConfirmedAt: string | null
  projectsAsAdminCount: number
  projectsAsMemberCount: number
  superAdmin: boolean
}

export interface AdminProjectMember {
  email: string
  role: 'admin' | 'member' | 'guest'
}

export interface AdminProject {
  publicKey: string
  name: string
  createdAt: string
  commentCount: number
  commentStatusCounts: { pending: number; accepted: number; rejected: number }
  implementationStatusCounts: {
    unassigned: number
    claimed: number
    inProgress: number
    blocked: number
    done: number
  }
  feedbackShareCount: number
  commentedUrlCount: number
  firstCommentAt: string
  lastCommentAt: string
  claimed: boolean
  members: AdminProjectMember[]
}

export interface AdminPage<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
}

export type AdminProjectSort =
  | 'lastCommentAt'
  | 'createdAt'
  | 'commentCount'
  | 'feedbackShareCount'
  | 'commentedUrlCount'

export type AdminSortDirection = 'asc' | 'desc'

export interface AdminStats {
  accounts: number
  projects: number
  comments: number
  shares: number
  activeAgentPresence: number
  signups: { last24Hours: number; last7Days: number; last30Days: number }
}

// Whether the current user may see the Super Admin section. The server makes
// the real decision on every /v1/admin/* call; this only drives UI visibility.
export function getSuperAdminStatus(apiBase: string, accessToken: string) {
  return requestJson<{ isSuperAdmin: boolean }>(`${apiBase}/v1/admin/me`, {
    headers: { ...authHeaders(accessToken) },
  })
}

export function listAdminUsers(apiBase: string, accessToken: string, opts: { cursor?: string | null; limit?: number } = {}) {
  const query = new URLSearchParams()
  if (opts.limit) query.set('limit', String(opts.limit))
  if (opts.cursor) query.set('cursor', opts.cursor)
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return requestJson<AdminPage<AdminUser>>(`${apiBase}/v1/admin/users${suffix}`, {
    headers: { ...authHeaders(accessToken) },
  })
}

export function listAdminProjects(apiBase: string, accessToken: string, opts: {
  cursor?: string | null
  limit?: number
  sort?: AdminProjectSort
  direction?: AdminSortDirection
} = {}) {
  const query = new URLSearchParams()
  if (opts.limit) query.set('limit', String(opts.limit))
  if (opts.cursor) query.set('cursor', opts.cursor)
  if (opts.sort) query.set('sort', opts.sort)
  if (opts.direction) query.set('direction', opts.direction)
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return requestJson<AdminPage<AdminProject>>(`${apiBase}/v1/admin/projects${suffix}`, {
    headers: { ...authHeaders(accessToken) },
  })
}

export function getAdminStats(apiBase: string, accessToken: string) {
  return requestJson<AdminStats>(`${apiBase}/v1/admin/stats`, {
    headers: { ...authHeaders(accessToken) },
  })
}

export function listProjects(apiBase: string, accessToken: string) {
  return requestJson<Project[]>(`${apiBase}/v1/projects`, {
    headers: {
      ...authHeaders(accessToken),
    },
  })
}

export interface ProjectKeyAvailability {
  key: string
  available: boolean
  suggestion: string
}

// Check whether a candidate project key is free, and get a suggested
// alternative (slug + short suffix) when it isn't.
export function checkProjectKeyAvailability(apiBase: string, accessToken: string, key: string) {
  return requestJson<ProjectKeyAvailability>(
    `${apiBase}/v1/projects/availability?key=${encodeURIComponent(key)}`,
    {
      headers: {
        ...authHeaders(accessToken),
      },
    },
  )
}

// Claim a project key as the current user, creating the project with the given
// name if it doesn't exist yet. Replaces the removed POST /v1/projects.
export function claimProject(apiBase: string, accessToken: string, projectKey: string, name: string) {
  return requestJson<Project>(`${apiBase}/v1/projects/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(accessToken),
    },
    body: JSON.stringify({ projectKey, name }),
  })
}

export type ProjectMemberRole = 'owner' | 'admin' | 'member' | 'guest'

export interface ProjectMember {
  userId: string
  email: string | null
  role: ProjectMemberRole
  createdAt: string
}

export interface ProjectMemberRoleChange {
  projectKey: string
  userId: string
  previousRole: ProjectMemberRole
  role: ProjectMemberRole
  changed: boolean
}

export interface ProjectInvite {
  projectKey: string
  email: string
  role: 'admin' | 'member' | 'guest'
  invitedBy: string
  createdAt: string
}

export function listProjectMembers(apiBase: string, accessToken: string, projectKey: string) {
  return requestJson<ProjectMember[]>(`${apiBase}/v1/projects/${encodeURIComponent(projectKey)}/members`, {
    headers: { ...authHeaders(accessToken) },
  })
}

export function removeProjectMember(apiBase: string, accessToken: string, projectKey: string, userId: string) {
  return requestJson<{ projectKey: string; userId: string }>(
    `${apiBase}/v1/projects/${encodeURIComponent(projectKey)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE', headers: { ...authHeaders(accessToken) } },
  )
}

export function changeProjectMemberRole(
  apiBase: string,
  accessToken: string,
  projectKey: string,
  userId: string,
  role: ProjectMemberRole,
) {
  return requestJson<ProjectMemberRoleChange>(
    `${apiBase}/v1/projects/${encodeURIComponent(projectKey)}/members/${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders(accessToken) },
      body: JSON.stringify({ role }),
    },
  )
}

export type GitHubConnectionStatus = 'disconnected' | 'reconnect_required' | 'connected'

export interface ProjectGitHubStatus {
  githubConnectionStatus: 'disconnected' | 'connected'
}

export interface RepoConfig {
  projectKey: string
  repoUrl: string | null
  githubOwner: string | null
  githubRepo: string | null
  githubConnectionStatus: GitHubConnectionStatus
  localPath: string | null
  defaultBranch: string | null
  installCommand: string | null
  devCommand: string | null
  testCommand: string | null
  buildCommand: string | null
  agentInstructions: string | null
}

export type GitHubRepoConfig = RepoConfig

export interface GitHubInstallationOption {
  id: string
  githubAccountLogin: string
  githubAccountType: 'User' | 'Organization'
  lastVerifiedAt: string
  authorizeUrl: string
}

export interface GitHubInstallOptions {
  installUrl: string
  installations: GitHubInstallationOption[]
}

// Server-side cap for agentInstructions (mirrored from
// api/v1/projects/[projectId]/repo-config.ts AGENT_INSTRUCTIONS_MAX).
export const AGENT_INSTRUCTIONS_MAX = 4000

// Full repo config is admin-gated server-side; GET returns null when the
// project has no config row yet.
export function getProjectRepoConfig(apiBase: string, accessToken: string, projectKey: string) {
  return requestJson<RepoConfig | null>(`${apiBase}/v1/projects/${encodeURIComponent(projectKey)}/repo-config`, {
    headers: { ...authHeaders(accessToken) },
  })
}

export function getProjectGitHubStatus(apiBase: string, accessToken: string, projectKey: string) {
  return requestJson<ProjectGitHubStatus>(
    `${apiBase}/v1/projects/${encodeURIComponent(projectKey)}/repo-config?view=status`,
    { headers: { ...authHeaders(accessToken) }, cache: 'no-store' },
  )
}

export function getGitHubInstallOptions(apiBase: string, accessToken: string, projectKey: string) {
  return requestJson<GitHubInstallOptions>(
    `${apiBase}/v1/projects/${encodeURIComponent(projectKey)}/github/install`,
    { headers: { ...authHeaders(accessToken) }, cache: 'no-store' },
  )
}

export function connectProjectGitHubRepo(
  apiBase: string,
  accessToken: string,
  projectKey: string,
  repoUrl: string,
  installationToken: string,
) {
  return requestJson<GitHubRepoConfig>(
    `${apiBase}/v1/projects/${encodeURIComponent(projectKey)}/repo-config`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders(accessToken) },
      body: JSON.stringify({ repoUrl, installationToken }),
    },
  )
}

export function disconnectProjectGitHubRepo(apiBase: string, accessToken: string, projectKey: string) {
  return requestJson<GitHubRepoConfig>(
    `${apiBase}/v1/projects/${encodeURIComponent(projectKey)}/repo-config`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders(accessToken) },
      body: JSON.stringify({ repoUrl: null }),
    },
  )
}

// Partial patch: absent keys stay untouched, null (or '') clears a field.
export function updateProjectRepoConfig(
  apiBase: string,
  accessToken: string,
  projectKey: string,
  patch: Partial<Pick<RepoConfig, 'localPath' | 'devCommand' | 'testCommand' | 'agentInstructions'>>,
) {
  return requestJson<RepoConfig | null>(`${apiBase}/v1/projects/${encodeURIComponent(projectKey)}/repo-config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(accessToken) },
    body: JSON.stringify(patch),
  })
}

// Rename a project (display name only — public key/slug are immutable).
export function renameProject(apiBase: string, accessToken: string, projectKey: string, name: string) {
  return requestJson<Project>(`${apiBase}/v1/projects/${encodeURIComponent(projectKey)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(accessToken) },
    body: JSON.stringify({ name }),
  })
}

// Replace the project's domain allowlist. An empty array disables the
// restriction (comments accepted from any origin).
export function updateProjectAllowedOrigins(apiBase: string, accessToken: string, projectKey: string, allowedOrigins: string[]) {
  return requestJson<Project>(`${apiBase}/v1/projects/${encodeURIComponent(projectKey)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(accessToken) },
    body: JSON.stringify({ allowedOrigins }),
  })
}

export function listProjectInvites(apiBase: string, accessToken: string, projectKey: string) {
  return requestJson<ProjectInvite[]>(`${apiBase}/v1/projects/${encodeURIComponent(projectKey)}/invites`, {
    headers: { ...authHeaders(accessToken) },
  })
}

export function inviteProjectMember(apiBase: string, accessToken: string, projectKey: string, email: string, role: 'admin' | 'member' | 'guest' = 'member') {
  return requestJson<ProjectInvite>(`${apiBase}/v1/projects/${encodeURIComponent(projectKey)}/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(accessToken) },
    body: JSON.stringify({ email, role }),
  })
}

export function cancelProjectInvite(apiBase: string, accessToken: string, projectKey: string, email: string) {
  const query = new URLSearchParams({ email })
  return requestJson<{ projectKey: string; email: string }>(
    `${apiBase}/v1/projects/${encodeURIComponent(projectKey)}/invites?${query.toString()}`,
    { method: 'DELETE', headers: { ...authHeaders(accessToken) } },
  )
}

export type NotificationKind = 'invite.received' | 'invite.accepted' | 'invite.declined' | 'comment.activity'

export interface Notification {
  id: string
  userId: string
  kind: NotificationKind
  payload: Record<string, unknown>
  readAt: string | null
  createdAt: string
}

export function listNotifications(apiBase: string, accessToken: string, opts: { unreadOnly?: boolean } = {}) {
  const suffix = opts.unreadOnly ? '?unreadOnly=true' : ''
  return requestJson<Notification[]>(`${apiBase}/v1/notifications${suffix}`, {
    headers: { ...authHeaders(accessToken) },
  })
}

export function markNotificationRead(apiBase: string, accessToken: string, id: string) {
  return requestJson<{ id: string }>(`${apiBase}/v1/notifications/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken) },
  })
}

export function markAllNotificationsRead(apiBase: string, accessToken: string) {
  return requestJson<{ ok: true }>(`${apiBase}/v1/notifications/read-all`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken) },
  })
}

// Pending invites addressed to the current user (across all projects).
export function listInvites(apiBase: string, accessToken: string) {
  return requestJson<ProjectInvite[]>(`${apiBase}/v1/invites`, {
    headers: { ...authHeaders(accessToken) },
  })
}

export function acceptInvite(apiBase: string, accessToken: string, projectKey: string) {
  return requestJson<{ projectKey: string }>(`${apiBase}/v1/invites/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(accessToken) },
    body: JSON.stringify({ projectKey }),
  })
}

export function declineInvite(apiBase: string, accessToken: string, projectKey: string) {
  return requestJson<{ projectKey: string }>(`${apiBase}/v1/invites/decline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(accessToken) },
    body: JSON.stringify({ projectKey }),
  })
}

export function listComments(apiBase: string, accessToken: string, projectId: string, pageUrl?: string) {
  const query = new URLSearchParams()
  if (pageUrl) query.set('pageUrl', pageUrl)
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return requestJson<CommentRecord[]>(`${apiBase}/v1/projects/${encodeURIComponent(projectId)}/comments${suffix}`, {
    headers: {
      ...authHeaders(accessToken),
    },
  })
}

export function updateCommentVisibility(
  apiBase: string,
  accessToken: string,
  commentId: string,
  visibility: 'shared' | 'internal',
) {
  return requestJson<CommentRecord>(`${apiBase}/v1/comments/${encodeURIComponent(commentId)}/visibility`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(accessToken) },
    body: JSON.stringify({ visibility }),
  })
}

export function updateReviewStatus(apiBase: string, accessToken: string, commentId: string, reviewStatus: CommentRecord['reviewStatus']) {
  return requestJson<CommentRecord>(`${apiBase}/v1/comments/${encodeURIComponent(commentId)}/review-status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(accessToken),
    },
    body: JSON.stringify({ reviewStatus }),
  })
}

export function updateImplementationStatus(apiBase: string, accessToken: string, commentId: string, implementationStatus: CommentRecord['implementationStatus']) {
  return requestJson<CommentRecord>(`${apiBase}/v1/comments/${encodeURIComponent(commentId)}/implementation-status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(accessToken),
    },
    body: JSON.stringify({ implementationStatus }),
  })
}

export function listExtensionComments(apiBase: string, accessToken: string, page = 1) {
  return requestJson<ExtensionCommentsPage>(`${apiBase}/v1/extension/comments?page=${page}&limit=20`, {
    headers: { ...authHeaders(accessToken) },
  })
}

export function updateExtensionComment(apiBase: string, accessToken: string, commentId: string, body: string) {
  return requestJson<ExtensionCommentRecord>(`${apiBase}/v1/extension/comments/${encodeURIComponent(commentId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(accessToken) },
    body: JSON.stringify({ body }),
  })
}

export function assignExtensionComment(apiBase: string, accessToken: string, commentId: string, projectId: string) {
  return requestJson<ExtensionCommentRecord>(`${apiBase}/v1/extension/comments/${encodeURIComponent(commentId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(accessToken) },
    body: JSON.stringify({ projectId }),
  })
}

export async function deleteExtensionComment(apiBase: string, accessToken: string, commentId: string) {
  const response = await fetch(`${apiBase}/v1/extension/comments/${encodeURIComponent(commentId)}`, {
    method: 'DELETE', headers: { ...authHeaders(accessToken) },
  })
  if (!response.ok) throw new Error(await response.text() || `Request failed with ${response.status}`)
}

export function getExternalWorkDraft(apiBase: string, accessToken: string, commentId: string, provider: ExternalWorkProvider = 'github') {
  return requestJson<ExternalWorkDraft>(
    `${apiBase}/v1/comments/${encodeURIComponent(commentId)}/external-work?provider=${provider}`,
    { headers: { ...authHeaders(accessToken) } },
  )
}

export function sendExternalWork(
  apiBase: string,
  accessToken: string,
  commentId: string,
  provider: ExternalWorkProvider,
  draft: { title: string; body: string },
) {
  return requestJson<{ issueNumber?: number; issueUrl?: string; externalId?: string; externalKey?: string; externalUrl?: string; createdAt: string; created: boolean }>(
    `${apiBase}/v1/comments/${encodeURIComponent(commentId)}/external-work`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(accessToken) },
      body: JSON.stringify({ provider, draft }),
    },
  )
}

export function retryExternalWorkSync(apiBase: string, accessToken: string, commentId: string) {
  return requestJson<{ externalWork: ExternalWorkRecord[] }>(
    `${apiBase}/v1/comments/${encodeURIComponent(commentId)}/external-work-sync`,
    { method: 'POST', headers: { ...authHeaders(accessToken) } },
  )
}

export function createCommentGithubIssue(
  apiBase: string,
  accessToken: string,
  commentId: string,
  draft?: { title: string; body: string },
) {
  return draft
    ? sendExternalWork(apiBase, accessToken, commentId, 'github', draft) as Promise<GitHubIssueCreationResponse>
    : requestJson<GitHubIssueCreationResponse>(
        `${apiBase}/v1/comments/${encodeURIComponent(commentId)}/external-work`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders(accessToken) },
          body: JSON.stringify({ provider: 'github' }),
        },
      )
}

export function getLinearIntegration(apiBase: string, accessToken: string, projectKey: string, authorize = false) {
  return requestJson<ProjectTrackerIntegration & { authorizeUrl?: string }>(
    `${apiBase}/v1/projects/${encodeURIComponent(projectKey)}/integrations/linear${authorize ? '?action=authorize' : ''}`,
    { cache: 'no-store', headers: { ...authHeaders(accessToken) } },
  )
}

export function selectLinearTeam(apiBase: string, accessToken: string, projectKey: string, containerId: string) {
  return requestJson<ProjectTrackerIntegration>(
    `${apiBase}/v1/projects/${encodeURIComponent(projectKey)}/integrations/linear`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders(accessToken) }, body: JSON.stringify({ containerId }) },
  )
}

export function disconnectLinear(apiBase: string, accessToken: string, projectKey: string) {
  return requestJson<void>(
    `${apiBase}/v1/projects/${encodeURIComponent(projectKey)}/integrations/linear`,
    { method: 'DELETE', headers: { ...authHeaders(accessToken) } },
  )
}

export function getJiraIntegration(apiBase: string, accessToken: string, projectKey: string, authorize = false) {
  return requestJson<ProjectTrackerIntegration & { authorizeUrl?: string }>(
    `${apiBase}/v1/projects/${encodeURIComponent(projectKey)}/integrations/jira${authorize ? '?action=authorize' : ''}`,
    { cache: 'no-store', headers: { ...authHeaders(accessToken) } },
  )
}

export function selectJiraProject(apiBase: string, accessToken: string, projectKey: string, containerId: string) {
  return requestJson<ProjectTrackerIntegration>(
    `${apiBase}/v1/projects/${encodeURIComponent(projectKey)}/integrations/jira`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders(accessToken) }, body: JSON.stringify({ containerId }) },
  )
}

export function disconnectJira(apiBase: string, accessToken: string, projectKey: string) {
  return requestJson<void>(
    `${apiBase}/v1/projects/${encodeURIComponent(projectKey)}/integrations/jira`,
    { method: 'DELETE', headers: { ...authHeaders(accessToken) } },
  )
}

export function createShare(apiBase: string, accessToken: string, body: Record<string, unknown>) {
  return requestJson<ShareCreationResponse>(`${apiBase}/v1/feedback-shares`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(accessToken),
    },
    body: JSON.stringify(body),
  })
}

export function getPrompt(apiBase: string, accessToken: string, shareId: string, target: 'codex' | 'claude-code' | 'generic') {
  return requestJson<{ prompt: string, tokenUrl: string }>(
    `${apiBase}/v1/feedback-shares/${encodeURIComponent(shareId)}/prompt?target=${encodeURIComponent(target)}`,
    {
      headers: {
        ...authHeaders(accessToken),
      },
    },
  )
}

export function fetchProjectSession(apiBase: string, projectKey: string) {
  return requestJson<ProjectSessionResponse>(
    `${apiBase}/v1/public/project?projectKey=${encodeURIComponent(projectKey)}`,
  )
}

export function getPromptByShare(
  apiBase: string,
  slug: string,
  token: string,
  target: 'codex' | 'claude-code' | 'generic',
) {
  return requestJson<SharePromptResponse>(
    `${apiBase}/v1/shares/${encodeURIComponent(slug)}/prompt?target=${encodeURIComponent(target)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
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

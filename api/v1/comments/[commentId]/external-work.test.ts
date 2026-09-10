import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../_lib/auth.js', () => ({ requireProjectCapability: vi.fn(), requireProjectCommentCapability: vi.fn(), requireUser: vi.fn() }))
vi.mock('../../../_lib/linear-connection.js', () => ({ getLinearAccessToken: vi.fn() }))
vi.mock('../../../_lib/linear.js', () => ({ createLinearIssue: vi.fn() }))
vi.mock('../../../_lib/jira-connection.js', () => ({ getJiraAccessToken: vi.fn() }))
vi.mock('../../../_lib/jira.js', () => ({ createJiraIssue: vi.fn(), getJiraDestinations: vi.fn() }))
vi.mock('../../../_lib/store.js', () => ({
  claimCommentExternalWork: vi.fn(), finalizeCommentExternalWork: vi.fn(), getComment: vi.fn(), getCommentExternalWork: vi.fn(),
  getCommentForGithubIssue: vi.fn(), getGithubIssueConnection: vi.fn(), getProjectIntegration: vi.fn(), markCommentExternalWorkUncertain: vi.fn(),
  releaseCommentExternalWork: vi.fn(), updateReviewStatus: vi.fn(),
}))
vi.mock('./github-issue.js', () => ({ default: vi.fn() }))

import handler from './external-work.js'
import githubIssueHandler from './github-issue.js'
import { requireProjectCapability, requireProjectCommentCapability, requireUser } from '../../../_lib/auth.js'
import { getLinearAccessToken } from '../../../_lib/linear-connection.js'
import { createLinearIssue } from '../../../_lib/linear.js'
import { getJiraAccessToken } from '../../../_lib/jira-connection.js'
import { createJiraIssue, getJiraDestinations } from '../../../_lib/jira.js'
import { claimCommentExternalWork, finalizeCommentExternalWork, getComment, getCommentExternalWork, getCommentForGithubIssue, getGithubIssueConnection, getProjectIntegration, markCommentExternalWorkUncertain, releaseCommentExternalWork, updateReviewStatus } from '../../../_lib/store.js'

function response() {
  return { statusCode: 200, body: null as unknown, headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this }, json(body: unknown) { this.body = body; return this },
    end() { return this }, setHeader(key: string, value: string) { this.headers[key] = value } }
}
const call = (req: unknown, res: unknown) => (handler as unknown as (request: unknown, response: unknown) => Promise<unknown>)(req, res)
const post = (draft: unknown = { title: 'Title', body: 'Body' }) => ({ method: 'POST', query: { commentId: 'c' }, body: { provider: 'linear', draft }, headers: {} })

const comment = { id: 'c', projectId: 'p', body: 'Move the CTA above the fold', authorName: 'Client', pageUrl: 'https://example.com', imageUrl: null, selector: '#cta', x: 10, y: 20, targetType: 'element_point' as const, anchor: null, reviewStatus: 'accepted', githubIssue: null }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireUser).mockResolvedValue({ userId: 'u', email: 'u@example.com' })
  vi.mocked(requireProjectCommentCapability).mockResolvedValue({ role: 'member' })
  vi.mocked(requireProjectCapability).mockResolvedValue({ role: 'member' })
  vi.mocked(getComment).mockResolvedValue(comment as never)
  vi.mocked(getCommentForGithubIssue).mockResolvedValue(comment as never)
  vi.mocked(getGithubIssueConnection).mockResolvedValue({ owner: 'acme', repo: 'store', installationId: 1, connectionVersion: 'v' } as never)
  vi.mocked(getCommentExternalWork).mockResolvedValue(null)
  vi.mocked(getProjectIntegration).mockImplementation(async (_project, provider) => ({
    id: 'integration', containerId: provider === 'jira' ? '100' : 'team',
    containerName: 'WEB · Web', workspaceId: provider === 'jira' ? 'cloud' : 'workspace',
  } as never))
  vi.mocked(getLinearAccessToken).mockResolvedValue('linear-token')
  vi.mocked(getJiraAccessToken).mockResolvedValue('jira-token')
  vi.mocked(getJiraDestinations).mockResolvedValue([{
    id: 'cloud:100', cloudId: 'cloud', siteName: 'Acme Jira', siteUrl: 'https://acme.atlassian.net',
    projectId: '100', projectKey: 'WEB', projectName: 'Website',
  }])
  vi.mocked(claimCommentExternalWork).mockImplementation(async (input) => ({ id: 'work', state: 'creating', leaseToken: input.leaseToken } as never))
  vi.mocked(markCommentExternalWorkUncertain).mockResolvedValue(true)
  vi.mocked(createLinearIssue).mockResolvedValue({ externalId: 'issue', externalKey: 'WEB-1', externalUrl: 'https://linear.app/issue/WEB-1' })
  vi.mocked(createJiraIssue).mockResolvedValue({ externalId: 'jira-issue', externalKey: 'WEB-2', externalUrl: 'https://acme.atlassian.net/browse/WEB-2' })
  vi.mocked(finalizeCommentExternalWork).mockResolvedValue({ createdAt: 'now' } as never)
})

describe('external work endpoint', () => {
  it('prepares a deterministic editable GitHub draft without exposing credentials', async () => {
    const res = response()
    await call({ method: 'GET', query: { commentId: 'c', provider: 'github' }, headers: {} }, res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ provider: 'github', connected: true, destination: 'acme/store', draft: { title: expect.stringContaining('Move the CTA'), body: expect.stringContaining('Move the CTA') } })
    expect(JSON.stringify(res.body)).not.toContain('installationId')
  })

  it('dispatches sends through the provider adapter and rejects unsupported providers', async () => {
    const req = { method: 'POST', query: { commentId: 'c' }, body: { provider: 'github', draft: { title: 'T', body: 'B' } }, headers: {} }
    const res = response()
    await call(req, res)
    expect(githubIssueHandler).toHaveBeenCalledWith(req, res)

    const unsupported = response()
    await call({ ...req, body: { provider: 'asana' } }, unsupported)
    expect(unsupported.statusCode).toBe(400)
  })

  it('conceals inaccessible feedback', async () => {
    vi.mocked(requireProjectCommentCapability).mockResolvedValueOnce(null)
    const res = response()
    await call({ method: 'GET', query: { commentId: 'c', provider: 'github' }, headers: {} }, res)
    expect(res.body).toBeNull()
    expect(getCommentForGithubIssue).not.toHaveBeenCalled()
  })

  it('validates methods, authentication, identifiers, and comment scope', async () => {
    let res = response()
    await call({ method: 'OPTIONS', query: {}, headers: {} }, res)
    expect(res.statusCode).toBe(204)

    res = response()
    await call({ method: 'PATCH', query: {}, headers: {} }, res)
    expect(res.statusCode).toBe(405)

    vi.mocked(requireUser).mockResolvedValueOnce(null)
    res = response()
    await call({ method: 'GET', query: { provider: 'github' }, headers: {} }, res)
    expect(res.body).toBeNull()

    res = response()
    await call({ method: 'GET', query: { provider: 'github' }, headers: {} }, res)
    expect(res.statusCode).toBe(400)

    vi.mocked(getComment).mockResolvedValueOnce(null)
    res = response()
    await call({ method: 'GET', query: { commentId: 'c', provider: 'github' }, headers: {} }, res)
    expect(res.statusCode).toBe(404)

    vi.mocked(getComment).mockResolvedValueOnce({ ...comment, projectId: null } as never)
    res = response()
    await call({ method: 'GET', query: { commentId: 'c', provider: 'github' }, headers: {} }, res)
    expect(res.statusCode).toBe(404)

    vi.mocked(getCommentForGithubIssue).mockResolvedValueOnce(null)
    res = response()
    await call({ method: 'GET', query: { commentId: 'c', provider: 'github' }, headers: {} }, res)
    expect(res.statusCode).toBe(404)
  })

  it('reports disconnected projects, existing issues, and safe preparation failures', async () => {
    const existing = { issueNumber: 7, issueUrl: 'https://github.com/acme/store/issues/7', createdAt: 'now' }
    vi.mocked(getGithubIssueConnection).mockResolvedValueOnce(null)
    vi.mocked(getCommentForGithubIssue).mockResolvedValueOnce({ ...comment, githubIssue: existing } as never)
    let res = response()
    await call({ method: 'GET', query: { commentId: 'c', provider: 'github' }, headers: {} }, res)
    expect(res.body).toMatchObject({ connected: false, destination: null, existing })

    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getComment).mockRejectedValueOnce(new Error('database secret'))
    res = response()
    await call({ method: 'GET', query: { commentId: 'c', provider: 'github' }, headers: {} }, res)
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Could not prepare external work' })
  })

  it('prepares and durably creates Linear work before accepting feedback', async () => {
    const prepared = response()
    await call({ method: 'GET', query: { commentId: 'c', provider: 'linear' }, headers: {} }, prepared)
    expect(prepared.body).toMatchObject({ provider: 'linear', connected: true, destination: 'WEB · Web' })

    const created = response()
    await call({ method: 'POST', query: { commentId: 'c' }, body: { provider: 'linear', draft: { title: 'Edited', body: 'Details' } }, headers: {} }, created)
    expect(created.statusCode).toBe(201)
    expect(createLinearIssue).toHaveBeenCalledWith('linear-token', { teamId: 'team', title: 'Edited', description: 'Details' })
    expect(finalizeCommentExternalWork).toHaveBeenCalledWith(expect.objectContaining({
      externalKey: 'WEB-1', workspaceId: 'workspace', containerId: 'team',
    }))
  })

  it('prepares disconnected and already-created Linear work without leaking tokens', async () => {
    vi.mocked(getProjectIntegration).mockResolvedValueOnce(null)
    let res = response()
    await call({ method: 'GET', query: { commentId: 'c', provider: 'linear' }, headers: {} }, res)
    expect(res.body).toMatchObject({ connected: false, destination: null, existing: null })

    vi.mocked(getCommentExternalWork).mockResolvedValueOnce({ state: 'created', externalId: 'i', externalKey: 'WEB-1', externalUrl: 'url', createdAt: 'now' } as never)
    res = response()
    await call({ method: 'GET', query: { commentId: 'c', provider: 'linear' }, headers: {} }, res)
    expect(res.body).toMatchObject({ existing: { externalKey: 'WEB-1', externalUrl: 'url' } })
    expect(JSON.stringify(res.body)).not.toContain('linear-token')
  })

  it('rejects rejected feedback, missing connections, and malformed drafts', async () => {
    vi.mocked(getCommentForGithubIssue).mockResolvedValueOnce({ ...comment, reviewStatus: 'rejected' } as never)
    let res = response()
    await call(post(), res)
    expect(res.statusCode).toBe(409)

    vi.mocked(getProjectIntegration).mockResolvedValueOnce(null)
    res = response()
    await call(post(), res)
    expect(res.statusCode).toBe(409)

    for (const draft of [{ title: 1, body: 'Body' }, { title: 'Title', body: 1 }, { title: ' ', body: 'Body' }, { title: 'Title', body: ' ' }]) {
      res = response()
      await call(post(draft), res)
      expect(res.statusCode).toBe(400)
    }
  })

  it('returns existing records and accepted claims without duplicate creation', async () => {
    const existing = { state: 'created', externalId: 'i', externalKey: 'WEB-1', externalUrl: 'url', createdAt: 'now' }
    vi.mocked(getCommentExternalWork).mockResolvedValueOnce(existing as never)
    vi.mocked(getCommentForGithubIssue).mockResolvedValueOnce({ ...comment, reviewStatus: 'open' } as never)
    let res = response()
    await call(post(), res)
    expect(res.body).toMatchObject({ created: false, externalUrl: 'url' })
    expect(updateReviewStatus).toHaveBeenCalled()

    vi.mocked(getCommentExternalWork).mockResolvedValueOnce(existing as never)
    res = response()
    await call(post(), res)
    expect(res.body).toMatchObject({ created: false })

    vi.mocked(claimCommentExternalWork).mockResolvedValueOnce(existing as never)
    res = response()
    await call(post(), res)
    expect(res.body).toMatchObject({ created: false, externalUrl: 'url' })
  })

  it('reports active and uncertain competing claims', async () => {
    for (const claim of [null, { state: 'creating', leaseToken: 'other', uncertainAt: null }, { state: 'creating', leaseToken: 'other', uncertainAt: 'now' }]) {
      vi.mocked(claimCommentExternalWork).mockResolvedValueOnce(claim as never)
      const res = response()
      await call(post(), res)
      expect(res.statusCode).toBe(409)
    }
  })

  it('releases a claim when authorization changes and protects the provider call fence', async () => {
    vi.mocked(requireProjectCapability).mockResolvedValueOnce(null)
    let res = response()
    await call(post(), res)
    expect(releaseCommentExternalWork).toHaveBeenCalled()
    expect(createLinearIssue).not.toHaveBeenCalled()

    vi.mocked(markCommentExternalWorkUncertain).mockResolvedValueOnce(false)
    res = response()
    await call(post(), res)
    expect(res.statusCode).toBe(409)

    vi.mocked(finalizeCommentExternalWork).mockResolvedValueOnce(null)
    res = response()
    await call(post(), res)
    expect(res.statusCode).toBe(502)
  })

  it('releases only deterministic provider failures and returns safe creation errors', async () => {
    for (const failure of [new Error('linear_request_failed'), new Error('linear_issue_create_failed')]) {
      vi.mocked(createLinearIssue).mockRejectedValueOnce(failure)
      const res = response()
      await call(post(), res)
      expect(res.statusCode).toBe(502)
    }
    expect(releaseCommentExternalWork).toHaveBeenCalledTimes(2)

    vi.mocked(createLinearIssue).mockRejectedValueOnce(new Error('linear_result_indeterminate'))
    let res = response()
    await call(post(), res)
    expect(res.statusCode).toBe(502)
    expect(releaseCommentExternalWork).toHaveBeenCalledTimes(2)

    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getComment).mockRejectedValueOnce('opaque')
    res = response()
    await call(post(), res)
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'External issue creation failed' })
  })

  it('creates Jira work in the project selected by an admin', async () => {
    const created = response()
    await call({
      method: 'POST', query: { commentId: 'c' },
      body: { provider: 'jira', draft: { title: 'Edited for Jira', body: 'Jira details' } }, headers: {},
    }, created)
    expect(created.statusCode).toBe(201)
    expect(getJiraDestinations).toHaveBeenCalledWith('jira-token')
    expect(createJiraIssue).toHaveBeenCalledWith('jira-token', {
      cloudId: 'cloud', siteUrl: 'https://acme.atlassian.net', projectId: '100',
      title: 'Edited for Jira', description: 'Jira details',
    })
    expect(finalizeCommentExternalWork).toHaveBeenCalledWith(expect.objectContaining({
      externalKey: 'WEB-2', workspaceId: 'cloud', containerId: '100',
    }))
  })

  it('rejects Jira creation when the selected project is no longer available', async () => {
    vi.mocked(getJiraDestinations).mockResolvedValueOnce([])
    const res = response()
    await call({
      method: 'POST', query: { commentId: 'c' },
      body: { provider: 'jira', draft: { title: 'Edited for Jira', body: 'Jira details' } }, headers: {},
    }, res)
    expect(res.statusCode).toBe(502)
    expect(createJiraIssue).not.toHaveBeenCalled()
    expect(releaseCommentExternalWork).toHaveBeenCalled()
  })
})

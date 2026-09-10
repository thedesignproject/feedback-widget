import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase.js', () => ({ getServiceSupabase: vi.fn() }))

import { getServiceSupabase } from './supabase.js'
import {
  claimCommentGithubIssue,
  deleteCommentById,
  finalizeCommentGithubIssue,
  getCommentForGithubIssue,
  getGithubIssueConnection,
  listComments,
  listProjectComments,
  markCommentGithubIssueUncertain,
  resetCommentGithubIssueAttempt,
  releaseCommentGithubIssue,
} from './store.js'

type Result = { data: unknown; error: { message: string } | null }

const row = {
  id: 'comment-1',
  project_id: 'project-1',
  url: 'https://example.com',
  x: 10,
  y: 20,
  element: '#hero',
  comment: 'Increase contrast',
  status: 'approved',
  implementation_status: 'unassigned',
  claimed_by_agent_id: null,
  image_url: null,
  author_name: 'Ada',
  target_type: 'element_point',
  anchor: null,
  github_issue_number: 42,
  github_issue_url: 'https://github.com/acme/site/issues/42',
  github_issue_created_at: '2026-07-23T12:00:00.000Z',
  github_issue_lease_token: 'lease',
  github_issue_lease_expires_at: '2026-07-23T12:05:00.000Z',
  github_issue_uncertain_at: null,
  created_at: '2026-07-23T11:00:00.000Z',
  updated_at: null,
}

function chain(result: Result) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'update', 'delete', 'eq', 'is', 'or', 'order']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve: (value: Result) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function mockResult(result: Result) {
  const builder = chain(result)
  vi.mocked(getServiceSupabase).mockReturnValue({
    from: vi.fn(() => builder),
  } as never)
  return builder
}

function mockRpcResult(result: Result) {
  const builder = chain(result)
  const rpc = vi.fn(() => builder)
  vi.mocked(getServiceSupabase).mockReturnValue({ rpc } as never)
  return { builder, rpc }
}

beforeEach(() => vi.mocked(getServiceSupabase).mockReset())

describe('comment GitHub issue persistence', () => {
  it('keeps issue metadata out of public comments and includes it for project comments', async () => {
    mockResult({ data: [row], error: null })
    expect((await listComments('project-1'))[0]).not.toHaveProperty('githubIssue')

    mockResult({ data: [{ ...row, comment_external_work: [
      {
        state: 'created', provider: 'github', external_id: '42', external_key: '#42', external_url: row.github_issue_url,
        lifecycle_status: 'closed', closed_at: '2026-07-24T12:00:00.000Z', created_at: row.github_issue_created_at, updated_at: '2026-07-24T12:00:00.000Z',
      },
      {
        state: 'created', provider: 'linear', external_id: 'linear-id', external_key: 'WEB-7', external_url: 'https://linear.app/issue/WEB-7',
        lifecycle_status: 'failed', last_sync_error: 'linear_request_failed', closed_at: null, created_at: row.github_issue_created_at, updated_at: row.github_issue_created_at,
      },
      {
        state: 'creating', provider: 'jira', external_id: null, external_key: null, external_url: null,
        lifecycle_status: 'active', closed_at: null, created_at: row.github_issue_created_at, updated_at: row.github_issue_created_at,
      },
    ] }], error: null })
    const projectComment = (await listProjectComments('project-1'))[0]
    expect(projectComment.githubIssue).toEqual({
      issueNumber: 42,
      issueUrl: row.github_issue_url,
      createdAt: row.github_issue_created_at,
    })
    expect(projectComment.externalWork).toEqual([
      expect.objectContaining({ provider: 'github', externalKey: '#42', lifecycleStatus: 'closed' }),
      expect.objectContaining({ provider: 'linear', externalKey: 'WEB-7', lifecycleStatus: 'failed', syncAction: 'retry' }),
    ])

    mockResult({ data: [{ ...row, comment_external_work: [] }], error: null })
    expect((await listProjectComments('project-1'))[0].externalWork).toEqual([
      expect.objectContaining({ provider: 'github', externalKey: '#42', lifecycleStatus: 'active' }),
    ])

    const guestBuilder = mockResult({ data: [row], error: null })
    expect((await listProjectComments('project-1', {
      visibility: 'shared', includeExternalWork: false,
    }))[0]).not.toHaveProperty('githubIssue')
    expect(guestBuilder.select).toHaveBeenCalledWith(expect.not.stringContaining('github_issue_url'))
    expect(guestBuilder.select).toHaveBeenCalledWith(expect.not.stringContaining('comment_external_work'))
  })

  it('maps an incomplete issue as null and applies project filters', async () => {
    const builder = mockResult({
      data: [{ ...row, github_issue_url: null }],
      error: null,
    })
    const comments = await listProjectComments('project-1', {
      pageUrl: row.url,
      reviewStatus: 'accepted',
      implementationStatus: 'done',
    })
    expect(comments[0].githubIssue).toBeNull()
    expect(builder.eq).toHaveBeenCalledTimes(4)

    mockResult({ data: null, error: null })
    await expect(listProjectComments('project-1')).resolves.toEqual([])
  })

  it('loads private issue state without exposing it in the mapped issue', async () => {
    mockResult({ data: row, error: null })
    const comment = await getCommentForGithubIssue('project-1', 'comment-1')
    expect(comment?.githubIssueLeaseToken).toBe('lease')
    expect(comment?.githubIssueUncertainAt).toBeNull()
    expect(comment?.githubIssue).toBeTruthy()

    const {
      github_issue_lease_token: _token,
      github_issue_lease_expires_at: _expiry,
      github_issue_uncertain_at: _uncertain,
      ...legacyRow
    } = row
    mockResult({ data: legacyRow, error: null })
    await expect(getCommentForGithubIssue('project-1', 'comment-1')).resolves.toMatchObject({
      githubIssueLeaseToken: null,
      githubIssueLeaseExpiresAt: null,
      githubIssueUncertainAt: null,
    })

    mockResult({ data: null, error: null })
    await expect(getCommentForGithubIssue('project-1', 'missing')).resolves.toBeNull()
  })

  it('claims through the project-scoped database clock RPC', async () => {
    const { rpc } = mockRpcResult({ data: { ...row, github_issue_number: null }, error: null })
    const claimed = await claimCommentGithubIssue(
      'project-1',
      'comment-1',
      'new-lease',
      1_000,
      true,
    )
    expect(claimed?.id).toBe('comment-1')
    expect(rpc).toHaveBeenCalledWith('claim_comment_github_issue', {
      p_comment_id: 'comment-1',
      p_project_key: 'project-1',
      p_lease_token: 'new-lease',
      p_lease_seconds: 1,
      p_recovery: true,
    })

    mockRpcResult({ data: null, error: null })
    await expect(claimCommentGithubIssue('project-1', 'comment-1', 'lease', Number.NaN))
      .resolves.toBeNull()
  })

  it('finalizes, releases, and marks uncertain through fenced RPCs', async () => {
    const finalize = mockRpcResult({ data: true, error: null })
    await expect(finalizeCommentGithubIssue('project-1', 'comment-1', 'lease', {
      issueNumber: 42,
      issueUrl: row.github_issue_url,
      createdAt: row.github_issue_created_at,
    })).resolves.toBe(true)
    expect(finalize.rpc).toHaveBeenCalledWith('finalize_comment_github_issue', expect.objectContaining({
      p_project_key: 'project-1',
      p_lease_token: 'lease',
    }))

    mockRpcResult({ data: false, error: null })
    await expect(releaseCommentGithubIssue('project-1', 'comment-1', 'wrong')).resolves.toBe(false)

    mockRpcResult({ data: true, error: null })
    await expect(markCommentGithubIssueUncertain('project-1', 'comment-1', 'lease'))
      .resolves.toBe(true)

    mockRpcResult({ data: true, error: null })
    await expect(resetCommentGithubIssueAttempt('project-1', 'comment-1', 'lease'))
      .resolves.toBe(true)
  })

  it('returns only complete private repository connections', async () => {
    mockResult({ data: {
      github_owner: 'acme',
      github_repo: 'site',
      github_installation_id: '99',
      github_connection_version: 3,
    }, error: null })
    await expect(getGithubIssueConnection('project-1')).resolves.toEqual({
      owner: 'acme',
      repo: 'site',
      installationId: '99',
      connectionVersion: 3,
    })

    mockResult({ data: null, error: null })
    await expect(getGithubIssueConnection('project-1')).resolves.toBeNull()
  })

  it('surfaces database errors from every operation', async () => {
    const failure = { data: null, error: { message: 'database unavailable' } }
    for (const operation of [
      () => listProjectComments('project-1'),
      () => getCommentForGithubIssue('project-1', 'comment-1'),
      () => getGithubIssueConnection('project-1'),
      () => deleteCommentById('comment-1', 'project-1'),
    ]) {
      mockResult(failure)
      await expect(operation()).rejects.toThrow('database unavailable')
    }
    for (const operation of [
      () => claimCommentGithubIssue('project-1', 'comment-1', 'lease'),
      () => finalizeCommentGithubIssue('project-1', 'comment-1', 'lease', {
        issueNumber: 1,
        issueUrl: 'https://github.com/acme/site/issues/1',
        createdAt: new Date().toISOString(),
      }),
      () => releaseCommentGithubIssue('project-1', 'comment-1', 'lease'),
      () => markCommentGithubIssueUncertain('project-1', 'comment-1', 'lease'),
      () => resetCommentGithubIssueAttempt('project-1', 'comment-1', 'lease'),
    ]) {
      mockRpcResult(failure)
      await expect(operation()).rejects.toThrow('database unavailable')
    }
  })

  it('reports whether a project-scoped comment deletion matched a row', async () => {
    mockResult({ data: [{ id: 'comment-1' }], error: null })
    await expect(deleteCommentById('comment-1', 'project-1')).resolves.toBe(true)

    mockResult({ data: [], error: null })
    await expect(deleteCommentById('comment-1', 'project-1')).resolves.toBe(false)
  })
})

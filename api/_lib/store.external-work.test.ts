import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase.js', () => ({ getServiceSupabase: vi.fn() }))

import { getServiceSupabase } from './supabase.js'
import {
  acceptCommentIfOpen,
  cancelExternalWorkClose,
  claimCommentExternalWork,
  claimExternalWorkClose,
  completeExternalWorkClose,
  deleteProjectIntegration,
  finalizeCommentExternalWork,
  ensureGithubExternalWork,
  failExternalWorkClose,
  getCommentExternalWork,
  listCommentExternalWork,
  getProjectIntegration,
  markCommentExternalWorkUncertain,
  releaseCommentExternalWork,
  updateProjectIntegrationDestination,
  updateProjectIntegrationTokens,
  updateProjectIntegrationWorkspaceDestination,
  upsertProjectIntegration,
} from './store.js'

type Result = { data: unknown; error: { message: string; code?: string } | null }

const integrationRow = {
  id: 'integration', project_key: 'project', provider: 'linear', access_token_ciphertext: 'access',
  refresh_token_ciphertext: 'refresh', token_expires_at: null, granted_scopes: 'read,write', workspace_id: 'workspace', workspace_name: 'Acme',
  container_id: 'team', container_name: 'WEB · Web', created_by: 'user', created_at: 'created', updated_at: 'updated',
}
const workRow = {
  id: 'work', project_id: 'project', comment_id: 'comment', provider: 'linear', state: 'creating',
  workspace_id: null, container_id: null,
  external_id: null, external_key: null, external_url: null, lease_token: 'old-lease',
  lease_expires_at: '2999-01-01T00:00:00.000Z', uncertain_at: null, lifecycle_status: 'active',
  sync_lease_token: null, sync_lease_expires_at: null, last_sync_error: null,
  closed_at: null, created_at: 'created', updated_at: 'updated',
}

function builder(result: Result) {
  const value: Record<string, unknown> = {}
  for (const method of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'in', 'is', 'lt']) value[method] = vi.fn(() => value)
  value.single = vi.fn(() => Promise.resolve(result))
  value.maybeSingle = vi.fn(() => Promise.resolve(result))
  value.then = (resolve: (result: Result) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  return value
}

function queue(...results: Result[]) {
  const builders: Array<Record<string, unknown>> = []
  for (const result of results) {
    const value = builder(result)
    builders.push(value)
    vi.mocked(getServiceSupabase).mockReturnValueOnce({ from: vi.fn(() => value) } as never)
  }
  return builders
}

beforeEach(() => vi.mocked(getServiceSupabase).mockReset())

describe('external integration persistence', () => {
  it('maps, misses, and rejects project-integration reads', async () => {
    queue({ data: integrationRow, error: null }, { data: null, error: null }, { data: null, error: { message: 'read failed' } })
    await expect(getProjectIntegration('project', 'linear')).resolves.toMatchObject({ projectKey: 'project', workspaceName: 'Acme', containerId: 'team' })
    await expect(getProjectIntegration('project', 'linear')).resolves.toBeNull()
    await expect(getProjectIntegration('project', 'linear')).rejects.toThrow('read failed')
  })

  it('upserts integrations and surfaces write failures', async () => {
    const input = {
      projectKey: 'project', provider: 'linear' as const, accessTokenCiphertext: 'access', refreshTokenCiphertext: null,
      tokenExpiresAt: null, workspaceId: 'workspace', workspaceName: 'Acme', containerId: null, containerName: null, createdBy: 'user',
    }
    queue({ data: integrationRow, error: null }, { data: null, error: { message: 'upsert failed' } })
    await expect(upsertProjectIntegration(input)).resolves.toMatchObject({ id: 'integration', provider: 'linear' })
    await expect(upsertProjectIntegration(input)).rejects.toThrow('upsert failed')
  })

  it('updates destinations and tokens with nullable results and errors', async () => {
    queue(
      { data: integrationRow, error: null }, { data: null, error: null }, { data: null, error: { message: 'destination failed' } },
      { data: integrationRow, error: null }, { data: null, error: null }, { data: null, error: { message: 'workspace destination failed' } },
      { data: integrationRow, error: null }, { data: null, error: null }, { data: null, error: { message: 'token failed' } },
    )
    await expect(updateProjectIntegrationDestination('project', 'linear', 'team', 'WEB · Web')).resolves.toMatchObject({ containerName: 'WEB · Web' })
    await expect(updateProjectIntegrationDestination('project', 'linear', 'team', 'WEB · Web')).resolves.toBeNull()
    await expect(updateProjectIntegrationDestination('project', 'linear', 'team', 'WEB · Web')).rejects.toThrow('destination failed')
    const destination = {
      projectKey: 'project', provider: 'jira' as const, workspaceId: 'cloud', workspaceName: 'Acme Jira',
      containerId: '100', containerName: 'WEB · Website',
    }
    await expect(updateProjectIntegrationWorkspaceDestination(destination)).resolves.toMatchObject({ id: 'integration' })
    await expect(updateProjectIntegrationWorkspaceDestination(destination)).resolves.toBeNull()
    await expect(updateProjectIntegrationWorkspaceDestination(destination)).rejects.toThrow('workspace destination failed')
    const tokens = { id: 'integration', accessTokenCiphertext: 'new', refreshTokenCiphertext: null, tokenExpiresAt: null }
    await expect(updateProjectIntegrationTokens({ ...tokens, grantedScopes: 'read,write' })).resolves.toMatchObject({ id: 'integration' })
    await expect(updateProjectIntegrationTokens(tokens)).resolves.toBeNull()
    await expect(updateProjectIntegrationTokens(tokens)).rejects.toThrow('token failed')
  })

  it('deletes integrations and reports database errors', async () => {
    queue({ data: null, error: null }, { data: null, error: { message: 'delete failed' } })
    await expect(deleteProjectIntegration('project', 'linear')).resolves.toBeUndefined()
    await expect(deleteProjectIntegration('project', 'linear')).rejects.toThrow('delete failed')
  })

  it('maps, misses, and rejects external-work reads', async () => {
    queue({ data: workRow, error: null }, { data: null, error: null }, { data: null, error: { message: 'read failed' } })
    await expect(getCommentExternalWork('comment', 'linear')).resolves.toMatchObject({ commentId: 'comment', leaseToken: 'old-lease' })
    await expect(getCommentExternalWork('comment', 'linear')).resolves.toBeNull()
    await expect(getCommentExternalWork('comment', 'linear')).rejects.toThrow('read failed')
  })

  it('lists every created external-work record for a comment', async () => {
    const [list] = queue(
      { data: [{ ...workRow, state: 'created', workspace_id: 'workspace', container_id: 'team' }], error: null },
      { data: null, error: null },
      { data: null, error: { message: 'list failed' } },
    )
    await expect(listCommentExternalWork('comment')).resolves.toEqual([
      expect.objectContaining({ provider: 'linear', workspaceId: 'workspace', containerId: 'team' }),
    ])
    expect(list.eq).toHaveBeenCalledWith('comment_id', 'comment')
    expect(list.eq).toHaveBeenCalledWith('state', 'created')
    await expect(listCommentExternalWork('comment')).resolves.toEqual([])
    await expect(listCommentExternalWork('comment')).rejects.toThrow('list failed')
  })

  it('maps provider failures to safe remediation actions', async () => {
    const cases = [
      ['failed', 'provider_timeout', 'retry'],
      ['blocked', 'linear_reauthorization_required', 'reconnect'],
      ['blocked', 'jira_permission_denied', 'check_permissions'],
      ['blocked', 'jira_resource_not_found', 'check_issue'],
      ['blocked', 'jira_transition_fields_required', 'configure_workflow'],
      ['blocked', 'unknown_blocker', 'retry'],
      ['active', null, null],
    ] as const
    queue({ data: cases.map(([lifecycle, error]) => ({
      ...workRow, state: 'created', lifecycle_status: lifecycle, last_sync_error: error,
    })), error: null })
    await expect(listCommentExternalWork('comment')).resolves.toEqual(cases.map(([, , action]) => (
      expect.objectContaining({ syncAction: action })
    )))
  })

  it('bridges persisted GitHub issues into external work', async () => {
    const github = {
      ...workRow, provider: 'github', state: 'created', workspace_id: 'acme', container_id: 'acme/site',
      external_id: '7', external_key: '#7', external_url: 'https://github.com/acme/site/issues/7',
    }
    queue({ data: github, error: null }, { data: null, error: null }, { data: github, error: null }, { data: null, error: { message: 'bridge failed' } })
    const input = {
      projectId: 'project', commentId: 'comment', owner: 'acme', repo: 'site', issueNumber: 7,
      issueUrl: github.external_url, createdAt: 'created', leaseToken: 'lease',
    }
    await expect(ensureGithubExternalWork(input)).resolves.toMatchObject({ provider: 'github', externalKey: '#7' })
    await expect(ensureGithubExternalWork(input)).resolves.toMatchObject({ provider: 'github' })
    await expect(ensureGithubExternalWork(input)).rejects.toThrow('bridge failed')
  })

  it('claims, reclaims, completes, and fails external close work', async () => {
    const closing = { ...workRow, lifecycle_status: 'closing', sync_lease_token: 'lease', sync_lease_expires_at: 'later' }
    const closed = { ...closing, lifecycle_status: 'closed', sync_lease_token: null, sync_lease_expires_at: null, closed_at: 'now' }
    const failed = { ...closing, lifecycle_status: 'failed', sync_lease_token: null, sync_lease_expires_at: null, last_sync_error: 'failed' }
    const operations = queue(
      { data: closing, error: null },
      { data: null, error: null }, { data: closing, error: null },
      { data: null, error: null }, { data: null, error: null },
      { data: null, error: null }, { data: null, error: { message: 'reclaim failed' } },
      { data: null, error: { message: 'claim failed' } },
      { data: closed, error: null }, { data: null, error: null }, { data: null, error: { message: 'complete failed' } },
      { data: failed, error: null }, { data: null, error: null }, { data: null, error: { message: 'fail failed' } },
    )
    await expect(claimExternalWorkClose('work', 'lease')).resolves.toMatchObject({ lifecycleStatus: 'closing' })
    expect(operations[0].eq).toHaveBeenCalledWith('state', 'created')
    await expect(claimExternalWorkClose('work', 'lease')).resolves.toMatchObject({ lifecycleStatus: 'closing' })
    expect(operations[2].eq).toHaveBeenCalledWith('state', 'created')
    await expect(claimExternalWorkClose('work', 'lease')).resolves.toBeNull()
    await expect(claimExternalWorkClose('work', 'lease')).rejects.toThrow('reclaim failed')
    await expect(claimExternalWorkClose('work', 'lease')).rejects.toThrow('claim failed')
    await expect(completeExternalWorkClose('work', 'lease')).resolves.toMatchObject({ lifecycleStatus: 'closed' })
    expect(operations[8].eq).toHaveBeenCalledWith('state', 'created')
    await expect(completeExternalWorkClose('work', 'lease')).resolves.toBeNull()
    await expect(completeExternalWorkClose('work', 'lease')).rejects.toThrow('complete failed')
    await expect(failExternalWorkClose('work', 'lease', 'failed')).resolves.toMatchObject({ lastSyncError: 'failed' })
    expect(operations[11].eq).toHaveBeenCalledWith('state', 'created')
    await expect(failExternalWorkClose('work', 'lease', 'failed', true)).resolves.toBeNull()
    await expect(failExternalWorkClose('work', 'lease', 'failed')).rejects.toThrow('fail failed')
  })

  it('cancels close work with state and lease fences', async () => {
    const active = { ...workRow, state: 'created', lifecycle_status: 'active', sync_lease_token: null }
    const operations = queue(
      { data: active, error: null },
      { data: null, error: null },
      { data: null, error: { message: 'cancel failed' } },
    )
    await expect(cancelExternalWorkClose('work', 'lease')).resolves.toMatchObject({ lifecycleStatus: 'active' })
    expect(operations[0].eq).toHaveBeenCalledWith('id', 'work')
    expect(operations[0].eq).toHaveBeenCalledWith('state', 'created')
    expect(operations[0].eq).toHaveBeenCalledWith('sync_lease_token', 'lease')
    expect(operations[0].eq).toHaveBeenCalledWith('lifecycle_status', 'closing')
    await expect(cancelExternalWorkClose('work', 'lease')).resolves.toBeNull()
    await expect(cancelExternalWorkClose('work', 'lease')).rejects.toThrow('cancel failed')
  })

  it('accepts only open comments within the requested project', async () => {
    const accepted = {
      id: 'comment', project_id: 'project', url: null, x: null, y: null, element: null,
      comment: 'Feedback', status: 'approved', implementation_status: null, claimed_by_agent_id: null,
      image_url: null, author_name: null, target_type: null, anchor: null,
      created_at: 'created', updated_at: 'updated',
    }
    const operations = queue(
      { data: accepted, error: null },
      { data: null, error: null },
      { data: null, error: { message: 'accept failed' } },
    )
    await expect(acceptCommentIfOpen('project', 'comment')).resolves.toMatchObject({ reviewStatus: 'accepted' })
    expect(operations[0].eq).toHaveBeenCalledWith('id', 'comment')
    expect(operations[0].eq).toHaveBeenCalledWith('project_id', 'project')
    expect(operations[0].eq).toHaveBeenCalledWith('status', 'pending')
    await expect(acceptCommentIfOpen('project', 'comment')).resolves.toBeNull()
    await expect(acceptCommentIfOpen('project', 'comment')).rejects.toThrow('accept failed')
  })

  it('claims newly inserted work and rejects non-conflict insert failures', async () => {
    queue({ data: workRow, error: null }, { data: null, error: { message: 'insert failed', code: '500' } })
    await expect(claimCommentExternalWork({ projectId: 'project', commentId: 'comment', provider: 'linear', leaseToken: 'new' }))
      .resolves.toMatchObject({ id: 'work' })
    await expect(claimCommentExternalWork({ projectId: 'project', commentId: 'comment', provider: 'linear', leaseToken: 'new' }))
      .rejects.toThrow('insert failed')
  })

  it('returns conflicting work that is absent, completed, uncertain, or still leased', async () => {
    const duplicate = { data: null, error: { message: 'duplicate', code: '23505' } }
    queue(duplicate, { data: null, error: null })
    await expect(claimCommentExternalWork({ projectId: 'project', commentId: 'comment', provider: 'linear', leaseToken: 'new' })).resolves.toBeNull()
    queue(duplicate, { data: { ...workRow, state: 'created' }, error: null })
    await expect(claimCommentExternalWork({ projectId: 'project', commentId: 'comment', provider: 'linear', leaseToken: 'new' })).resolves.toMatchObject({ state: 'created' })
    queue(duplicate, { data: { ...workRow, uncertain_at: 'now' }, error: null })
    await expect(claimCommentExternalWork({ projectId: 'project', commentId: 'comment', provider: 'linear', leaseToken: 'new' })).resolves.toMatchObject({ uncertainAt: 'now' })
    queue(duplicate, { data: workRow, error: null })
    await expect(claimCommentExternalWork({ projectId: 'project', commentId: 'comment', provider: 'linear', leaseToken: 'new' })).resolves.toMatchObject({ leaseToken: 'old-lease' })
  })

  it('reclaims safe expired leases, falls back after a race, and surfaces reclaim errors', async () => {
    const duplicate = { data: null, error: { message: 'duplicate', code: '23505' } }
    const expired = { ...workRow, lease_expires_at: '2000-01-01T00:00:00.000Z' }
    const reclaimed = { ...expired, lease_token: 'new' }
    queue(duplicate, { data: expired, error: null }, { data: reclaimed, error: null })
    await expect(claimCommentExternalWork({ projectId: 'project', commentId: 'comment', provider: 'linear', leaseToken: 'new' })).resolves.toMatchObject({ leaseToken: 'new' })
    queue(duplicate, { data: expired, error: null }, { data: null, error: null }, { data: workRow, error: null })
    await expect(claimCommentExternalWork({ projectId: 'project', commentId: 'comment', provider: 'linear', leaseToken: 'new' })).resolves.toMatchObject({ leaseToken: 'old-lease' })
    queue(duplicate, { data: expired, error: null }, { data: null, error: { message: 'reclaim failed' } })
    await expect(claimCommentExternalWork({ projectId: 'project', commentId: 'comment', provider: 'linear', leaseToken: 'new' })).rejects.toThrow('reclaim failed')
  })

  it('marks uncertainty, finalizes, and releases with fenced error handling', async () => {
    const operations = queue(
      { data: { id: 'work' }, error: null }, { data: null, error: null }, { data: null, error: { message: 'mark failed' } },
      { data: { ...workRow, state: 'created', external_id: 'i', external_key: 'WEB-1', external_url: 'url' }, error: null },
      { data: null, error: null }, { data: null, error: { message: 'finalize failed' } },
      { data: null, error: null }, { data: null, error: { message: 'release failed' } },
    )
    await expect(markCommentExternalWorkUncertain('work', 'lease')).resolves.toBe(true)
    await expect(markCommentExternalWorkUncertain('work', 'lease')).resolves.toBe(false)
    await expect(markCommentExternalWorkUncertain('work', 'lease')).rejects.toThrow('mark failed')
    const result = {
      id: 'work', leaseToken: 'lease', externalId: 'i', externalKey: 'WEB-1', externalUrl: 'url',
      workspaceId: 'workspace', containerId: 'team',
    }
    await expect(finalizeCommentExternalWork(result)).resolves.toMatchObject({ state: 'created', externalUrl: 'url' })
    expect(operations[3].update).toHaveBeenCalledWith(expect.objectContaining({
      state: 'created', workspace_id: 'workspace', container_id: 'team',
      external_id: 'i', external_key: 'WEB-1', external_url: 'url',
    }))
    expect(operations[3].eq).toHaveBeenCalledWith('id', 'work')
    expect(operations[3].eq).toHaveBeenCalledWith('lease_token', 'lease')
    expect(operations[3].eq).toHaveBeenCalledWith('state', 'creating')
    await expect(finalizeCommentExternalWork(result)).resolves.toBeNull()
    await expect(finalizeCommentExternalWork(result)).rejects.toThrow('finalize failed')
    await expect(releaseCommentExternalWork('work', 'lease')).resolves.toBeUndefined()
    await expect(releaseCommentExternalWork('work', 'lease')).rejects.toThrow('release failed')
  })
})

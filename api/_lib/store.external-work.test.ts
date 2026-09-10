import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase.js', () => ({ getServiceSupabase: vi.fn() }))

import { getServiceSupabase } from './supabase.js'
import {
  claimCommentExternalWork,
  deleteProjectIntegration,
  finalizeCommentExternalWork,
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
  refresh_token_ciphertext: 'refresh', token_expires_at: null, workspace_id: 'workspace', workspace_name: 'Acme',
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
  for (const method of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'is', 'lt']) value[method] = vi.fn(() => value)
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
    await expect(updateProjectIntegrationTokens(tokens)).resolves.toMatchObject({ id: 'integration' })
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

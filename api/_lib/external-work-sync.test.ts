import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./github-app.js', () => ({ createInstallationAccessToken: vi.fn() }))
vi.mock('./github-issues.js', () => ({ closeGithubIssue: vi.fn(), createCommentRejectionMarker: vi.fn(() => 'marker') }))
vi.mock('./linear-connection.js', () => ({ getLinearAccessToken: vi.fn() }))
vi.mock('./linear.js', () => ({ closeLinearIssue: vi.fn(), hasLinearWriteScope: vi.fn((scopes: string | null) => scopes?.includes('write')) }))
vi.mock('./store.js', () => ({
  cancelExternalWorkClose: vi.fn(), claimExternalWorkClose: vi.fn(), completeExternalWorkClose: vi.fn(), ensureGithubExternalWork: vi.fn(),
  failExternalWorkClose: vi.fn(), getCommentExternalWork: vi.fn(), getCommentForGithubIssue: vi.fn(),
  getComment: vi.fn(), getGithubIssueConnection: vi.fn(), getProjectIntegration: vi.fn(),
}))

import { closeLinkedExternalWork, closeLinkedGithubIssue, closeLinkedLinearIssue, EXTERNAL_REJECTION_COMMENT } from './external-work-sync.js'
import { createInstallationAccessToken } from './github-app.js'
import { closeGithubIssue } from './github-issues.js'
import { getLinearAccessToken } from './linear-connection.js'
import { closeLinearIssue } from './linear.js'
import {
  cancelExternalWorkClose, claimExternalWorkClose, completeExternalWorkClose, ensureGithubExternalWork, failExternalWorkClose,
  getComment, getCommentExternalWork, getCommentForGithubIssue, getGithubIssueConnection, getProjectIntegration,
} from './store.js'

const work = {
  id: 'work', lifecycleStatus: 'active', workspaceId: 'workspace', containerId: 'acme/site', externalId: '7', externalUrl: 'url',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getComment).mockResolvedValue({
    id: 'comment', projectId: 'project', reviewStatus: 'rejected', updatedAt: 'version-1',
  } as never)
  vi.mocked(getCommentExternalWork).mockResolvedValue(work as never)
  vi.mocked(claimExternalWorkClose).mockResolvedValue({ ...work, lifecycleStatus: 'closing' } as never)
  vi.mocked(getGithubIssueConnection).mockResolvedValue({ owner: 'acme', repo: 'site', installationId: '99' } as never)
  vi.mocked(createInstallationAccessToken).mockResolvedValue('token')
  vi.mocked(getProjectIntegration).mockResolvedValue({ workspaceId: 'workspace', grantedScopes: 'read,write' } as never)
  vi.mocked(getLinearAccessToken).mockResolvedValue('linear-token')
  vi.mocked(completeExternalWorkClose).mockResolvedValue({ ...work, lifecycleStatus: 'closed' } as never)
})

describe('external work Linear rejection sync', () => {
  it('closes a stored Linear issue and records completion', async () => {
    await closeLinkedLinearIssue('project', 'comment', 'version-1')
    expect(closeLinearIssue).toHaveBeenCalledWith('linear-token', expect.objectContaining({
      issueId: '7', comment: EXTERNAL_REJECTION_COMMENT, marker: 'marker',
    }))
    expect(completeExternalWorkClose).toHaveBeenCalledWith('work', expect.any(String))
    await expect(vi.mocked(closeLinearIssue).mock.calls[0][1].beforeClose?.()).resolves.toBe(true)
  })

  it('ignores absent, closed, or currently leased Linear work', async () => {
    vi.mocked(getComment).mockResolvedValueOnce({
      id: 'comment', projectId: 'project', reviewStatus: 'open', updatedAt: 'version-2',
    } as never)
    await closeLinkedLinearIssue('project', 'comment', 'version-1')
    vi.mocked(getCommentExternalWork).mockResolvedValueOnce(null)
    await closeLinkedLinearIssue('project', 'comment')
    vi.mocked(getCommentExternalWork).mockResolvedValueOnce({ ...work, lifecycleStatus: 'closed' } as never)
    await closeLinkedLinearIssue('project', 'comment')
    vi.mocked(claimExternalWorkClose).mockResolvedValueOnce(null)
    await closeLinkedLinearIssue('project', 'comment')
    expect(closeLinearIssue).not.toHaveBeenCalled()
  })

  it('blocks unsafe workspace, authorization, and identity states', async () => {
    vi.mocked(getProjectIntegration).mockResolvedValueOnce(null)
    await closeLinkedLinearIssue('project', 'comment')
    expect(failExternalWorkClose).toHaveBeenLastCalledWith('work', expect.any(String), 'linear_workspace_not_connected', true)

    vi.mocked(getProjectIntegration).mockResolvedValueOnce({ workspaceId: 'other', grantedScopes: 'read,write' } as never)
    await closeLinkedLinearIssue('project', 'comment')
    expect(failExternalWorkClose).toHaveBeenLastCalledWith('work', expect.any(String), 'linear_workspace_not_connected', true)

    vi.mocked(getProjectIntegration).mockResolvedValueOnce({ workspaceId: 'workspace', grantedScopes: 'read' } as never)
    await closeLinkedLinearIssue('project', 'comment')
    expect(failExternalWorkClose).toHaveBeenLastCalledWith('work', expect.any(String), 'linear_reauthorization_required', true)

    vi.mocked(claimExternalWorkClose).mockResolvedValueOnce({ ...work, externalId: null, lifecycleStatus: 'closing' } as never)
    await closeLinkedLinearIssue('project', 'comment')
    expect(failExternalWorkClose).toHaveBeenLastCalledWith('work', expect.any(String), 'linear_issue_identity_invalid', true)
  })

  it('records retryable, blocked, and opaque provider failures', async () => {
    vi.mocked(closeLinearIssue).mockRejectedValueOnce(new Error('linear_request_failed'))
    await closeLinkedLinearIssue('project', 'comment')
    expect(failExternalWorkClose).toHaveBeenLastCalledWith('work', expect.any(String), 'linear_request_failed', false)

    vi.mocked(closeLinearIssue).mockRejectedValueOnce(new Error('linear_issue_not_found'))
    await closeLinkedLinearIssue('project', 'comment')
    expect(failExternalWorkClose).toHaveBeenLastCalledWith('work', expect.any(String), 'linear_issue_not_found', true)

    vi.mocked(closeLinearIssue).mockRejectedValueOnce('opaque')
    await closeLinkedLinearIssue('project', 'comment')
    expect(failExternalWorkClose).toHaveBeenLastCalledWith('work', expect.any(String), 'linear_issue_close_failed', false)
  })

  it('cancels stale Linear sync without recording a provider failure', async () => {
    vi.mocked(closeLinearIssue).mockRejectedValueOnce(new Error('external_work_sync_cancelled'))
    await closeLinkedLinearIssue('project', 'comment', 'version-1')
    expect(cancelExternalWorkClose).toHaveBeenCalledWith('work', expect.any(String))
    expect(failExternalWorkClose).not.toHaveBeenCalled()
  })

  it('runs GitHub and Linear synchronization together', async () => {
    await closeLinkedExternalWork('project', 'comment')
    expect(closeGithubIssue).toHaveBeenCalled()
    expect(closeLinearIssue).toHaveBeenCalled()
  })
})

describe('external work GitHub rejection sync', () => {
  it('closes a stored GitHub issue and records completion', async () => {
    await closeLinkedGithubIssue('project', 'comment', 'version-1')
    expect(closeGithubIssue).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token', issueNumber: 7, comment: EXTERNAL_REJECTION_COMMENT, marker: 'marker',
    }))
    expect(completeExternalWorkClose).toHaveBeenCalledWith('work', expect.any(String))
    await expect(vi.mocked(closeGithubIssue).mock.calls[0][0].beforeClose?.()).resolves.toBe(true)
  })

  it('bridges valid legacy GitHub state and ignores absent, malformed, closed, or busy work', async () => {
    vi.mocked(getCommentExternalWork).mockResolvedValueOnce(null)
    vi.mocked(getCommentForGithubIssue).mockResolvedValueOnce({
      githubIssue: { issueNumber: 8, issueUrl: 'https://github.com/acme/site/issues/8', createdAt: 'created' },
    } as never)
    vi.mocked(ensureGithubExternalWork).mockResolvedValueOnce(work as never)
    await closeLinkedGithubIssue('project', 'comment')
    expect(ensureGithubExternalWork).toHaveBeenCalledWith(expect.objectContaining({ owner: 'acme', repo: 'site', issueNumber: 8 }))

    vi.mocked(getCommentExternalWork).mockResolvedValueOnce(null)
    vi.mocked(getCommentForGithubIssue).mockResolvedValueOnce({ githubIssue: null } as never)
    await closeLinkedGithubIssue('project', 'comment')
    vi.mocked(getCommentExternalWork).mockResolvedValueOnce(null)
    vi.mocked(getCommentForGithubIssue).mockResolvedValueOnce({ githubIssue: { issueNumber: 7, issueUrl: 'bad', createdAt: 'now' } } as never)
    await closeLinkedGithubIssue('project', 'comment')
    for (const issueUrl of [
      'http://github.com/acme/site/issues/7',
      'https://example.com/acme/site/issues/7',
      'https://github.com/acme/site/pulls/7',
    ]) {
      vi.mocked(getCommentExternalWork).mockResolvedValueOnce(null)
      vi.mocked(getCommentForGithubIssue).mockResolvedValueOnce({ githubIssue: { issueNumber: 7, issueUrl, createdAt: 'now' } } as never)
      await closeLinkedGithubIssue('project', 'comment')
    }
    vi.mocked(getCommentExternalWork).mockResolvedValueOnce({ ...work, lifecycleStatus: 'closed' } as never)
    await closeLinkedGithubIssue('project', 'comment')
    vi.mocked(getCommentExternalWork).mockResolvedValueOnce(work as never)
    vi.mocked(claimExternalWorkClose).mockResolvedValueOnce(null)
    await closeLinkedGithubIssue('project', 'comment')
    expect(closeGithubIssue).toHaveBeenCalledTimes(1)
  })

  it('blocks mismatched routing and invalid issue identities', async () => {
    vi.mocked(getGithubIssueConnection).mockResolvedValueOnce(null)
    await closeLinkedGithubIssue('project', 'comment')
    expect(failExternalWorkClose).toHaveBeenLastCalledWith('work', expect.any(String), 'github_repository_not_connected', true)

    vi.mocked(claimExternalWorkClose).mockResolvedValueOnce({ ...work, externalId: 'bad', lifecycleStatus: 'closing' } as never)
    await closeLinkedGithubIssue('project', 'comment')
    expect(failExternalWorkClose).toHaveBeenLastCalledWith('work', expect.any(String), 'github_issue_identity_invalid', true)
  })

  it('records provider failures without throwing them into rejection', async () => {
    vi.mocked(closeGithubIssue).mockRejectedValueOnce(new Error('github_issue_close_failed'))
    await closeLinkedGithubIssue('project', 'comment')
    expect(failExternalWorkClose).toHaveBeenCalledWith('work', expect.any(String), 'github_issue_close_failed')

    vi.mocked(closeGithubIssue).mockRejectedValueOnce('non-error failure')
    await closeLinkedGithubIssue('project', 'comment')
    expect(failExternalWorkClose).toHaveBeenLastCalledWith('work', expect.any(String), 'github_issue_close_failed')
  })

  it('cancels stale rejection work before mutating GitHub', async () => {
    vi.mocked(getComment).mockResolvedValueOnce({
      id: 'comment', projectId: 'project', reviewStatus: 'open', updatedAt: 'version-2',
    } as never)
    await closeLinkedGithubIssue('project', 'comment', 'version-1')
    expect(claimExternalWorkClose).not.toHaveBeenCalled()

    vi.mocked(closeGithubIssue).mockRejectedValueOnce(new Error('external_work_sync_cancelled'))
    await closeLinkedGithubIssue('project', 'comment', 'version-1')
    expect(cancelExternalWorkClose).toHaveBeenCalledWith('work', expect.any(String))
    expect(failExternalWorkClose).not.toHaveBeenCalled()
  })
})

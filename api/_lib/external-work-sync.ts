import { randomUUID } from 'node:crypto'
import { createInstallationAccessToken } from './github-app.js'
import { closeGithubIssue, createCommentRejectionMarker } from './github-issues.js'
import { getLinearAccessToken } from './linear-connection.js'
import { closeLinearIssue, hasLinearWriteScope } from './linear.js'
import { getJiraAccessToken } from './jira-connection.js'
import { closeJiraIssue } from './jira.js'
import {
  cancelExternalWorkClose,
  claimExternalWorkClose,
  completeExternalWorkClose,
  ensureGithubExternalWork,
  failExternalWorkClose,
  getCommentExternalWork,
  getComment,
  getCommentForGithubIssue,
  getGithubIssueConnection,
  getProjectIntegration,
} from './store.js'

export const EXTERNAL_REJECTION_COMMENT = 'Closed automatically because the originating feedback was rejected in CRRT.'

function githubIssueLocation(issueUrl: string) {
  try {
    const url = new URL(issueUrl)
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !match) return null
    return { owner: decodeURIComponent(match[1]), repo: decodeURIComponent(match[2]), issueNumber: Number(match[3]) }
  } catch {
    return null
  }
}

async function githubWork(projectId: string, commentId: string) {
  const existing = await getCommentExternalWork(commentId, 'github')
  if (existing) return existing
  const comment = await getCommentForGithubIssue(projectId, commentId)
  if (!comment?.githubIssue) return null
  const location = githubIssueLocation(comment.githubIssue.issueUrl)
  if (!location || location.issueNumber !== comment.githubIssue.issueNumber) return null
  return ensureGithubExternalWork({
    projectId,
    commentId,
    ...location,
    issueUrl: comment.githubIssue.issueUrl,
    createdAt: comment.githubIssue.createdAt,
    leaseToken: randomUUID(),
  })
}

async function rejectionIsCurrent(projectId: string, commentId: string, expectedUpdatedAt?: string) {
  const comment = await getComment(commentId)
  return comment?.projectId === projectId
    && comment.reviewStatus === 'rejected'
    && (!expectedUpdatedAt || comment.updatedAt === expectedUpdatedAt)
}

export async function closeLinkedGithubIssue(
  projectId: string,
  commentId: string,
  expectedUpdatedAt?: string,
) {
  if (!(await rejectionIsCurrent(projectId, commentId, expectedUpdatedAt))) return
  const work = await githubWork(projectId, commentId)
  if (!work || work.lifecycleStatus === 'closed') return
  const leaseToken = randomUUID()
  const claimed = await claimExternalWorkClose(work.id, leaseToken)
  if (!claimed) return

  try {
    const connection = await getGithubIssueConnection(projectId)
    if (!connection || `${connection.owner}/${connection.repo}`.toLowerCase() !== claimed.containerId?.toLowerCase()) {
      await failExternalWorkClose(claimed.id, leaseToken, 'github_repository_not_connected', true)
      return
    }
    const issueNumber = Number(claimed.externalId)
    if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
      await failExternalWorkClose(claimed.id, leaseToken, 'github_issue_identity_invalid', true)
      return
    }
    const accessToken = await createInstallationAccessToken(connection.installationId)
    await closeGithubIssue({
      accessToken,
      owner: connection.owner,
      repo: connection.repo,
      issueNumber,
      comment: EXTERNAL_REJECTION_COMMENT,
      marker: createCommentRejectionMarker(commentId),
      beforeClose: () => rejectionIsCurrent(projectId, commentId, expectedUpdatedAt),
    })
    await completeExternalWorkClose(claimed.id, leaseToken)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'github_issue_close_failed'
    if (code === 'external_work_sync_cancelled') {
      await cancelExternalWorkClose(claimed.id, leaseToken)
      return
    }
    await failExternalWorkClose(claimed.id, leaseToken, code)
  }
}

export async function closeLinkedLinearIssue(
  projectId: string,
  commentId: string,
  expectedUpdatedAt?: string,
) {
  if (!(await rejectionIsCurrent(projectId, commentId, expectedUpdatedAt))) return
  const work = await getCommentExternalWork(commentId, 'linear')
  if (!work || work.lifecycleStatus === 'closed') return
  const leaseToken = randomUUID()
  const claimed = await claimExternalWorkClose(work.id, leaseToken)
  if (!claimed) return

  try {
    const integration = await getProjectIntegration(projectId, 'linear')
    if (!integration || integration.workspaceId !== claimed.workspaceId) {
      await failExternalWorkClose(claimed.id, leaseToken, 'linear_workspace_not_connected', true)
      return
    }
    if (!hasLinearWriteScope(integration.grantedScopes)) {
      await failExternalWorkClose(claimed.id, leaseToken, 'linear_reauthorization_required', true)
      return
    }
    if (!claimed.externalId) {
      await failExternalWorkClose(claimed.id, leaseToken, 'linear_issue_identity_invalid', true)
      return
    }
    const accessToken = await getLinearAccessToken(integration)
    await closeLinearIssue(accessToken, {
      issueId: claimed.externalId,
      comment: EXTERNAL_REJECTION_COMMENT,
      marker: createCommentRejectionMarker(commentId),
      beforeClose: () => rejectionIsCurrent(projectId, commentId, expectedUpdatedAt),
    })
    await completeExternalWorkClose(claimed.id, leaseToken)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'linear_issue_close_failed'
    if (code === 'external_work_sync_cancelled') {
      await cancelExternalWorkClose(claimed.id, leaseToken)
      return
    }
    const blocked = ['linear_issue_not_found', 'linear_canceled_state_unavailable', 'linear_reauthorization_required'].includes(code)
    await failExternalWorkClose(claimed.id, leaseToken, code, blocked)
  }
}

export async function closeLinkedJiraIssue(
  projectId: string,
  commentId: string,
  expectedUpdatedAt?: string,
) {
  if (!(await rejectionIsCurrent(projectId, commentId, expectedUpdatedAt))) return
  const work = await getCommentExternalWork(commentId, 'jira')
  if (!work || work.lifecycleStatus === 'closed') return
  const leaseToken = randomUUID()
  const claimed = await claimExternalWorkClose(work.id, leaseToken)
  if (!claimed) return

  try {
    const integration = await getProjectIntegration(projectId, 'jira')
    if (!integration || integration.workspaceId !== claimed.workspaceId) {
      await failExternalWorkClose(claimed.id, leaseToken, 'jira_site_not_connected', true)
      return
    }
    if (!claimed.externalId) {
      await failExternalWorkClose(claimed.id, leaseToken, 'jira_issue_identity_invalid', true)
      return
    }
    const accessToken = await getJiraAccessToken(integration)
    await closeJiraIssue(accessToken, {
      cloudId: integration.workspaceId,
      issueId: claimed.externalId,
      comment: EXTERNAL_REJECTION_COMMENT,
      marker: createCommentRejectionMarker(commentId),
      beforeClose: () => rejectionIsCurrent(projectId, commentId, expectedUpdatedAt),
    })
    await completeExternalWorkClose(claimed.id, leaseToken)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'jira_issue_close_failed'
    if (code === 'external_work_sync_cancelled') {
      await cancelExternalWorkClose(claimed.id, leaseToken)
      return
    }
    const blocked = [
      'jira_issue_status_invalid',
      'jira_rejection_transition_unavailable',
      'jira_transition_fields_required',
      'jira_reauthorization_required',
      'jira_permission_denied',
      'jira_resource_not_found',
    ].includes(code)
    await failExternalWorkClose(claimed.id, leaseToken, code, blocked)
  }
}

export async function closeLinkedExternalWork(projectId: string, commentId: string, expectedUpdatedAt?: string) {
  await Promise.all([
    closeLinkedGithubIssue(projectId, commentId, expectedUpdatedAt),
    closeLinkedLinearIssue(projectId, commentId, expectedUpdatedAt),
    closeLinkedJiraIssue(projectId, commentId, expectedUpdatedAt),
  ])
}

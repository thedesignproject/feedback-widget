import { randomUUID } from 'node:crypto'
import { createInstallationAccessToken } from './github-app.js'
import { closeGithubIssue, createCommentRejectionMarker } from './github-issues.js'
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

import { randomUUID } from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { waitUntil } from '@vercel/functions'
import { requireProjectCapability, requireProjectCommentCapability, requireUser } from '../../../_lib/auth.js'
import { generateCommentIssueContent } from '../../../_lib/comment-issue-content.js'
import {
  createCommentIssueMarker,
  createGithubIssue,
  findGithubIssueByMarker,
  formatEditableGithubIssueBody,
  formatGithubIssueBody,
} from '../../../_lib/github-issues.js'
import { createInstallationAccessToken } from '../../../_lib/github-app.js'
import { closeLinkedGithubIssue } from '../../../_lib/external-work-sync.js'
import { getStringQuery, handleOptions, jsonError, methodNotAllowed, setCors } from '../../../_lib/http.js'
import {
  acceptCommentIfOpen,
  claimCommentGithubIssue,
  finalizeCommentGithubIssue,
  getComment,
  getCommentForGithubIssue,
  getGithubIssueConnection,
  markCommentGithubIssueUncertain,
  releaseCommentGithubIssue,
  resetCommentGithubIssueAttempt,
} from '../../../_lib/store.js'

const METHODS = ['POST', 'OPTIONS']

function issueResponse(issue: { issueNumber: number; issueUrl: string; createdAt: string }, created: boolean) {
  return { ...issue, created }
}

function sameConnection(
  first: NonNullable<Awaited<ReturnType<typeof getGithubIssueConnection>>>,
  second: Awaited<ReturnType<typeof getGithubIssueConnection>>,
) {
  return second !== null
    && first.owner === second.owner
    && first.repo === second.repo
    && first.installationId === second.installationId
    && first.connectionVersion === second.connectionVersion
}

function safeErrorStatus(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  if (code === 'github_issue_persistence_failed') return 500
  if (code === 'github_issue_recovery_pending' || code === 'github_issue_creation_in_progress') return 409
  return code.startsWith('github_') ? 502 : 500
}

async function finalizeWithRetry(
  projectKey: string,
  commentId: string,
  leaseToken: string,
  issue: { issueNumber: number; issueUrl: string; createdAt: string },
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (await finalizeCommentGithubIssue(projectKey, commentId, leaseToken, issue)) return true
    } catch {
      // One bounded retry handles a transient database failure.
    }
  }
  return false
}

async function acceptOpenOrCloseRejected(projectKey: string, commentId: string) {
  if (await acceptCommentIfOpen(projectKey, commentId)) return
  const current = await getComment(commentId)
  if (current?.projectId === projectKey && current.reviewStatus === 'rejected') {
    waitUntil(closeLinkedGithubIssue(projectKey, commentId, current.updatedAt).catch(() => undefined))
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, METHODS)) return
  if (req.method !== 'POST') return methodNotAllowed(req, res, METHODS)
  const user = await requireUser(req, res)
  if (!user) return

  const commentId = getStringQuery(req.query.commentId)
  if (!commentId) return jsonError(req, res, 400, 'Missing commentId')

  let projectKey: string | null = null
  let leaseToken: string | null = null
  let uncertain = false
  try {
    const publicComment = await getComment(commentId)
    if (!publicComment?.projectId) return jsonError(req, res, 404, 'Comment not found')
    projectKey = publicComment.projectId
    if (!(await requireProjectCommentCapability(req, res, user, publicComment, 'integrations:send'))) return

    const comment = await getCommentForGithubIssue(projectKey, commentId)
    if (!comment) return jsonError(req, res, 404, 'Comment not found')
    if (comment.githubIssue) {
      await acceptOpenOrCloseRejected(projectKey, commentId)
      setCors(req, res, METHODS)
      return res.status(200).json(issueResponse(comment.githubIssue, false))
    }
    if (comment.reviewStatus === 'rejected') {
      return jsonError(req, res, 409, 'comment_rejected')
    }

    const connection = await getGithubIssueConnection(projectKey)
    if (!connection) return jsonError(req, res, 409, 'github_repository_not_connected')

    leaseToken = randomUUID()
    const recovery = comment.githubIssueUncertainAt !== null
    const claimed = await claimCommentGithubIssue(
      projectKey,
      commentId,
      leaseToken,
      undefined,
      recovery,
    )
    if (!claimed) {
      const current = await getCommentForGithubIssue(projectKey, commentId)
      if (current?.githubIssue) {
        setCors(req, res, METHODS)
        return res.status(200).json(issueResponse(current.githubIssue, false))
      }
      return jsonError(
        req,
        res,
        current ? 409 : 404,
        current ? 'github_issue_creation_in_progress' : 'Comment not found',
      )
    }

    const accessToken = await createInstallationAccessToken(connection.installationId)
    const marker = createCommentIssueMarker(commentId)
    const recovered = await findGithubIssueByMarker({
      accessToken,
      owner: connection.owner,
      repo: connection.repo,
      marker,
    })
    if (recovered) {
      const recoveryState = await getCommentForGithubIssue(projectKey, commentId)
      const recoveryConnection = await getGithubIssueConnection(projectKey)
      if (
        !recoveryState
        || recoveryState.reviewStatus === 'rejected'
        || recoveryState.githubIssueLeaseToken !== leaseToken
        || !sameConnection(connection, recoveryConnection)
      ) {
        await releaseCommentGithubIssue(projectKey, commentId, leaseToken)
        leaseToken = null
        return jsonError(req, res, 409, 'github_repository_connection_changed')
      }
      if (!(await requireProjectCapability(req, res, user, projectKey, 'integrations:send'))) {
        await releaseCommentGithubIssue(projectKey, commentId, leaseToken)
        leaseToken = null
        return
      }
      if (!(await finalizeWithRetry(projectKey, commentId, leaseToken, recovered))) {
        await releaseCommentGithubIssue(projectKey, commentId, leaseToken)
        leaseToken = null
        throw new Error('github_issue_persistence_failed')
      }
      await acceptOpenOrCloseRejected(projectKey, commentId)
      setCors(req, res, METHODS)
      return res.status(200).json(issueResponse(recovered, false))
    }

    if (recovery) {
      await releaseCommentGithubIssue(projectKey, commentId, leaseToken)
      leaseToken = null
      throw new Error('github_issue_recovery_pending')
    }

    const requestedDraft = req.body?.draft
    const editableDraft = requestedDraft
      && typeof requestedDraft.title === 'string'
      && typeof requestedDraft.body === 'string'
      ? { title: requestedDraft.title.trim(), body: requestedDraft.body.trim() }
      : null
    if (requestedDraft && (!editableDraft?.title || !editableDraft.body)) {
      await releaseCommentGithubIssue(projectKey, commentId, leaseToken)
      leaseToken = null
      return jsonError(req, res, 400, 'invalid_external_work_draft')
    }
    const content = editableDraft ? null : await generateCommentIssueContent(comment)
    const current = await getCommentForGithubIssue(projectKey, commentId)
    const currentConnection = await getGithubIssueConnection(projectKey)
    if (
      !current
      || current.reviewStatus === 'rejected'
      || current.githubIssueLeaseToken !== leaseToken
      || !sameConnection(connection, currentConnection)
    ) {
      await releaseCommentGithubIssue(projectKey, commentId, leaseToken)
      leaseToken = null
      return jsonError(req, res, 409, 'github_repository_connection_changed')
    }
    if (!(await requireProjectCapability(req, res, user, projectKey, 'integrations:send'))) {
      await releaseCommentGithubIssue(projectKey, commentId, leaseToken)
      leaseToken = null
      return
    }

    if (!(await markCommentGithubIssueUncertain(projectKey, commentId, leaseToken))) {
      throw new Error('github_issue_creation_in_progress')
    }
    uncertain = true
    let issue
    try {
      issue = await createGithubIssue({
        accessToken,
        owner: connection.owner,
        repo: connection.repo,
        title: editableDraft?.title ?? content!.title,
        body: editableDraft
          ? formatEditableGithubIssueBody(editableDraft.body, marker)
          : formatGithubIssueBody(comment, content!, marker),
      })
    } catch (error) {
      if (error instanceof Error && error.message !== 'github_issue_result_indeterminate') {
        await resetCommentGithubIssueAttempt(projectKey, commentId, leaseToken)
        leaseToken = null
        uncertain = false
      }
      throw error
    }
    if (!(await finalizeWithRetry(projectKey, commentId, leaseToken, issue))) {
      await releaseCommentGithubIssue(projectKey, commentId, leaseToken)
      leaseToken = null
      throw new Error('github_issue_persistence_failed')
    }
    await acceptOpenOrCloseRejected(projectKey, commentId)
    setCors(req, res, METHODS)
    return res.status(201).json(issueResponse(issue, true))
  } catch (error) {
    if (projectKey && leaseToken) {
      try {
        await releaseCommentGithubIssue(projectKey, commentId, leaseToken)
      } catch {
        // The lease expires automatically; never expose database details.
      }
    }
    if (uncertain) console.error('GitHub issue result requires marker recovery')
    const status = safeErrorStatus(error)
    const code = error instanceof Error ? error.message : ''
    return jsonError(
      req,
      res,
      status,
      code === 'github_issue_creation_in_progress'
        ? 'github_issue_creation_in_progress'
        : status === 409
        ? 'github_issue_recovery_pending'
        : status === 502 ? 'GitHub issue creation failed' : 'Issue creation failed',
    )
  }
}

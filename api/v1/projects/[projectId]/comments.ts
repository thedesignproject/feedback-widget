import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireReviewer } from '../../../_lib/auth'
import { getStringQuery, handleOptions, jsonError, methodNotAllowed, setCors } from '../../../_lib/http'
import { listComments } from '../../../_lib/store'
import type { ImplementationStatus, ReviewStatus } from '../../../_lib/status'

const REVIEW_STATUSES = new Set<ReviewStatus>(['open', 'accepted', 'rejected'])
const IMPLEMENTATION_STATUSES = new Set<ImplementationStatus>(['unassigned', 'claimed', 'in_progress', 'blocked', 'done'])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, ['GET', 'OPTIONS'])) return
  if (req.method !== 'GET') return methodNotAllowed(req, res, ['GET', 'OPTIONS'])
  if (!requireReviewer(req, res)) return

  try {
    const projectId = getStringQuery(req.query.projectId)
    if (!projectId) return jsonError(req, res, 400, 'Missing projectId')

    const pageUrl = getStringQuery(req.query.pageUrl)
    const reviewStatus = getStringQuery(req.query.reviewStatus)
    const implementationStatus = getStringQuery(req.query.implementationStatus)

    if (reviewStatus && !REVIEW_STATUSES.has(reviewStatus as ReviewStatus)) {
      return jsonError(req, res, 400, 'Invalid reviewStatus')
    }

    if (implementationStatus && !IMPLEMENTATION_STATUSES.has(implementationStatus as ImplementationStatus)) {
      return jsonError(req, res, 400, 'Invalid implementationStatus')
    }

    const comments = await listComments(projectId, {
      pageUrl,
      reviewStatus: reviewStatus as ReviewStatus | undefined,
      implementationStatus: implementationStatus as ImplementationStatus | undefined,
    })

    setCors(req, res, ['GET', 'OPTIONS'])
    return res.status(200).json(comments)
  } catch (error) {
    return jsonError(req, res, 500, error instanceof Error ? error.message : 'Unexpected error')
  }
}


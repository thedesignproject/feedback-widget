import type { CommentRecord } from '../api'
import { AUTHOR_COLORS, type Comment, type DisplayStatus } from './types'

function hashString(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export function authorColorFor(name: string) {
  return AUTHOR_COLORS[hashString(name) % AUTHOR_COLORS.length]
}

export function mapServerComment(record: CommentRecord): Comment {
  const author = record.authorName?.trim() || 'Anonymous'
  const initial = author.charAt(0).toUpperCase() || '?'
  return {
    id: record.id,
    projectId: record.projectId,
    pageUrl: record.pageUrl,
    selector: record.selector,
    x: record.x,
    y: record.y,
    body: record.body,
    visibility: record.visibility ?? 'shared',
    reviewStatus: record.reviewStatus,
    implementationStatus: record.implementationStatus,
    claimedByAgentId: record.claimedByAgentId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    author,
    authorInitial: initial,
    authorColor: authorColorFor(author),
    screenshotUrl: record.imageUrl,
    targetType: record.targetType ?? 'element_point',
    anchor: record.anchor ?? null,
    githubIssue: record.githubIssue ?? null,
    externalWork: record.externalWork ?? [],
  }
}

export function isInactive(c: Comment) {
  return c.reviewStatus === 'rejected' || c.implementationStatus === 'done'
}

export function getDisplayStatus(c: Comment): DisplayStatus {
  if (c.reviewStatus === 'rejected') return 'rejected'
  if (c.implementationStatus === 'done') return 'done'
  if (c.reviewStatus === 'accepted') return 'ready'
  return 'open'
}

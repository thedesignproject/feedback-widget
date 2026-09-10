import type { PromptTarget } from '../hooks/useAgentSession'
import type { CommentTargetType, ExternalWorkRecord, GitHubIssueRecord, TextRangeAnchorRecord } from '../api'

export type ReviewStatus = 'open' | 'accepted' | 'rejected'
export type ImplStatus = 'unassigned' | 'claimed' | 'in_progress' | 'blocked' | 'done'
export type StatusFilter = 'all' | 'open' | 'ready' | 'done'
export type DisplayStatus = 'open' | 'ready' | 'done' | 'rejected'

export interface Comment {
  id: string
  projectId: string
  pageUrl: string | null
  selector: string | null
  x: number | null
  y: number | null
  body: string
  visibility?: 'shared' | 'internal'
  reviewStatus: ReviewStatus
  implementationStatus: ImplStatus
  claimedByAgentId: string | null
  createdAt: string
  updatedAt: string
  author: string
  authorInitial: string
  authorColor: string
  screenshotUrl: string | null
  targetType: CommentTargetType
  anchor: TextRangeAnchorRecord | null
  githubIssue: GitHubIssueRecord | null
  externalWork?: ExternalWorkRecord[]
}

export interface AgentMeta {
  id: string
  name: string
  hint: string
  target: PromptTarget
}

export const AGENTS: AgentMeta[] = [
  { id: 'claude-code', name: 'Claude Code', hint: 'Paste prompt in chat', target: 'claude-code' },
  { id: 'codex', name: 'Codex', hint: 'Paste prompt in prompt', target: 'codex' },
  { id: 'cursor', name: 'Cursor', hint: 'Paste prompt in composer', target: 'generic' },
  { id: 'windsurf', name: 'Windsurf', hint: 'Paste prompt in Cascade', target: 'generic' },
  { id: 'cline', name: 'Cline', hint: 'Paste prompt in chat', target: 'generic' },
]

export const AUTHOR_COLORS = ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#0EA5E9']

export const DISPLAY_STATUS_LABELS: Record<DisplayStatus, string> = {
  open: 'Open',
  ready: 'Ready for Agent',
  done: 'Done',
  rejected: 'Rejected',
}

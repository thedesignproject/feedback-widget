import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { cn } from './lib/utils'

// ─── Types ──────────────────────────────────────────────────────────

type ReviewStatus = 'open' | 'accepted' | 'rejected'
type ImplStatus = 'unassigned' | 'claimed' | 'in_progress' | 'blocked' | 'done'
type StatusFilter = 'all' | 'open' | 'accepted' | 'rejected' | 'done'

interface Comment {
  id: string
  projectId: string
  pageUrl: string
  selector: string
  x: number
  y: number
  body: string
  reviewStatus: ReviewStatus
  implementationStatus: ImplStatus
  claimedByAgentId: string | null
  createdAt: string
  updatedAt: string
  // Mock-only fields
  author: string
  authorInitial: string
  authorColor: string
  screenshotUrl: string | null
}

interface Project {
  id: string
  name: string
  commentCount: number
}

interface AgentEvent {
  id: number
  type: string
  description: string
  timestamp: string
  agentId: string
}

interface CommentCounts {
  all: number
  open: number
  accepted: number
  rejected: number
  done: number
}

// ─── Fake Data ──────────────────────────────────────────────────────

const PROJECTS: Project[] = [
  { id: 'hubsync', name: 'HubSync', commentCount: 9 },
  { id: 'imera', name: 'Imera', commentCount: 4 },
  { id: 'purespectrum', name: 'PureSpectrum', commentCount: 2 },
  { id: 'flint-studio', name: 'Flint Studio', commentCount: 0 },
]

const FAKE_COMMENTS: Comment[] = [
  {
    id: '1', projectId: 'hubsync', pageUrl: '/workspaces', selector: 'section.hero > button.cta',
    x: 340, y: 180, body: 'This primary CTA feels lost against the hero image. Can we increase contrast or add a subtle shadow?',
    reviewStatus: 'open', implementationStatus: 'unassigned', claimedByAgentId: null,
    createdAt: '2026-04-21T14:23:00Z', updatedAt: '2026-04-21T14:23:00Z',
    author: 'Dianne R.', authorInitial: 'D', authorColor: '#EC4899', screenshotUrl: null,
  },
  {
    id: '2', projectId: 'hubsync', pageUrl: '/workspaces', selector: 'nav.header > ul.nav-items',
    x: 120, y: 45, body: 'Header nav items are too tight on tablet. On my iPad Pro, "Resources" and "Pricing" overlap.',
    reviewStatus: 'accepted', implementationStatus: 'claimed', claimedByAgentId: 'claude-code',
    createdAt: '2026-04-21T13:15:00Z', updatedAt: '2026-04-21T15:30:00Z',
    author: 'Agustín V.', authorInitial: 'A', authorColor: '#6366F1', screenshotUrl: null,
  },
  {
    id: '3', projectId: 'hubsync', pageUrl: '/workspaces', selector: 'div.empty-state > img',
    x: 400, y: 320, body: 'Empty state illustration looks off-brand. Can we swap for the new abstract set from the library?',
    reviewStatus: 'accepted', implementationStatus: 'in_progress', claimedByAgentId: 'claude-code',
    createdAt: '2026-04-21T12:40:00Z', updatedAt: '2026-04-21T16:00:00Z',
    author: 'Agustín V.', authorInitial: 'A', authorColor: '#6366F1', screenshotUrl: null,
  },
  {
    id: '4', projectId: 'hubsync', pageUrl: '/workspaces', selector: 'table.data-grid > tr:hover',
    x: 200, y: 420, body: 'Table row hover states are invisible on Safari. The gray is too close to the background.',
    reviewStatus: 'open', implementationStatus: 'unassigned', claimedByAgentId: null,
    createdAt: '2026-04-21T11:55:00Z', updatedAt: '2026-04-21T11:55:00Z',
    author: 'Lara M.', authorInitial: 'L', authorColor: '#F59E0B', screenshotUrl: null,
  },
  {
    id: '5', projectId: 'hubsync', pageUrl: '/settings', selector: 'button.sync-now',
    x: 560, y: 290, body: '"Sync now" button is too small — I keep missing the tap target on mobile.',
    reviewStatus: 'rejected', implementationStatus: 'unassigned', claimedByAgentId: null,
    createdAt: '2026-04-21T10:30:00Z', updatedAt: '2026-04-21T14:00:00Z',
    author: 'Tomás O.', authorInitial: 'T', authorColor: '#10B981', screenshotUrl: null,
  },
  {
    id: '6', projectId: 'hubsync', pageUrl: '/workspaces', selector: 'div.tooltip',
    x: 480, y: 150, body: 'Tooltip is clipped at the edge of the viewport — needs collision detection.',
    reviewStatus: 'accepted', implementationStatus: 'done', claimedByAgentId: 'claude-code',
    createdAt: '2026-04-20T16:20:00Z', updatedAt: '2026-04-21T09:00:00Z',
    author: 'Dianne R.', authorInitial: 'D', authorColor: '#EC4899', screenshotUrl: null,
  },
  {
    id: '7', projectId: 'hubsync', pageUrl: '/onboarding', selector: 'div.checklist',
    x: 300, y: 500, body: 'The onboarding checklist takes up too much real estate. Can we collapse completed steps?',
    reviewStatus: 'open', implementationStatus: 'unassigned', claimedByAgentId: null,
    createdAt: '2026-04-20T14:10:00Z', updatedAt: '2026-04-20T14:10:00Z',
    author: 'Lara M.', authorInitial: 'L', authorColor: '#F59E0B', screenshotUrl: null,
  },
  {
    id: '8', projectId: 'hubsync', pageUrl: '/workspaces', selector: 'div.date-picker',
    x: 150, y: 380, body: 'Date picker jumps around when switching months. Feels janky, probably a layout shift.',
    reviewStatus: 'open', implementationStatus: 'unassigned', claimedByAgentId: null,
    createdAt: '2026-04-20T11:00:00Z', updatedAt: '2026-04-20T11:00:00Z',
    author: 'Agustín V.', authorInitial: 'A', authorColor: '#6366F1', screenshotUrl: null,
  },
  {
    id: '9', projectId: 'hubsync', pageUrl: '/settings', selector: 'form.profile > input.email',
    x: 420, y: 200, body: 'Email validation error message appears below the fold. User has to scroll to see it.',
    reviewStatus: 'accepted', implementationStatus: 'unassigned', claimedByAgentId: null,
    createdAt: '2026-04-19T18:00:00Z', updatedAt: '2026-04-21T10:00:00Z',
    author: 'Tomás O.', authorInitial: 'T', authorColor: '#10B981', screenshotUrl: null,
  },
]

const FAKE_AGENT_EVENTS: AgentEvent[] = [
  { id: 1, type: 'claim', description: 'Claimed comment: "Sync now button too small"', timestamp: '2026-04-21T16:02:00Z', agentId: 'claude-code' },
  { id: 2, type: 'connect', description: 'Connected to share /shares/rf2-q3c3e', timestamp: '2026-04-21T16:00:00Z', agentId: 'claude-code' },
  { id: 3, type: 'resolve', description: 'Resolved · replaced illustration asset', timestamp: '2026-04-21T15:55:00Z', agentId: 'claude-code' },
  { id: 4, type: 'file', description: '1 file (feat/fix): swap empty-state illustration', timestamp: '2026-04-21T15:54:00Z', agentId: 'claude-code' },
]

// ─── Helpers ────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function truncateUrl(url: string) {
  return url.startsWith('/') ? url : url.replace(/^https?:\/\/[^/]+/, '')
}

// ─── Reducer ────────────────────────────────────────────────────────

interface AppState {
  selectedProject: string
  statusFilter: StatusFilter
  selectedCommentId: string
  comments: Comment[]
  sidebarOpen: boolean
  tick: number
}

type AppAction =
  | { type: 'select-project'; projectId: string }
  | { type: 'select-filter'; filter: StatusFilter }
  | { type: 'select-comment'; commentId: string }
  | { type: 'set-review-status'; commentId: string; status: ReviewStatus }
  | { type: 'toggle-sidebar' }
  | { type: 'open-sidebar' }
  | { type: 'tick' }

const INITIAL_STATE: AppState = {
  selectedProject: 'hubsync',
  statusFilter: 'all',
  selectedCommentId: '3',
  comments: FAKE_COMMENTS,
  sidebarOpen: true,
  tick: 0,
}

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'select-project':
      return { ...state, selectedProject: action.projectId, statusFilter: 'all', selectedCommentId: '' }
    case 'select-filter':
      return { ...state, statusFilter: action.filter, selectedCommentId: '' }
    case 'select-comment':
      return { ...state, selectedCommentId: action.commentId }
    case 'set-review-status':
      return {
        ...state,
        comments: state.comments.map((c) =>
          c.id === action.commentId
            ? { ...c, reviewStatus: action.status, updatedAt: new Date().toISOString() }
            : c,
        ),
      }
    case 'toggle-sidebar':
      return { ...state, sidebarOpen: !state.sidebarOpen }
    case 'open-sidebar':
      return { ...state, sidebarOpen: true }
    case 'tick':
      return { ...state, tick: state.tick + 1 }
  }
}

// ─── App ────────────────────────────────────────────────────────────

export function App() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
  const { selectedProject, statusFilter, selectedCommentId, comments, sidebarOpen } = state

  // Refresh time-ago labels.
  useEffect(() => {
    const t = setInterval(() => dispatch({ type: 'tick' }), 15000)
    return () => clearInterval(t)
  }, [])

  const projectComments = useMemo(
    () => comments.filter((c) => c.projectId === selectedProject),
    [comments, selectedProject],
  )

  const filteredComments = useMemo(() => {
    if (statusFilter === 'all') return projectComments
    if (statusFilter === 'done') return projectComments.filter((c) => c.implementationStatus === 'done')
    return projectComments.filter((c) => c.reviewStatus === statusFilter)
  }, [projectComments, statusFilter])

  const selectedComment = comments.find((c) => c.id === selectedCommentId) ?? null

  const counts: CommentCounts = useMemo(() => ({
    all: projectComments.length,
    open: projectComments.filter((c) => c.reviewStatus === 'open').length,
    accepted: projectComments.filter((c) => c.reviewStatus === 'accepted').length,
    rejected: projectComments.filter((c) => c.reviewStatus === 'rejected').length,
    done: projectComments.filter((c) => c.implementationStatus === 'done').length,
  }), [projectComments])

  const handleReviewStatus = useCallback((id: string, status: ReviewStatus) => {
    dispatch({ type: 'set-review-status', commentId: id, status })
  }, [])

  const selectedIdx = filteredComments.findIndex((c) => c.id === selectedCommentId)

  const goNext = useCallback(() => {
    const next = filteredComments[selectedIdx + 1]
    if (next) dispatch({ type: 'select-comment', commentId: next.id })
  }, [filteredComments, selectedIdx])

  const goPrev = useCallback(() => {
    const prev = filteredComments[selectedIdx - 1]
    if (prev) dispatch({ type: 'select-comment', commentId: prev.id })
  }, [filteredComments, selectedIdx])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); goNext() }
      if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); goPrev() }
      if (e.key === ' ') { e.preventDefault(); goNext() }

      if (selectedComment) {
        if (e.key === 'a') handleReviewStatus(selectedComment.id, 'accepted')
        if (e.key === 'r') handleReviewStatus(selectedComment.id, 'rejected')
        if (e.key === 'o') handleReviewStatus(selectedComment.id, 'open')
      }

      if (e.key === 's') dispatch({ type: 'toggle-sidebar' })
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goNext, goPrev, selectedComment, handleReviewStatus])

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <TopHeader
        projects={PROJECTS}
        selectedProject={selectedProject}
        onSelectProject={(id) => dispatch({ type: 'select-project', projectId: id })}
      />

      <div className="flex flex-1 overflow-hidden">
        <CommentList
          comments={filteredComments}
          totalCount={counts.all}
          counts={counts}
          statusFilter={statusFilter}
          selectedCommentId={selectedCommentId}
          onSelectFilter={(f) => dispatch({ type: 'select-filter', filter: f })}
          onSelectComment={(id) => dispatch({ type: 'select-comment', commentId: id })}
        />

        <CommentDetail
          comment={selectedComment}
          selectedIdx={selectedIdx}
          totalFiltered={filteredComments.length}
          onReviewStatus={handleReviewStatus}
          onPrev={goPrev}
          onNext={goNext}
        />

        {sidebarOpen && (
          <AgentSidebar
            events={FAKE_AGENT_EVENTS}
            onClose={() => dispatch({ type: 'toggle-sidebar' })}
          />
        )}
      </div>

      <StatusBar
        sidebarOpen={sidebarOpen}
        onShowSidebar={() => dispatch({ type: 'open-sidebar' })}
      />
    </div>
  )
}

// ─── TopHeader ──────────────────────────────────────────────────────

interface TopHeaderProps {
  projects: Project[]
  selectedProject: string
  onSelectProject: (id: string) => void
}

function TopHeader({ projects, selectedProject, onSelectProject }: TopHeaderProps) {
  return (
    <header className="flex items-center gap-3 px-5 h-[52px] shrink-0 border-b border-border bg-card">
      <div className="flex items-center gap-2 mr-2">
        <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary-foreground">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" />
          </svg>
        </div>
        <span className="text-sm font-bold tracking-tight text-foreground font-serif italic">feedback</span>
      </div>

      <div className="w-px h-5 bg-border" />

      <nav className="flex items-center gap-1 flex-1 overflow-auto">
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelectProject(p.id)}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap',
              selectedProject === p.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent',
            )}
          >
            {p.name}
            {p.commentCount > 0 && (
              <span className={cn(
                'ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                selectedProject === p.id
                  ? 'bg-primary-foreground/20 text-primary-foreground'
                  : 'bg-muted text-muted-foreground',
              )}>
                {p.commentCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="flex items-center gap-2 ml-auto">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-background text-muted-foreground text-xs w-48">
          <SearchIcon />
          <span>Search Feedback...</span>
        </div>
        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
          TO
        </div>
      </div>
    </header>
  )
}

// ─── CommentList ────────────────────────────────────────────────────

interface CommentListProps {
  comments: Comment[]
  totalCount: number
  counts: CommentCounts
  statusFilter: StatusFilter
  selectedCommentId: string
  onSelectFilter: (filter: StatusFilter) => void
  onSelectComment: (id: string) => void
}

const FILTER_OPTIONS: StatusFilter[] = ['all', 'open', 'accepted', 'rejected']

function CommentList({ comments, totalCount, counts, statusFilter, selectedCommentId, onSelectFilter, onSelectComment }: CommentListProps) {
  return (
    <div className="w-[400px] shrink-0 flex flex-col border-r border-border bg-card">
      <div className="px-4 pt-4 pb-2.5 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-foreground tracking-tight">
            {totalCount} Feedback Items
          </h2>
          <button className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
            <CheckboxIcon /> Select
          </button>
        </div>
        <div className="flex gap-1">
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f}
              onClick={() => onSelectFilter(f)}
              className={cn(
                'px-2.5 py-1 rounded-md text-[11px] font-semibold capitalize transition-all',
                statusFilter === f
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              )}
            >
              {f} <span className="opacity-60 ml-0.5">{counts[f as keyof CommentCounts] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {comments.length === 0 ? (
          <CommentListEmpty />
        ) : (
          <div className="animate-stagger">
            {comments.map((comment) => (
              <CommentListItem
                key={comment.id}
                comment={comment}
                isActive={comment.id === selectedCommentId}
                onSelect={onSelectComment}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CommentListEmpty() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center mb-3">
        <ChatIcon className="text-muted-foreground" />
      </div>
      <p className="text-sm font-semibold text-foreground mb-1">No comments</p>
      <p className="text-xs text-muted-foreground">Nothing here yet for this filter.</p>
    </div>
  )
}

function CommentListItem({ comment, isActive, onSelect }: { comment: Comment; isActive: boolean; onSelect: (id: string) => void }) {
  const borderColor =
    comment.reviewStatus === 'accepted' ? 'border-l-status-accepted' :
    comment.reviewStatus === 'rejected' ? 'border-l-status-rejected' :
    'border-l-transparent'

  return (
    <button
      onClick={() => onSelect(comment.id)}
      className={cn(
        'w-full text-left px-4 py-3.5 border-b border-border/50 border-l-[3px] card-hover',
        borderColor,
        isActive ? 'bg-accent' : 'hover:bg-accent/40',
      )}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[13px] font-semibold text-foreground">{comment.author}</span>
        <span className="text-[11px] text-muted-foreground">{timeAgo(comment.createdAt)}</span>
      </div>

      <p className={cn(
        'text-[13px] leading-relaxed mb-2.5 line-clamp-2',
        comment.reviewStatus === 'rejected'
          ? 'text-muted-foreground line-through'
          : 'text-foreground/80',
      )}>
        {comment.body}
      </p>

      <div className="flex items-center gap-2 mb-2.5 text-[11px] text-muted-foreground font-mono">
        <div
          className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold text-white"
          style={{ background: comment.authorColor }}
        >
          {comment.authorInitial}
        </div>
        <span className="truncate">{truncateUrl(comment.pageUrl)}</span>
        <span className="text-border">·</span>
        <span className="truncate">{comment.selector.split(' > ').pop()}</span>
      </div>

      <div className="flex items-center gap-2">
        <StatusBadge status={comment.reviewStatus} />
        {comment.implementationStatus !== 'unassigned' && (
          <ImplBadge status={comment.implementationStatus} />
        )}
        {comment.claimedByAgentId && (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-status-in-progress">
            <span className="w-1.5 h-1.5 rounded-full bg-status-in-progress animate-pulse-dot" />
            {comment.claimedByAgentId}
          </span>
        )}
      </div>
    </button>
  )
}

// ─── CommentDetail ──────────────────────────────────────────────────

interface CommentDetailProps {
  comment: Comment | null
  selectedIdx: number
  totalFiltered: number
  onReviewStatus: (id: string, status: ReviewStatus) => void
  onPrev: () => void
  onNext: () => void
}

function CommentDetail({ comment, selectedIdx, totalFiltered, onReviewStatus, onPrev, onNext }: CommentDetailProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {comment ? (
        <>
          <CommentDetailHeader comment={comment} />
          <CommentDetailBody comment={comment} />
          <CommentDetailActions
            comment={comment}
            selectedIdx={selectedIdx}
            totalFiltered={totalFiltered}
            onReviewStatus={onReviewStatus}
            onPrev={onPrev}
            onNext={onNext}
          />
        </>
      ) : (
        <CommentDetailEmpty />
      )}
    </div>
  )
}

function CommentDetailHeader({ comment }: { comment: Comment }) {
  return (
    <div className="flex items-center justify-between px-6 h-[44px] shrink-0 border-b border-border bg-card">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono font-medium">#{comment.id}</span>
        <span>·</span>
        <span className="font-mono">{truncateUrl(comment.pageUrl)}</span>
        <span>·</span>
        <span className={cn(
          'font-semibold',
          comment.reviewStatus === 'accepted' ? 'text-status-accepted' :
          comment.reviewStatus === 'rejected' ? 'text-status-rejected' :
          'text-muted-foreground',
        )}>
          {comment.reviewStatus.charAt(0).toUpperCase() + comment.reviewStatus.slice(1)}
        </span>
        {comment.implementationStatus !== 'unassigned' && (
          <>
            <span>·</span>
            <ImplBadge status={comment.implementationStatus} />
          </>
        )}
      </div>
    </div>
  )
}

function CommentDetailBody({ comment }: { comment: Comment }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div key={comment.id} className="max-w-2xl mx-auto px-8 py-8 detail-enter">
        <CommentScreenshot comment={comment} />

        <div className="flex items-start gap-3 mb-8">
          <div
            className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white"
            style={{ background: comment.authorColor }}
          >
            {comment.authorInitial}
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold text-foreground">{comment.author}</span>
              <span className="text-xs text-muted-foreground">{timeAgo(comment.createdAt)}</span>
            </div>
            <p className="text-[15px] leading-relaxed text-foreground">
              {comment.body}
            </p>
            <div className="mt-2 text-xs font-mono text-muted-foreground">
              {comment.selector}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function CommentScreenshot({ comment }: { comment: Comment }) {
  return (
    <div className="relative rounded-xl border border-border bg-muted/40 overflow-hidden mb-8 aspect-video flex items-center justify-center">
      <div className="w-full h-full bg-gradient-to-b from-card to-background p-6 relative">
        {/* Fake nav */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-muted-foreground/15" />
            <div className="w-16 h-2.5 rounded bg-muted-foreground/12" />
          </div>
          <div className="flex gap-3">
            <div className="w-10 h-2 rounded bg-muted-foreground/8" />
            <div className="w-10 h-2 rounded bg-muted-foreground/8" />
            <div className="w-14 h-6 rounded-md bg-muted-foreground/12" />
          </div>
        </div>
        {/* Fake content */}
        <div className="flex gap-4">
          <div className="flex-1">
            <div className="w-3/4 h-3 rounded bg-muted-foreground/10 mb-2" />
            <div className="w-1/2 h-3 rounded bg-muted-foreground/10 mb-4" />
            <div className="w-full h-2 rounded bg-muted-foreground/6 mb-1.5" />
            <div className="w-5/6 h-2 rounded bg-muted-foreground/6 mb-1.5" />
            <div className="w-4/6 h-2 rounded bg-muted-foreground/6" />
          </div>
          <div className="w-24 h-24 rounded-lg bg-muted-foreground/6" />
        </div>

        <div
          className="absolute"
          style={{ left: `${(comment.x / 700) * 100}%`, top: `${(comment.y / 500) * 100}%` }}
        >
          <div className="relative">
            <svg width="28" height="36" viewBox="0 0 32 40" fill="none">
              <path d="M16 38c0 0-14-12.5-14-22a14 14 0 1128 0c0 9.5-14 22-14 22z" fill="#6366F1" stroke="#fff" strokeWidth="2" />
              <text x="16" y="20" textAnchor="middle" fill="#fff" fontSize="12" fontWeight="700" fontFamily="system-ui">
                {comment.authorInitial}
              </text>
            </svg>
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-[#6366F1]/30 animate-pulse-dot" />
          </div>
        </div>
      </div>
    </div>
  )
}

function CommentDetailActions({ comment, selectedIdx, totalFiltered, onReviewStatus, onPrev, onNext }: CommentDetailProps & { comment: Comment }) {
  return (
    <div className="shrink-0 border-t border-border bg-card px-6 py-3">
      <div className="flex items-center gap-2 max-w-2xl mx-auto">
        <ActionBtn
          active={comment.reviewStatus === 'accepted'}
          variant="accept"
          onClick={() => onReviewStatus(comment.id, 'accepted')}
          shortcut="A"
        >
          <CheckIcon size={14} /> Accept
        </ActionBtn>
        <ActionBtn
          active={comment.reviewStatus === 'rejected'}
          variant="reject"
          onClick={() => onReviewStatus(comment.id, 'rejected')}
          shortcut="R"
        >
          <XIcon size={14} /> Reject
        </ActionBtn>
        <ActionBtn
          variant="neutral"
          onClick={() => onReviewStatus(comment.id, 'open')}
          shortcut="O"
        >
          Re-open
        </ActionBtn>

        <div className="w-px h-5 bg-border mx-1" />

        <ActionBtn variant="neutral" onClick={() => window.open(comment.pageUrl, '_blank')}>
          <ExternalLinkIcon size={13} /> Open page
        </ActionBtn>

        <div className="flex-1" />

        <button
          onClick={onPrev}
          disabled={selectedIdx <= 0}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <ChevronLeftIcon size={16} />
        </button>
        <span className="text-xs font-mono text-muted-foreground tabular-nums">
          {selectedIdx + 1}/{totalFiltered}
        </span>
        <button
          onClick={onNext}
          disabled={selectedIdx >= totalFiltered - 1}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <ChevronRightIcon size={16} />
        </button>
      </div>
    </div>
  )
}

function CommentDetailEmpty() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
      <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center mb-4">
        <CursorIcon className="text-muted-foreground" />
      </div>
      <p className="text-base font-semibold text-foreground mb-1">Select a comment</p>
      <p className="text-sm text-muted-foreground max-w-xs">
        Pick a feedback item from the list to see the full context, screenshot, and actions.
      </p>
      <div className="flex gap-3 mt-6 text-xs text-muted-foreground font-mono">
        <Kbd>J</Kbd><Kbd>K</Kbd> navigate
        <span className="mx-1">·</span>
        <Kbd>A</Kbd> accept
        <span className="mx-1">·</span>
        <Kbd>R</Kbd> reject
      </div>
    </div>
  )
}

// ─── AgentSidebar ───────────────────────────────────────────────────

interface AgentSidebarProps {
  events: AgentEvent[]
  onClose: () => void
}

function AgentSidebar({ events, onClose }: AgentSidebarProps) {
  return (
    <aside className="w-[300px] shrink-0 flex flex-col border-l border-border bg-sidebar overflow-y-auto animate-slide-in">
      <div className="px-4 py-4 border-b border-sidebar-border">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-bold text-foreground tracking-tight">Agent handoff</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <XIcon size={14} />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">Proof-style agent bridge</p>
      </div>

      <AgentStatusCard />
      <AgentActivityFeed events={events} />
    </aside>
  )
}

function AgentStatusCard() {
  return (
    <div className="px-4 py-3 border-b border-sidebar-border animate-fade-in">
      <div className="flex items-center gap-2 mb-3">
        <div className="relative">
          <div className="w-2 h-2 rounded-full bg-agent-active animate-pulse-dot" />
          <div className="absolute inset-0 w-2 h-2 rounded-full animate-pulse-ring" />
        </div>
        <span className="text-[11px] font-bold text-agent-active uppercase tracking-wider">Live</span>
        <span className="text-[11px] text-muted-foreground">— Claude Code connected</span>
      </div>

      <div className="rounded-lg border border-border bg-card p-3 mb-3">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Share URL</p>
        <p className="text-[11px] font-mono text-foreground break-all leading-relaxed mb-2">
          feedbackwidget.com/shares/<wbr />4f4G-sf7y
        </p>
        <div className="flex gap-2">
          <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-background text-[11px] font-semibold text-foreground hover:bg-accent transition-colors">
            <CopyIcon size={11} /> Copy URL
          </button>
          <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-background text-[11px] font-semibold text-foreground hover:bg-accent transition-colors">
            <ExternalLinkIcon size={11} /> Open
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card p-3 animate-scale-in">
        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <BotIcon size={14} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground">claude-code</p>
          <p className="text-[11px] text-muted-foreground truncate">
            Editing components/Nav.tsx — adjusting breakpoints
          </p>
        </div>
        <div className="w-1.5 h-1.5 rounded-full bg-agent-active animate-pulse-dot shrink-0" />
      </div>
    </div>
  )
}

function AgentActivityFeed({ events }: { events: AgentEvent[] }) {
  return (
    <div className="px-4 py-3 flex-1">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">Activity</p>
      <div className="space-y-0 animate-activity">
        {events.map((ev) => (
          <div key={ev.id} className="flex gap-3 py-2 border-b border-border/40 last:border-0">
            <div className="mt-1.5 shrink-0">
              <div className={cn(
                'w-1.5 h-1.5 rounded-full',
                ev.type === 'resolve' ? 'bg-status-accepted' :
                ev.type === 'claim' ? 'bg-status-claimed' :
                ev.type === 'file' ? 'bg-status-in-progress' :
                'bg-muted-foreground/30',
              )} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] text-foreground leading-snug">{ev.description}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(ev.timestamp)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── StatusBar ──────────────────────────────────────────────────────

function StatusBar({ sidebarOpen, onShowSidebar }: { sidebarOpen: boolean; onShowSidebar: () => void }) {
  return (
    <footer className="flex items-center gap-5 px-5 h-[32px] shrink-0 border-t border-border bg-card text-[10px] font-mono text-muted-foreground">
      <span><Kbd>A</Kbd> accept</span>
      <span><Kbd>R</Kbd> reject</span>
      <span><Kbd>O</Kbd> re-open</span>
      <span><Kbd>Space</Kbd> next</span>
      <span><Kbd>J</Kbd>/<Kbd>K</Kbd> nav</span>
      <span><Kbd>S</Kbd> sidebar</span>
      <div className="flex-1" />
      {!sidebarOpen && (
        <button onClick={onShowSidebar} className="text-[11px] font-semibold text-primary hover:underline">
          Show agent panel
        </button>
      )}
    </footer>
  )
}

// ─── Small Components ───────────────────────────────────────────────

function StatusBadge({ status }: { status: ReviewStatus }) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold',
      status === 'accepted' && 'bg-status-accepted-bg text-status-accepted',
      status === 'rejected' && 'bg-status-rejected-bg text-status-rejected',
      status === 'open' && 'bg-status-open-bg text-status-open',
    )}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function ImplBadge({ status }: { status: ImplStatus }) {
  const labels: Record<ImplStatus, string> = {
    unassigned: 'Unassigned', claimed: 'Claimed', in_progress: 'In progress',
    blocked: 'Blocked', done: 'Done',
  }
  const colorClass: Record<ImplStatus, string> = {
    unassigned: 'bg-status-open-bg text-status-open',
    claimed: 'bg-status-claimed-bg text-status-claimed',
    in_progress: 'bg-status-in-progress-bg text-status-in-progress',
    blocked: 'bg-status-blocked-bg text-status-blocked',
    done: 'bg-status-done-bg text-status-done',
  }
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold', colorClass[status])}>
      {labels[status]}
    </span>
  )
}

function ActionBtn({ children, variant, active, onClick, shortcut, disabled }: {
  children: React.ReactNode
  variant: 'accept' | 'reject' | 'neutral'
  active?: boolean
  onClick?: () => void
  shortcut?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? `${shortcut}` : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
        'disabled:opacity-40 disabled:pointer-events-none btn-press',
        variant === 'accept' && (active
          ? 'bg-status-accepted text-white'
          : 'border border-border bg-card text-foreground hover:bg-status-accepted-bg hover:text-status-accepted hover:border-status-accepted/30'
        ),
        variant === 'reject' && (active
          ? 'bg-status-rejected text-white'
          : 'border border-border bg-card text-foreground hover:bg-status-rejected-bg hover:text-status-rejected hover:border-status-rejected/30'
        ),
        variant === 'neutral' && 'border border-border bg-card text-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[18px] px-1 py-0.5 rounded border border-border bg-muted text-[9px] font-mono font-semibold text-muted-foreground">
      {children}
    </kbd>
  )
}

// ─── Icons ──────────────────────────────────────────────────────────

function SvgIcon({ d, size = 16, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={d} />
    </svg>
  )
}

function CheckIcon({ size = 16 }: { size?: number }) {
  return <SvgIcon d="M5 12l5 5L20 7" size={size} />
}

function XIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  )
}

function ExternalLinkIcon({ size = 16 }: { size?: number }) {
  return <SvgIcon d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" size={size} />
}

function ChevronLeftIcon({ size = 16 }: { size?: number }) {
  return <SvgIcon d="M15 18l-6-6 6-6" size={size} />
}

function ChevronRightIcon({ size = 16 }: { size?: number }) {
  return <SvgIcon d="M9 18l6-6-6-6" size={size} />
}

function CopyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  )
}

function BotIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 8V4H8" /><rect x="4" y="8" width="16" height="12" rx="2" /><path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
    </svg>
  )
}

function SearchIcon() {
  return <SvgIcon d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" size={14} />
}

function CheckboxIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="2" />
    </svg>
  )
}

function ChatIcon({ className }: { className?: string }) {
  return <SvgIcon d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" size={20} className={className} />
}

function CursorIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 3l14 9-7 2-3 7L5 3z" />
    </svg>
  )
}

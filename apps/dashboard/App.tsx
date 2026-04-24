import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

// ─── Fake Data ──────────────────────────────────────────────────────

const PROJECTS: Project[] = [
  { id: 'hubsync', name: 'HubSync', commentCount: 9 },
  { id: 'imera', name: 'Imera', commentCount: 4 },
  { id: 'purespectrum', name: 'PureSpectrum', commentCount: 2 },
  { id: 'flint-studio', name: 'Flint Studio', commentCount: 0 },
]

const AGENTS = [
  { id: 'claude-code', name: 'Claude Code', hint: 'Paste link in chat' },
  { id: 'codex', name: 'Codex', hint: 'Paste link in prompt' },
  { id: 'cursor', name: 'Cursor', hint: 'Paste link in composer' },
  { id: 'windsurf', name: 'Windsurf', hint: 'Paste link in Cascade' },
  { id: 'cline', name: 'Cline', hint: 'Paste link in chat' },
]

const AUTHOR_COLORS = ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#0EA5E9']

const FAKE_COMMENTS: Comment[] = [
  {
    id: '1', projectId: 'hubsync', pageUrl: '/workspaces', selector: 'section.hero > button.cta',
    x: 340, y: 180, body: 'This primary CTA feels lost against the hero image. Can we increase contrast or add a subtle shadow?',
    reviewStatus: 'open', implementationStatus: 'unassigned', claimedByAgentId: null,
    createdAt: '2026-04-21T14:23:00Z', updatedAt: '2026-04-21T14:23:00Z',
    author: 'Dianne R.', authorInitial: 'D', authorColor: '#EC4899',
    screenshotUrl: '/screenshots/marketeam-landing.png',
  },
  {
    id: '2', projectId: 'hubsync', pageUrl: '/workspaces', selector: 'nav.header > ul.nav-items',
    x: 120, y: 45, body: 'Header nav items are too tight on tablet. On my iPad Pro, "Resources" and "Pricing" overlap.',
    reviewStatus: 'accepted', implementationStatus: 'claimed', claimedByAgentId: 'claude-code',
    createdAt: '2026-04-21T13:15:00Z', updatedAt: '2026-04-21T15:30:00Z',
    author: 'Agustín V.', authorInitial: 'A', authorColor: '#6366F1',
    screenshotUrl: '/screenshots/coursue-dashboard.png',
  },
  {
    id: '3', projectId: 'hubsync', pageUrl: '/workspaces', selector: 'div.empty-state > img',
    x: 400, y: 320, body: 'Empty state illustration looks off-brand. Can we swap for the new abstract set from the library?',
    reviewStatus: 'accepted', implementationStatus: 'in_progress', claimedByAgentId: 'claude-code',
    createdAt: '2026-04-21T12:40:00Z', updatedAt: '2026-04-21T16:00:00Z',
    author: 'Agustín V.', authorInitial: 'A', authorColor: '#6366F1',
    screenshotUrl: '/screenshots/healthcarousel-dashboard.png',
  },
  {
    id: '4', projectId: 'hubsync', pageUrl: '/workspaces', selector: 'table.data-grid > tr:hover',
    x: 200, y: 420, body: 'Table row hover states are invisible on Safari. The gray is too close to the background.',
    reviewStatus: 'open', implementationStatus: 'unassigned', claimedByAgentId: null,
    createdAt: '2026-04-21T11:55:00Z', updatedAt: '2026-04-21T11:55:00Z',
    author: 'Lara M.', authorInitial: 'L', authorColor: '#F59E0B',
    screenshotUrl: '/screenshots/coreshift-integrations.png',
  },
  {
    id: '5', projectId: 'hubsync', pageUrl: '/settings', selector: 'button.sync-now',
    x: 560, y: 290, body: '"Sync now" button is too small — I keep missing the tap target on mobile.',
    reviewStatus: 'rejected', implementationStatus: 'unassigned', claimedByAgentId: null,
    createdAt: '2026-04-21T10:30:00Z', updatedAt: '2026-04-21T14:00:00Z',
    author: 'Tomás O.', authorInitial: 'T', authorColor: '#10B981',
    screenshotUrl: null,
  },
  {
    id: '6', projectId: 'hubsync', pageUrl: '/workspaces', selector: 'div.tooltip',
    x: 480, y: 150, body: 'Tooltip is clipped at the edge of the viewport — needs collision detection.',
    reviewStatus: 'accepted', implementationStatus: 'done', claimedByAgentId: 'claude-code',
    createdAt: '2026-04-20T16:20:00Z', updatedAt: '2026-04-21T09:00:00Z',
    author: 'Dianne R.', authorInitial: 'D', authorColor: '#EC4899',
    screenshotUrl: '/screenshots/coursue-dashboard.png',
  },
  {
    id: '7', projectId: 'hubsync', pageUrl: '/onboarding', selector: 'div.checklist',
    x: 300, y: 500, body: 'The onboarding checklist takes up too much real estate. Can we collapse completed steps?',
    reviewStatus: 'open', implementationStatus: 'unassigned', claimedByAgentId: null,
    createdAt: '2026-04-20T14:10:00Z', updatedAt: '2026-04-20T14:10:00Z',
    author: 'Lara M.', authorInitial: 'L', authorColor: '#F59E0B',
    screenshotUrl: null,
  },
  {
    id: '8', projectId: 'hubsync', pageUrl: '/workspaces', selector: 'div.date-picker',
    x: 150, y: 380, body: 'Date picker jumps around when switching months. Feels janky, probably a layout shift.',
    reviewStatus: 'open', implementationStatus: 'unassigned', claimedByAgentId: null,
    createdAt: '2026-04-20T11:00:00Z', updatedAt: '2026-04-20T11:00:00Z',
    author: 'Agustín V.', authorInitial: 'A', authorColor: '#6366F1',
    screenshotUrl: '/screenshots/marketeam-landing.png',
  },
  {
    id: '9', projectId: 'hubsync', pageUrl: '/settings', selector: 'form.profile > input.email',
    x: 420, y: 200, body: 'Email validation error message appears below the fold. User has to scroll to see it.',
    reviewStatus: 'accepted', implementationStatus: 'unassigned', claimedByAgentId: null,
    createdAt: '2026-04-19T18:00:00Z', updatedAt: '2026-04-21T10:00:00Z',
    author: 'Tomás O.', authorInitial: 'T', authorColor: '#10B981',
    screenshotUrl: '/screenshots/coreshift-integrations.png',
  },
]

const FAKE_AGENT_EVENTS: AgentEvent[] = [
  { id: 1, type: 'claim', description: 'Claimed comment: "Sync now button too small"', timestamp: '2026-04-21T16:02:00Z', agentId: 'claude-code' },
  { id: 2, type: 'connect', description: 'Connected to share /shares/rf2-q3c3e', timestamp: '2026-04-21T16:00:00Z', agentId: 'claude-code' },
  { id: 3, type: 'done', description: 'Done · replaced illustration asset', timestamp: '2026-04-21T15:55:00Z', agentId: 'claude-code' },
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

function isInactive(c: Comment) {
  return c.reviewStatus === 'rejected' || c.implementationStatus === 'done'
}

const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  open: 'Open',
  accepted: 'Accepted',
  rejected: 'Rejected',
}

const IMPL_STATUS_LABELS: Record<ImplStatus, string> = {
  unassigned: 'To do',
  claimed: 'Claimed',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
}

const IMPL_STATUS_COLORS: Record<ImplStatus, string> = {
  unassigned: 'bg-status-open-bg text-status-open',
  claimed: 'bg-status-claimed-bg text-status-claimed',
  in_progress: 'bg-status-in-progress-bg text-status-in-progress',
  blocked: 'bg-status-blocked-bg text-status-blocked',
  done: 'bg-status-done-bg text-status-done',
}

// ─── App ────────────────────────────────────────────────────────────

export function App() {
  const [projects, setProjects] = useState(PROJECTS)
  const [selectedProject, setSelectedProject] = useState('hubsync')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedCommentId, setSelectedCommentId] = useState<string>('3')
  const [comments, setComments] = useState(FAKE_COMMENTS)
  const [agentConnected] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [addProjectOpen, setAddProjectOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState('claude-code')
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false)
  const [, setTick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15000)
    return () => clearInterval(t)
  }, [])

  const projectComments = useMemo(() =>
    comments.filter((c) => c.projectId === selectedProject),
  [comments, selectedProject])

  const filteredComments = useMemo(() => {
    const filtered = statusFilter === 'all' ? projectComments
      : statusFilter === 'done' ? projectComments.filter((c) => c.implementationStatus === 'done')
      : projectComments.filter((c) => c.reviewStatus === statusFilter)

    return [...filtered].sort((a, b) => Number(isInactive(a)) - Number(isInactive(b)))
  }, [projectComments, statusFilter])

  const selectedComment = comments.find((c) => c.id === selectedCommentId) ?? null

  const counts = useMemo(() => projectComments.reduce(
    (acc, c) => {
      acc.all++
      if (c.reviewStatus === 'open') acc.open++
      else if (c.reviewStatus === 'accepted') acc.accepted++
      else if (c.reviewStatus === 'rejected') acc.rejected++
      if (c.implementationStatus === 'done') acc.done++
      return acc
    },
    { all: 0, open: 0, accepted: 0, rejected: 0, done: 0 },
  ), [projectComments])

  const handleReviewStatus = useCallback((id: string, status: ReviewStatus) => {
    setComments((prev) => prev.map((c) => c.id === id ? { ...c, reviewStatus: status, updatedAt: new Date().toISOString() } : c))
  }, [])

  const handleToggleDone = useCallback((id: string) => {
    setComments((prev) => prev.map((c) => c.id === id ? {
      ...c,
      implementationStatus: (c.implementationStatus === 'done' ? 'unassigned' : 'done') as ImplStatus,
      updatedAt: new Date().toISOString(),
    } : c))
  }, [])

  const toggleReview = useCallback((c: Comment, target: 'accepted' | 'rejected') => {
    handleReviewStatus(c.id, c.reviewStatus === target ? 'open' : target)
  }, [handleReviewStatus])

  const selectedIdx = filteredComments.findIndex((c) => c.id === selectedCommentId)

  const goNext = useCallback(() => {
    const next = filteredComments[selectedIdx + 1]
    if (next) setSelectedCommentId(next.id)
  }, [filteredComments, selectedIdx])

  const goPrev = useCallback(() => {
    const prev = filteredComments[selectedIdx - 1]
    if (prev) setSelectedCommentId(prev.id)
  }, [filteredComments, selectedIdx])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // ⌘K must run before the input-focus / palette-open guards below — it's the global escape hatch.
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCmdOpen((v) => !v)
        return
      }

      if (e.key === 'Escape' && cmdOpen) {
        setCmdOpen(false)
        return
      }

      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (cmdOpen) return

      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); goNext() }
      if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); goPrev() }
      if (e.key === ' ') { e.preventDefault(); goNext() }

      if (selectedComment) {
        if (e.key === 'a') toggleReview(selectedComment, 'accepted')
        if (e.key === 'd') toggleReview(selectedComment, 'rejected')
        if (e.key === 'm') handleToggleDone(selectedComment.id)
      }

      if (e.key === 's') setSidebarOpen((v) => !v)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goNext, goPrev, selectedComment, toggleReview, handleToggleDone, cmdOpen])

  const handleCmdSelect = useCallback((commentId: string) => {
    setSelectedCommentId(commentId)
    setCmdOpen(false)
  }, [])

  const selectFilter = useCallback((filter: StatusFilter) => {
    setStatusFilter(filter)
    setSelectedCommentId('')
  }, [])

  const handleCmdAction = useCallback((action: string) => {
    if (action === 'toggle-sidebar') setSidebarOpen((v) => !v)
    if (action === 'filter-all') selectFilter('all')
    if (action === 'filter-open') selectFilter('open')
    if (action === 'filter-accepted') selectFilter('accepted')
    if (action === 'filter-rejected') selectFilter('rejected')
    if (action === 'filter-done') selectFilter('done')
    if (selectedComment && action === 'accept') toggleReview(selectedComment, 'accepted')
    if (selectedComment && action === 'reject') toggleReview(selectedComment, 'rejected')
    if (selectedComment && action === 'done') handleToggleDone(selectedComment.id)
    setCmdOpen(false)
  }, [selectedComment, toggleReview, handleToggleDone, selectFilter])

  const handleAddProject = useCallback((name: string) => {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (!id || projects.some((p) => p.id === id)) return
    setProjects((prev) => [...prev, { id, name, commentCount: 0 }])
    setSelectedProject(id)
    setStatusFilter('all')
    setSelectedCommentId('')
    setAddProjectOpen(false)
  }, [projects])

  return (
    <div className="flex flex-col h-screen overflow-hidden">

      {/* ── Top Header ── */}
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
              onClick={() => { setSelectedProject(p.id); setStatusFilter('all'); setSelectedCommentId('') }}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap',
                selectedProject === p.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
            >
              {p.name}
              {p.commentCount > 0 && (
                <span className={cn(
                  'ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                  selectedProject === p.id
                    ? 'bg-primary-foreground/20 text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                )}>
                  {p.commentCount}
                </span>
              )}
            </button>
          ))}

          <div data-add-project className="relative">
            <button
              onClick={() => setAddProjectOpen((v) => !v)}
              className={cn(
                'w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground transition-all',
                addProjectOpen
                  ? 'bg-accent text-foreground'
                  : 'hover:bg-accent hover:text-foreground'
              )}
              title="Add project"
            >
              <PlusIcon size={14} />
            </button>
            {addProjectOpen && (
              <AddProjectPopover
                onAdd={handleAddProject}
                onClose={() => setAddProjectOpen(false)}
              />
            )}
          </div>
        </nav>

        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setCmdOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-background text-muted-foreground text-xs w-52 hover:border-muted-foreground/30 hover:bg-accent transition-colors cursor-pointer"
          >
            <SearchIcon />
            <span className="flex-1 text-left">Search Feedback...</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-border bg-card text-[10px] font-mono text-muted-foreground">
              <span className="text-[11px]">⌘</span>K
            </kbd>
          </button>
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
            TO
          </div>
        </div>
      </header>

      {/* ── Main 3-panel layout ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left Panel: Comment List ── */}
        <div className="w-[400px] shrink-0 flex flex-col border-r border-border bg-card">

          <div className="px-4 pt-4 pb-2.5 border-b border-border">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-foreground tracking-tight">
                {counts.all} Feedback Items
              </h2>
              <button className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                <CheckboxIcon /> Select
              </button>
            </div>
            <div className="flex gap-1">
              {(['all', 'open', 'accepted', 'rejected', 'done'] as StatusFilter[]).map((f) => {
                const count = counts[f as keyof typeof counts] ?? 0
                return (
                  <button
                    key={f}
                    onClick={() => selectFilter(f)}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-[11px] font-semibold capitalize transition-all',
                      statusFilter === f
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    )}
                  >
                    {f}
                    <span className={cn(
                      'ml-1.5 text-[10px] font-bold min-w-[18px] text-center py-0.5 px-1 rounded-full',
                      statusFilter === f
                        ? 'bg-primary-foreground/20 text-primary-foreground'
                        : 'bg-muted text-muted-foreground/60'
                    )}>{count}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredComments.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-8">
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center mb-3">
                  <ChatIcon className="text-muted-foreground" />
                </div>
                <p className="text-sm font-semibold text-foreground mb-1">No comments</p>
                <p className="text-xs text-muted-foreground">Nothing here yet for this filter.</p>
              </div>
            ) : (
              <div className="animate-stagger">
              {filteredComments.map((comment) => {
                const isActive = comment.id === selectedCommentId
                const inactive = isInactive(comment)
                const borderColor =
                  comment.implementationStatus === 'done' ? 'border-l-status-done' :
                  comment.reviewStatus === 'accepted' ? 'border-l-status-accepted' :
                  comment.reviewStatus === 'rejected' ? 'border-l-status-rejected' :
                  'border-l-transparent'

                return (
                  <button
                    key={comment.id}
                    onClick={() => setSelectedCommentId(comment.id)}
                    className={cn(
                      'w-full text-left px-4 py-3 border-b border-border/50 border-l-[3px] card-hover',
                      borderColor,
                      isActive ? 'bg-accent' : 'hover:bg-accent/40',
                      inactive && 'opacity-50'
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-[18px] h-[18px] rounded-full shrink-0 flex items-center justify-center text-[8px] font-bold text-white"
                          style={{ background: comment.authorColor }}
                        >
                          {comment.authorInitial}
                        </div>
                        <span className="text-[13px] font-bold text-foreground">{comment.author}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground/60">{timeAgo(comment.createdAt)}</span>
                    </div>

                    <p className={cn(
                      'text-[12px] leading-relaxed mb-2 line-clamp-2 pl-[26px]',
                      inactive ? 'text-muted-foreground/50 line-through' : 'text-muted-foreground'
                    )}>
                      {comment.body}
                    </p>

                    <div className="flex items-center gap-1.5 pl-[26px] flex-wrap">
                      <StatusBadge status={comment.reviewStatus} />
                      {comment.implementationStatus !== 'unassigned' && (
                        <ImplBadge status={comment.implementationStatus} />
                      )}
                      {comment.claimedByAgentId && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-status-in-progress">
                          <span className="w-1.5 h-1.5 rounded-full bg-status-in-progress animate-pulse-dot" />
                          {comment.claimedByAgentId}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground/40 font-mono ml-auto truncate max-w-[140px]">
                        {comment.selector.split(' > ').pop()}
                      </span>
                    </div>
                  </button>
                )
              })}
              </div>
            )}
          </div>
        </div>

        {/* ── Center Panel: Comment Detail ── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-background">
          {selectedComment ? (
            <>
              <div className="flex items-center justify-between px-6 h-[44px] shrink-0 border-b border-border bg-card">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono font-medium">#{selectedComment.id}</span>
                  <span>·</span>
                  <span className="font-mono">{truncateUrl(selectedComment.pageUrl)}</span>
                  <span>·</span>
                  <span className={cn(
                    'font-semibold',
                    selectedComment.reviewStatus === 'accepted' ? 'text-status-accepted' :
                    selectedComment.reviewStatus === 'rejected' ? 'text-status-rejected' :
                    'text-muted-foreground'
                  )}>
                    {REVIEW_STATUS_LABELS[selectedComment.reviewStatus]}
                  </span>
                  {selectedComment.implementationStatus !== 'unassigned' && (
                    <>
                      <span>·</span>
                      <ImplBadge status={selectedComment.implementationStatus} />
                    </>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                <div key={selectedComment.id} className="max-w-2xl mx-auto px-8 py-8 detail-enter">

                  {selectedComment.screenshotUrl ? (
                    <div className="relative rounded-xl border border-border overflow-hidden mb-6 group">
                      <img
                        src={selectedComment.screenshotUrl}
                        alt={`Screenshot of ${selectedComment.pageUrl}`}
                        className="w-full aspect-video object-cover bg-muted/40 grayscale transition-[filter] duration-500 group-hover:grayscale-0"
                        draggable={false}
                      />
                      {/* Darkened overlay for pin visibility */}
                      <div className="absolute inset-0 bg-black/10 pointer-events-none" />
                      <div
                        className="absolute pointer-events-none"
                        style={{ left: `${(selectedComment.x / 700) * 100}%`, top: `${(selectedComment.y / 500) * 100}%` }}
                      >
                        <div className="relative -translate-x-1/2 -translate-y-1/2 pin-marker">
                          <div className="pin-float">
                            <div className="absolute inset-0 rounded-full animate-pulse-ring" style={{ background: selectedComment.authorColor, opacity: 0.3 }} />
                            <div
                              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold pin-dot-shadow border-2 border-white/90"
                              style={{ background: `linear-gradient(135deg, ${selectedComment.authorColor}, ${selectedComment.authorColor}99)` }}
                            >
                              {selectedComment.authorInitial}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="absolute bottom-3 left-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-black/60 backdrop-blur-sm border border-white/10">
                        <SelectorIcon size={12} />
                        <span className="text-[11px] font-mono text-white/80">{selectedComment.selector}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-border bg-card p-5 mb-6">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                          <ImageOffIcon size={16} className="text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-foreground">No screenshot captured</p>
                          <p className="text-[11px] text-muted-foreground">Pin placed at ({selectedComment.x}, {selectedComment.y})</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/60 border border-border">
                        <SelectorIcon size={12} />
                        <code className="text-[12px] font-mono text-foreground/70 break-all">{selectedComment.selector}</code>
                      </div>
                    </div>
                  )}

                  <div className="flex items-start gap-3 mb-8">
                    <div
                      className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white"
                      style={{ background: selectedComment.authorColor }}
                    >
                      {selectedComment.authorInitial}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-foreground">{selectedComment.author}</span>
                        <span className="text-xs text-muted-foreground">{timeAgo(selectedComment.createdAt)}</span>
                      </div>
                      <p className="text-[15px] leading-relaxed text-foreground">
                        {selectedComment.body}
                      </p>
                      <div className="mt-2 text-xs font-mono text-muted-foreground">
                        {selectedComment.selector}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="shrink-0 border-t border-border bg-card px-6 py-3">
                <div className="flex items-center gap-2 max-w-2xl mx-auto">
                  <ActionBtn
                    active={selectedComment.reviewStatus === 'accepted'}
                    variant="accept"
                    onClick={() => toggleReview(selectedComment, 'accepted')}
                    shortcut="A"
                  >
                    <CheckIcon size={14} /> Accept
                  </ActionBtn>
                  <ActionBtn
                    active={selectedComment.reviewStatus === 'rejected'}
                    variant="reject"
                    onClick={() => toggleReview(selectedComment, 'rejected')}
                    shortcut="D"
                  >
                    <XIcon size={14} /> Reject
                  </ActionBtn>

                  <div className="w-px h-5 bg-border mx-1" />

                  <ActionBtn
                    active={selectedComment.implementationStatus === 'done'}
                    variant="done"
                    onClick={() => handleToggleDone(selectedComment.id)}
                    shortcut="M"
                  >
                    <DoneIcon size={14} /> {selectedComment.implementationStatus === 'done' ? 'Done' : 'Mark done'}
                  </ActionBtn>

                  <div className="w-px h-5 bg-border mx-1" />

                  <ActionBtn variant="neutral" onClick={() => window.open(selectedComment.pageUrl, '_blank')}>
                    <ExternalLinkIcon size={13} /> Open page
                  </ActionBtn>

                  <div className="flex-1" />

                  <button
                    onClick={goPrev}
                    disabled={selectedIdx <= 0}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  >
                    <ChevronLeftIcon size={16} />
                  </button>
                  <span className="text-xs font-mono text-muted-foreground tabular-nums">
                    {selectedIdx + 1}/{filteredComments.length}
                  </span>
                  <button
                    onClick={goNext}
                    disabled={selectedIdx >= filteredComments.length - 1}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  >
                    <ChevronRightIcon size={16} />
                  </button>
                </div>
              </div>
            </>
          ) : (
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
                <Kbd>D</Kbd> reject
              </div>
            </div>
          )}
        </div>

        {/* ── Right Panel: Agent Sidebar ── */}
        {sidebarOpen && (
          <aside className="w-[300px] shrink-0 flex flex-col border-l border-border bg-sidebar overflow-y-auto animate-slide-in">
            <div className="px-4 py-4 border-b border-sidebar-border">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-base font-bold text-foreground tracking-tight">Agent handoff</h2>
                <button onClick={() => setSidebarOpen(false)} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <XIcon size={14} />
                </button>
              </div>
              <p className="text-xs text-muted-foreground">Let AI agents fix your accepted feedback automatically</p>
            </div>

            {/* Session link — the core handoff */}
            <div className="px-4 py-4 border-b border-sidebar-border animate-fade-in">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Session link</p>
              <div className="rounded-lg border border-border bg-card p-3 mb-3">
                <p className="text-[11px] font-mono text-foreground break-all leading-relaxed select-all">
                  feedbackwidget.com/d/<wbr />hubsync-4f4G<wbr />?token=sk_live_…f7y
                </p>
              </div>
              <button className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity btn-press">
                <CopyIcon size={13} /> Copy session link
              </button>
              <div className="mt-3 rounded-md bg-muted/60 border border-border px-3 py-2.5">
                <p className="text-[11px] text-foreground font-medium mb-1.5">How it works</p>
                <ol className="text-[10px] text-muted-foreground leading-relaxed space-y-1 list-decimal list-inside">
                  <li>You review feedback and mark items as <span className="text-status-accepted font-semibold">Accepted</span></li>
                  <li>Copy this link and paste it into any AI agent</li>
                  <li>The agent only sees <span className="text-status-accepted font-semibold">accepted</span> items — nothing else</li>
                  <li>It claims, fixes, and marks them <span className="text-status-done font-semibold">Done</span></li>
                </ol>
              </div>
            </div>

            <div className="px-4 py-3 border-b border-sidebar-border">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Your agent</p>
              <div className="relative">
                <button
                  onClick={() => setAgentDropdownOpen((v) => !v)}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2 rounded-lg border bg-card text-xs font-semibold transition-colors',
                    agentDropdownOpen
                      ? 'border-primary/40 text-foreground'
                      : 'border-border text-foreground hover:border-muted-foreground/30'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <BotIcon size={14} className="text-primary" />
                    {AGENTS.find((a) => a.id === selectedAgent)?.name}
                  </div>
                  <ChevronDownIcon size={14} className={cn('text-muted-foreground transition-transform', agentDropdownOpen && 'rotate-180')} />
                </button>
                {agentDropdownOpen && (
                  <>
                    <button
                      type="button"
                      aria-label="Close agent selector"
                      className="fixed inset-0 z-40 cursor-default"
                      onClick={() => setAgentDropdownOpen(false)}
                    />
                    <div className="absolute top-full left-0 right-0 mt-1.5 rounded-lg border border-border bg-card shadow-xl shadow-black/30 z-50 py-1 cmd-modal-enter">
                      {AGENTS.map((agent) => (
                        <button
                          key={agent.id}
                          onClick={() => { setSelectedAgent(agent.id); setAgentDropdownOpen(false) }}
                          className={cn(
                            'w-full flex items-center justify-between px-3 py-2 text-left transition-colors',
                            selectedAgent === agent.id
                              ? 'bg-accent text-foreground'
                              : 'text-foreground/80 hover:bg-accent/50'
                          )}
                        >
                          <span className="text-xs font-semibold">{agent.name}</span>
                          {selectedAgent === agent.id && <CheckIcon size={13} />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">
                {AGENTS.find((a) => a.id === selectedAgent)?.hint}
              </p>
            </div>

            {agentConnected && (
              <div className="px-4 py-3 border-b border-sidebar-border animate-fade-in">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="relative">
                    <div className="w-2 h-2 rounded-full bg-agent-active animate-pulse-dot" />
                    <div className="absolute inset-0 w-2 h-2 rounded-full animate-pulse-ring" />
                  </div>
                  <span className="text-[10px] font-bold text-agent-active uppercase tracking-wider">Connected</span>
                </div>
                <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card p-2.5 animate-scale-in">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <BotIcon size={14} className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground">{AGENTS.find((a) => a.id === selectedAgent)?.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      Editing components/Nav.tsx
                    </p>
                  </div>
                  <div className="w-1.5 h-1.5 rounded-full bg-agent-active animate-pulse-dot shrink-0" />
                </div>
              </div>
            )}

            <div className="px-4 py-3 flex-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">Activity</p>
              <div className="space-y-0 animate-activity">
                {FAKE_AGENT_EVENTS.map((ev) => (
                  <div key={ev.id} className="flex gap-3 py-2 border-b border-border/40 last:border-0">
                    <div className="mt-1.5 shrink-0">
                      <div className={cn(
                        'w-2 h-2 rounded-full',
                        ev.type === 'done' ? 'bg-status-accepted' :
                        ev.type === 'claim' ? 'bg-status-claimed' :
                        ev.type === 'file' ? 'bg-status-in-progress' :
                        'bg-muted-foreground/30'
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
          </aside>
        )}
      </div>

      {/* ── Status Bar ── */}
      <footer className="flex items-center gap-5 px-5 h-[32px] shrink-0 border-t border-border bg-card text-[10px] font-mono text-muted-foreground">
        <span><Kbd>A</Kbd> accept</span>
        <span><Kbd>D</Kbd> reject</span>
        <span><Kbd>M</Kbd> done</span>
        <span><Kbd>Space</Kbd> next</span>
        <span><Kbd>J</Kbd>/<Kbd>K</Kbd> nav</span>
        <span><Kbd>S</Kbd> sidebar</span>
        <span><Kbd>⌘K</Kbd> search</span>
        <div className="flex-1" />
        {!sidebarOpen && (
          <button onClick={() => setSidebarOpen(true)} className="text-[11px] font-semibold text-primary hover:underline">
            Show agent panel
          </button>
        )}
      </footer>

      {cmdOpen && (
        <CommandPalette
          onClose={() => setCmdOpen(false)}
          comments={projectComments}
          onSelect={handleCmdSelect}
          onAction={handleCmdAction}
          selectedCommentId={selectedCommentId}
        />
      )}
    </div>
  )
}

// ─── Command Palette ────────────────────────────────────────────────

type CmdIconType = 'comment' | 'check' | 'x' | 'filter' | 'sidebar'
type CmdItem = { id: string; type: 'comment' | 'action'; label: string; detail: string; icon: CmdIconType }

const CMD_ACTIONS: CmdItem[] = [
  { id: 'accept', type: 'action', label: 'Toggle accept', detail: 'A', icon: 'check' },
  { id: 'reject', type: 'action', label: 'Toggle reject', detail: 'D', icon: 'x' },
  { id: 'done', type: 'action', label: 'Toggle done', detail: 'M', icon: 'check' },
  { id: 'toggle-sidebar', type: 'action', label: 'Toggle agent panel', detail: 'S', icon: 'sidebar' },
  { id: 'filter-all', type: 'action', label: 'Filter: Show all', detail: '', icon: 'filter' },
  { id: 'filter-open', type: 'action', label: 'Filter: Open only', detail: '', icon: 'filter' },
  { id: 'filter-accepted', type: 'action', label: 'Filter: Accepted only', detail: '', icon: 'filter' },
  { id: 'filter-rejected', type: 'action', label: 'Filter: Rejected only', detail: '', icon: 'filter' },
  { id: 'filter-done', type: 'action', label: 'Filter: Done only', detail: '', icon: 'filter' },
]

interface CommandPaletteProps {
  onClose: () => void
  comments: Comment[]
  onSelect: (commentId: string) => void
  onAction: (action: string) => void
  selectedCommentId: string
}

function CommandPalette({ onClose, comments, onSelect, onAction, selectedCommentId }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(h)
  }, [])

  const results = useMemo<CmdItem[]>(() => {
    const q = query.toLowerCase().trim()

    const matchedComments: CmdItem[] = comments
      .filter((c) => {
        if (!q) return true
        return (
          c.body.toLowerCase().includes(q) ||
          c.author.toLowerCase().includes(q) ||
          c.selector.toLowerCase().includes(q) ||
          c.pageUrl.toLowerCase().includes(q)
        )
      })
      .slice(0, 8)
      .map((c) => ({
        id: c.id,
        type: 'comment',
        label: c.body.length > 80 ? c.body.slice(0, 80) + '…' : c.body,
        detail: `${c.author} · ${truncateUrl(c.pageUrl)}`,
        icon: 'comment',
      }))

    const matchedActions = q
      ? CMD_ACTIONS.filter((a) => a.label.toLowerCase().includes(q))
      : CMD_ACTIONS

    return q ? [...matchedComments, ...matchedActions] : [...matchedActions, ...matchedComments]
  }, [query, comments])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const el = list.children[activeIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  const handleSelect = useCallback(() => {
    const item = results[activeIdx]
    if (!item) return
    if (item.type === 'comment') onSelect(item.id)
    else onAction(item.id)
  }, [results, activeIdx, onSelect, onAction])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      handleSelect()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }, [results.length, handleSelect, onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-center pt-[20vh]">
      <button
        type="button"
        aria-label="Close command palette"
        className="absolute inset-0 bg-background/60 backdrop-blur-sm cmd-backdrop-enter"
        onClick={onClose}
      />
      <div className="relative w-full max-w-[540px] h-fit rounded-xl border border-border bg-card shadow-2xl shadow-black/40 overflow-hidden cmd-modal-enter">
        <div className="flex items-center gap-3 px-4 h-[52px] border-b border-border">
          <SearchIcon />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIdx(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search feedback, jump to comment, or run action…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted text-[10px] font-mono text-muted-foreground">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[360px] overflow-y-auto py-2">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">No results for "{query}"</p>
            </div>
          ) : (
            results.map((item, i) => {
              const prevType = results[i - 1]?.type
              const showHeader = i === 0 || item.type !== prevType

              return (
                <div key={`${item.type}-${item.id}`}>
                  {showHeader && (
                    <div className="px-4 pt-2 pb-1">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                        {item.type === 'action' ? 'Actions' : 'Comments'}
                      </span>
                    </div>
                  )}
                  <button
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                      i === activeIdx
                        ? 'bg-accent text-foreground'
                        : 'text-foreground/80 hover:bg-accent/50'
                    )}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => {
                      if (item.type === 'comment') onSelect(item.id)
                      else onAction(item.id)
                    }}
                  >
                    <div className={cn(
                      'w-7 h-7 rounded-lg shrink-0 flex items-center justify-center',
                      i === activeIdx ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                    )}>
                      <CmdIcon type={item.icon} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        'text-[13px] leading-snug truncate',
                        i === activeIdx ? 'text-foreground' : 'text-foreground/80',
                        item.type === 'comment' && item.id === selectedCommentId && 'font-semibold'
                      )}>
                        {item.label}
                      </p>
                      {item.detail && (
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                          {item.detail}
                        </p>
                      )}
                    </div>

                    {item.type === 'action' && item.detail ? (
                      <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted text-[10px] font-mono text-muted-foreground shrink-0">
                        {item.detail}
                      </kbd>
                    ) : (
                      i === activeIdx && (
                        <span className="text-muted-foreground shrink-0">
                          <ReturnIcon />
                        </span>
                      )
                    )}
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div className="flex items-center gap-4 px-4 h-[36px] border-t border-border text-[10px] font-mono text-muted-foreground">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd> select</span>
          <span className="flex items-center gap-1"><Kbd>esc</Kbd> close</span>
        </div>
      </div>
    </div>
  )
}

function AddProjectPopover({ onAdd, onClose }: { onAdd: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())

    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('[data-add-project]')) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  return (
    <div
      data-add-project
      className="absolute top-full left-0 mt-2 w-[260px] rounded-lg border border-border bg-card shadow-xl shadow-black/30 cmd-modal-enter z-50"
    >
      <div className="p-3">
        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">New project</p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) onAdd(name.trim())
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-colors"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="flex items-center justify-between mt-3">
            <p className="text-[10px] text-muted-foreground">
              Paste your snippet after creating
            </p>
            <button
              type="submit"
              disabled={!name.trim()}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-semibold transition-all btn-press',
                name.trim()
                  ? 'bg-primary text-primary-foreground hover:opacity-90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              )}
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function CmdIcon({ type }: { type: CmdIconType }) {
  switch (type) {
    case 'comment': return <ChatIcon />
    case 'check': return <CheckIcon size={14} />
    case 'x': return <XIcon size={14} />
    case 'filter': return <SvgIcon d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" size={14} />
    case 'sidebar': return <SvgIcon d="M21 3H3a2 2 0 00-2 2v14a2 2 0 002 2h18a2 2 0 002-2V5a2 2 0 00-2-2zM15 3v18" size={14} />
  }
}

function ReturnIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 10 4 15 9 20" /><path d="M20 4v7a4 4 0 01-4 4H4" />
    </svg>
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
      {REVIEW_STATUS_LABELS[status]}
    </span>
  )
}

function ImplBadge({ status }: { status: ImplStatus }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold', IMPL_STATUS_COLORS[status])}>
      {IMPL_STATUS_LABELS[status]}
    </span>
  )
}

function ActionBtn({ children, variant, active, onClick, shortcut, disabled }: {
  children: React.ReactNode
  variant: 'accept' | 'reject' | 'neutral' | 'done'
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
        variant === 'done' && (active
          ? 'bg-status-done text-white'
          : 'border border-border bg-card text-foreground hover:bg-status-done-bg hover:text-status-done hover:border-status-done/30'
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

function DoneIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}

function SelectorIcon({ size = 16 }: { size?: number }) {
  return <SvgIcon d="M7 2h10M7 22h10M2 7v10M22 7v10" size={size} />
}

function ImageOffIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2 2l20 20M9 9a3 3 0 104.24 4.24" /><path d="M21 15V5a2 2 0 00-2-2H9" /><path d="M3 9v10a2 2 0 002 2h10l3.3-3.3" /><path d="M14 14l2.44-2.44" />
    </svg>
  )
}

function ChevronDownIcon({ size = 16, className }: { size?: number; className?: string }) {
  return <SvgIcon d="M6 9l6 6 6-6" size={size} className={className} />
}

function PlusIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
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

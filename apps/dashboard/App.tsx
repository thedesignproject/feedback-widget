import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { acceptInvite as apiAcceptInvite, updateCommentVisibility as apiUpdateVisibility, updateImplementationStatus as apiUpdateImpl, updateReviewStatus as apiUpdateReview } from './api'
import { useProjects } from './hooks/useProjects'
import { useComments } from './hooks/useComments'
import { useAgentSession } from './hooks/useAgentSession'
import { useAuth } from './hooks/useAuth'
import { useSuperAdmin } from './hooks/useSuperAdmin'
import { getDisplayStatus, isInactive, mapServerComment } from './lib/comment'
import { relPath } from './lib/routes'
import { AGENTS, type Comment, type ImplStatus, type ReviewStatus, type StatusFilter } from './lib/types'
import { Header } from './components/Header'
import { CommentList } from './components/CommentList'
import { CommentDetail } from './components/CommentDetail'
import { AgentSidebar } from './components/AgentSidebar'
import { StatusBar } from './components/StatusBar'
import { CommandPalette } from './components/CommandPalette'
import { LoginPage } from './components/LoginPage'
import { ResetPasswordPage } from './components/ResetPasswordPage'
import { WelcomeScreen } from './components/WelcomeScreen'
import { AddProjectPopover } from './components/AddProjectPopover'
import { ProjectSettings } from './components/ProjectSettings'
import { SuperAdminPanel } from './components/SuperAdminPanel'
import { ExtensionCommentsPage } from './components/ExtensionCommentsPage'
import { Spinner } from './components/primitives'
import { ProductAuditPage } from './components/ProductAuditPage'

const API_BASE = import.meta.env.VITE_API_BASE || 'https://crrt.ai/api'
const ONBOARDED_KEY = 'crrt:dashboard:onboarded'

function isOnboarded() {
  try {
    return window.localStorage.getItem(ONBOARDED_KEY) === '1'
  } catch {
    return true
  }
}

function markOnboarded() {
  try {
    window.localStorage.setItem(ONBOARDED_KEY, '1')
  } catch {
    /* localStorage unavailable */
  }
}

export function App() {
  const { session, user, loading: authLoading, signOut } = useAuth()
  const [pathname, setPathname] = useState(typeof window === 'undefined' ? '/' : relPath(window.location.pathname))

  useEffect(() => {
    function onPop() {
      setPathname(relPath(window.location.pathname))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // /reset-password handles its own auth state via the recovery deep link;
  // render it regardless of session so the user can complete the flow even
  // if their previous session is stale.
  if (pathname === '/reset-password') return <ResetPasswordPage />

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner size={20} />
      </div>
    )
  }

  if (!session || !user) return <LoginPage />

  const auditMatch = pathname.match(/^\/audits\/([^/]+)$/)
  if (auditMatch) return <ProductAuditPage apiBase={API_BASE} accessToken={session.access_token} auditId={decodeURIComponent(auditMatch[1])} />
  return <AuthenticatedApp accessToken={session.access_token} user={user} onSignOut={signOut} />
}

function AuthenticatedApp({ accessToken, user, onSignOut }: { accessToken: string; user: import('@supabase/supabase-js').User; onSignOut: () => void }) {
  const { projects, loading: projectsLoading, error: projectsError, claimProject, checkAvailability, refresh: refreshProjects } = useProjects(API_BASE, accessToken)
  const { superadmin } = useSuperAdmin(API_BASE, accessToken)
  const [selectedProject, setSelectedProject] = useState<string>('')
  const [view, setView] = useState<'feedback' | 'settings' | 'super-admin' | 'extension-comments'>(() =>
    new URLSearchParams(window.location.search).get('view') === 'extension-comments' ? 'extension-comments' : 'feedback',
  )
  const [pendingInvite, setPendingInvite] = useState(() => new URLSearchParams(window.location.search).get('invite'))
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedCommentId, setSelectedCommentId] = useState<string>('')
  const [pendingCommentSelection, setPendingCommentSelection] = useState<{ projectKey: string; commentId: string } | null>(null)
  const { comments: serverComments, commentsProjectId, loading: commentsLoading, error: commentsError, refresh: refreshComments } = useComments(API_BASE, accessToken, selectedProject || null)
  const [comments, setComments] = useState<Comment[]>([])
  const reviewRequests = useRef(new Map<string, symbol>())
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [addProjectOpen, setAddProjectOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState('claude-code')
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  const activeProject = projects.find((p) => p.publicKey === selectedProject) ?? null
  // Fail closed while project access is loading. The fallback only keeps
  // backwards compatibility for project fixtures/API responses that predate
  // explicit capabilities.
  const canManageFeedback = activeProject
    ? activeProject.capabilities?.includes('feedback:manage') ?? true
    : false
  const canOperateAgent = activeProject
    ? activeProject.capabilities?.includes('agent:operate') ?? true
    : false
  const canManageProject = activeProject
    ? activeProject.capabilities?.includes('project:manage') ?? true
    : false
  const { session: agentSession, shareState: agentShareState, events: agentEvents, error: agentError, copyPrompt } = useAgentSession(API_BASE, canOperateAgent ? selectedProject || null : null)
  const agentConnected = (agentShareState?.presence?.length ?? 0) > 0
  const selectedAgentMeta = AGENTS.find((a) => a.id === selectedAgent) ?? AGENTS[0]
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set())
  const [addProjectError, setAddProjectError] = useState<string | null>(null)
  const [addProjectBusy, setAddProjectBusy] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'dark'
    try { return (localStorage.getItem('dashboard-theme') as 'light' | 'dark') || 'dark' } catch { return 'dark' }
  })
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!pendingInvite) return
    let current = true
    apiAcceptInvite(API_BASE, accessToken, pendingInvite)
      .then(() => {
        if (!current) return
        setSelectedProject(pendingInvite)
        setView('feedback')
        void refreshProjects()
      })
      .catch((error) => console.warn('Could not accept project invitation', error))
      .finally(() => {
        if (!current) return
        const url = new URL(window.location.href)
        url.searchParams.delete('invite'); url.searchParams.delete('email')
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
        setPendingInvite(null)
      })
    return () => { current = false }
  }, [accessToken, pendingInvite, refreshProjects])

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'light') root.classList.add('light')
    else root.classList.remove('light')
    try { localStorage.setItem('dashboard-theme', theme) } catch {}
  }, [theme])

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (view !== 'extension-comments' && !selectedProject && projects.length > 0) {
      setSelectedProject(projects[0].publicKey)
    }
  }, [projects, selectedProject, view])

  useEffect(() => {
    const next = serverComments.map(mapServerComment)
    setComments(next)
    setSelectedCommentId((current) => {
      if (
        pendingCommentSelection &&
        pendingCommentSelection.projectKey === selectedProject &&
        commentsProjectId === selectedProject
      ) {
        return next.some((c) => c.id === pendingCommentSelection.commentId)
          ? pendingCommentSelection.commentId
          : current && next.some((c) => c.id === current) ? current : ''
      }
      return current && next.some((c) => c.id === current) ? current : ''
    })
    if (
      pendingCommentSelection &&
      pendingCommentSelection.projectKey === selectedProject &&
      commentsProjectId === selectedProject &&
      next.some((c) => c.id === pendingCommentSelection.commentId)
    ) {
      setPendingCommentSelection(null)
    }
  }, [serverComments, commentsProjectId, pendingCommentSelection, selectedProject])

  const projectComments = comments

  const filteredComments = useMemo(() => {
    const filtered = statusFilter === 'all'
      ? projectComments
      : projectComments.filter((c) => getDisplayStatus(c) === statusFilter)

    return [...filtered].sort((a, b) => Number(isInactive(a)) - Number(isInactive(b)))
  }, [projectComments, statusFilter])

  const selectedComment = comments.find((c) => c.id === selectedCommentId) ?? null

  const counts = useMemo(() => projectComments.reduce(
    (acc, c) => {
      acc.all++
      const ds = getDisplayStatus(c)
      acc[ds]++
      return acc
    },
    { all: 0, open: 0, ready: 0, done: 0, rejected: 0 },
  ), [projectComments])

  const handleReviewStatus = useCallback(async (id: string, status: ReviewStatus) => {
    const request = Symbol(id)
    reviewRequests.current.set(id, request)
    setComments((prev) => prev.map((c) => c.id === id ? { ...c, reviewStatus: status, updatedAt: new Date().toISOString() } : c))
    try {
      await apiUpdateReview(API_BASE, accessToken, id, status)
      if (reviewRequests.current.get(id) === request) await refreshComments()
    } catch (err) {
      console.error('Failed to update review status:', err)
      if (reviewRequests.current.get(id) === request) await refreshComments()
    } finally {
      if (reviewRequests.current.get(id) === request) reviewRequests.current.delete(id)
    }
  }, [accessToken, refreshComments])

  const handleToggleDone = useCallback(async (id: string) => {
    const current = comments.find((c) => c.id === id)
    if (!current) return
    const nextStatus: ImplStatus = current.implementationStatus === 'done' ? 'unassigned' : 'done'
    setComments((prev) => prev.map((c) => c.id === id
      ? { ...c, implementationStatus: nextStatus, updatedAt: new Date().toISOString() }
      : c))
    try {
      await apiUpdateImpl(API_BASE, accessToken, id, nextStatus)
    } catch (err) {
      console.error('Failed to update implementation status:', err)
      refreshComments()
    }
  }, [comments, refreshComments])

  const toggleReview = useCallback((c: Comment, target: 'accepted' | 'rejected') => {
    handleReviewStatus(c.id, c.reviewStatus === target ? 'open' : target)
  }, [handleReviewStatus])

  const handleVisibilityChange = useCallback(async (id: string, visibility: 'shared' | 'internal') => {
    const previous = comments.find((comment) => comment.id === id)?.visibility
    setComments((current) => current.map((comment) => comment.id === id
      ? { ...comment, visibility }
      : comment))
    try {
      await apiUpdateVisibility(API_BASE, accessToken, id, visibility)
    } catch (error) {
      if (previous) {
        setComments((current) => current.map((comment) => comment.id === id
          ? { ...comment, visibility: previous }
          : comment))
      }
      console.error('Failed to update feedback audience:', error)
    }
  }, [accessToken, comments])

  const toggleBulkSelect = useCallback((id: string) => {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const exitBulkMode = useCallback(() => {
    setBulkMode(false)
    setBulkSelectedIds(new Set())
  }, [])

  const applyBulkAction = useCallback(async (action: 'ready' | 'done' | 'reject') => {
    const ids = Array.from(bulkSelectedIds)
    if (ids.length === 0) return
    const idSet = new Set(ids)
    const requests = new Map(ids.map((id) => {
      const request = Symbol(id)
      reviewRequests.current.set(id, request)
      return [id, request] as const
    }))

    setComments((prev) => prev.map((c) => {
      if (!idSet.has(c.id)) return c
      const ts = new Date().toISOString()
      if (action === 'ready') return { ...c, reviewStatus: 'accepted' as ReviewStatus, updatedAt: ts }
      if (action === 'done') return { ...c, reviewStatus: 'accepted' as ReviewStatus, implementationStatus: 'done' as ImplStatus, updatedAt: ts }
      return { ...c, reviewStatus: 'rejected' as ReviewStatus, updatedAt: ts }
    }))
    exitBulkMode()

    const calls: Promise<unknown>[] = ids.flatMap((id) => {
      if (action === 'ready') return [apiUpdateReview(API_BASE, accessToken, id, 'accepted')]
      if (action === 'reject') return [apiUpdateReview(API_BASE, accessToken, id, 'rejected')]
      return [
        apiUpdateReview(API_BASE, accessToken, id, 'accepted'),
        apiUpdateImpl(API_BASE, accessToken, id, 'done'),
      ]
    })

    const results = await Promise.allSettled(calls)
    const failed = results.filter((r) => r.status === 'rejected')
    const stillCurrent = ids.some((id) => reviewRequests.current.get(id) === requests.get(id))
    if (failed.length > 0) {
      console.error(`Bulk ${action}: ${failed.length}/${calls.length} calls failed`, failed)
      if (stillCurrent) await refreshComments()
    } else if (stillCurrent) {
      await refreshComments()
    }
    for (const id of ids) {
      if (reviewRequests.current.get(id) === requests.get(id)) reviewRequests.current.delete(id)
    }
  }, [accessToken, bulkSelectedIds, exitBulkMode, refreshComments])

  const toggleSelectAllVisible = useCallback(() => {
    const visibleIds = filteredComments.map((c) => c.id)
    setBulkSelectedIds((prev) => {
      const allSelected = visibleIds.every((id) => prev.has(id))
      return allSelected ? new Set() : new Set(visibleIds)
    })
  }, [filteredComments])

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
      if (view === 'extension-comments') return
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

      if (e.key === 'Escape' && bulkMode) {
        exitBulkMode()
        return
      }

      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (cmdOpen) return

      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); goNext() }
      if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); goPrev() }
      if (e.key === ' ') { e.preventDefault(); goNext() }

      if (selectedComment && canManageFeedback) {
        if (e.key === 'a') toggleReview(selectedComment, 'accepted')
        if (e.key === 'd') toggleReview(selectedComment, 'rejected')
        if (e.key === 'm') handleToggleDone(selectedComment.id)
      }

      if (e.key === 's') setSidebarOpen((v) => !v)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goNext, goPrev, selectedComment, toggleReview, handleToggleDone, cmdOpen, bulkMode, exitBulkMode, view, canManageFeedback])

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
    if (action === 'filter-ready') selectFilter('ready')
    if (action === 'filter-done') selectFilter('done')
    if (selectedComment && canManageFeedback && action === 'accept') toggleReview(selectedComment, 'accepted')
    if (selectedComment && canManageFeedback && action === 'reject') toggleReview(selectedComment, 'rejected')
    if (selectedComment && canManageFeedback && action === 'done') handleToggleDone(selectedComment.id)
    setCmdOpen(false)
  }, [selectedComment, toggleReview, handleToggleDone, selectFilter, canManageFeedback])

  const handleCopySessionLink = useCallback(async () => {
    if (!agentSession) return
    setCopyStatus('copying')
    try {
      await copyPrompt(selectedAgentMeta.target)
      setCopyStatus('copied')
      window.setTimeout(() => setCopyStatus('idle'), 1600)
    } catch (err) {
      console.error('Copy prompt failed:', err)
      setCopyStatus('error')
      window.setTimeout(() => setCopyStatus('idle'), 1600)
    }
  }, [agentSession, copyPrompt, selectedAgentMeta])

  // Selecting a project always returns to the feedback view; settings is a
  // per-project overlay that shouldn't persist across project switches.
  const selectProject = useCallback((key: string) => {
    setSelectedProject(key)
    setView('feedback')
  }, [])

  const openExtensionComments = useCallback(() => {
    setView('extension-comments')
    setSelectedProject('')
    setSelectedCommentId('')
    setPendingCommentSelection(null)
    setCmdOpen(false)
    exitBulkMode()
  }, [exitBulkMode])

  const handleAddProject = useCallback(async (projectKey: string, name: string) => {
    setAddProjectError(null)
    setAddProjectBusy(true)
    try {
      const project = await claimProject(projectKey, name)
      setSelectedProject(project.publicKey)
      setView('feedback')
      setStatusFilter('all')
      setSelectedCommentId('')
      setAddProjectOpen(false)
    } catch (err) {
      setAddProjectError(err instanceof Error ? err.message : 'Failed to create project')
    } finally {
      setAddProjectBusy(false)
    }
  }, [claimProject])

  const handleOpenCommentActivity = useCallback((payload: { projectKey: string; latestCommentId?: string }) => {
    setSelectedProject(payload.projectKey)
    setView('feedback')
    setStatusFilter('all')
    if (payload.latestCommentId) {
      setPendingCommentSelection({ projectKey: payload.projectKey, commentId: payload.latestCommentId })
      void refreshComments()
    } else {
      setSelectedCommentId('')
    }
  }, [refreshComments])

  // Onboarding gate: show the welcome screen when this account has no
  // projects and hasn't been onboarded before. Once they click the CTA we
  // mark the flag so the welcome doesn't reappear if they cancel out of
  // the create-project modal.
  const [onboarded, setOnboarded] = useState(() => (typeof window === 'undefined' ? true : isOnboarded()))
  const showWelcome = !projectsLoading && projects.length === 0 && !onboarded && view !== 'extension-comments'

  if (showWelcome) {
    return (
      <>
        <WelcomeScreen
          onOpenExtensionComments={openExtensionComments}
          onCreateProject={() => {
            markOnboarded()
            setOnboarded(true)
            setAddProjectOpen(true)
          }}
        />
        {addProjectOpen && (
          <AddProjectPopover
            onAdd={handleAddProject}
            onClose={() => setAddProjectOpen(false)}
            checkAvailability={checkAvailability}
            busy={addProjectBusy}
            error={addProjectError}
          />
        )}
      </>
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        projects={projects}
        projectsLoading={projectsLoading}
        projectsError={projectsError}
        commentsLoading={commentsLoading}
        selectedProject={selectedProject}
        commentCount={comments.length}
        setSelectedProject={selectProject}
        setStatusFilter={setStatusFilter}
        setSelectedCommentId={setSelectedCommentId}
        addProjectOpen={addProjectOpen}
        setAddProjectOpen={setAddProjectOpen}
        onAddProject={handleAddProject}
        onCheckAvailability={checkAvailability}
        addProjectBusy={addProjectBusy}
        addProjectError={addProjectError}
        onOpenCmd={() => setCmdOpen(true)}
        onOpenSettings={() => setView((v) => (v === 'settings' ? 'feedback' : 'settings'))}
        canManageProject={canManageProject}
        settingsActive={view === 'settings'}
        onOpenExtensionComments={openExtensionComments}
        extensionCommentsActive={view === 'extension-comments'}
        apiBase={API_BASE}
        accessToken={accessToken}
        onProjectsChanged={refreshProjects}
        onOpenCommentActivity={handleOpenCommentActivity}
        theme={theme}
        toggleTheme={() => setTheme((t) => t === 'light' ? 'dark' : 'light')}
        user={user}
        onSignOut={onSignOut}
        superadmin={superadmin}
        superAdminActive={view === 'super-admin'}
        onOpenSuperAdmin={() => setView((v) => (v === 'super-admin' ? 'feedback' : 'super-admin'))}
      />

      {view === 'extension-comments' ? (
        <ExtensionCommentsPage apiBase={API_BASE} accessToken={accessToken} projects={projects} />
      ) : view === 'super-admin' && superadmin ? (
        <SuperAdminPanel apiBase={API_BASE} accessToken={accessToken} />
      ) : view === 'settings' && activeProject ? (
        <ProjectSettings
          key={activeProject.publicKey}
          project={activeProject}
          apiBase={API_BASE}
          accessToken={accessToken}
          currentUserId={user.id}
          onBack={() => setView('feedback')}
          onProjectsChanged={refreshProjects}
        />
      ) : (
      <div className="flex flex-1 overflow-hidden">
        <CommentList
          readOnly={!canManageFeedback}
          filteredComments={filteredComments}
          counts={counts}
          statusFilter={statusFilter}
          selectFilter={selectFilter}
          bulkMode={bulkMode}
          enterBulkMode={() => setBulkMode(true)}
          exitBulkMode={exitBulkMode}
          bulkSelectedIds={bulkSelectedIds}
          toggleSelectAllVisible={toggleSelectAllVisible}
          applyBulkAction={applyBulkAction}
          toggleBulkSelect={toggleBulkSelect}
          commentsLoading={commentsLoading}
          commentsError={commentsError}
          selectedCommentId={selectedCommentId}
          setSelectedCommentId={setSelectedCommentId}
        />

        <CommentDetail
          readOnly={!canManageFeedback}
          selectedComment={selectedComment}
          selectedProject={selectedProject}
          commentsLoading={commentsLoading}
          commentsError={commentsError}
          projectComments={projectComments}
          filteredComments={filteredComments}
          selectedIdx={selectedIdx}
          goPrev={goPrev}
          goNext={goNext}
          toggleReview={toggleReview}
          handleToggleDone={handleToggleDone}
          onVisibilityChange={handleVisibilityChange}
          apiBase={API_BASE}
          accessToken={accessToken}
        />

        {sidebarOpen && canOperateAgent && (
          <AgentSidebar
            selectedProject={selectedProject}
            projectComments={projectComments}
            readyCount={counts.ready}
            filtered={statusFilter === 'ready'}
            selectedCommentId={selectedCommentId}
            onSelectComment={setSelectedCommentId}
            agentSession={agentSession}
            agentEvents={agentEvents}
            agentError={agentError}
            agentConnected={agentConnected}
            selectedAgent={selectedAgent}
            setSelectedAgent={setSelectedAgent}
            selectedAgentMeta={selectedAgentMeta}
            agentDropdownOpen={agentDropdownOpen}
            setAgentDropdownOpen={setAgentDropdownOpen}
            copyStatus={copyStatus}
            onCopySessionLink={handleCopySessionLink}
            onClose={() => setSidebarOpen(false)}
          />
        )}
      </div>
      )}

      <StatusBar personal={view === 'extension-comments'} sidebarOpen={sidebarOpen} onShowSidebar={() => setSidebarOpen(true)} />

      {cmdOpen && (
        <CommandPalette
          onClose={() => setCmdOpen(false)}
          comments={projectComments}
          onSelect={handleCmdSelect}
          onAction={handleCmdAction}
          selectedCommentId={selectedCommentId}
          canManageFeedback={canManageFeedback}
          canOperateAgent={canOperateAgent}
        />
      )}
    </div>
  )
}

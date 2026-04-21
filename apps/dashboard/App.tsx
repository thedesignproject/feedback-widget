import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  createShare,
  getPrompt,
  getShareEvents,
  getShareState,
  listComments,
  listProjects,
  updateReviewStatus,
  type CommentRecord,
  type Project,
  type ShareCreationResponse,
  type ShareState,
} from './api'

const initialApiBase = import.meta.env.VITE_API_BASE || `${window.location.origin}/api`
const initialReviewerToken = import.meta.env.VITE_REVIEWER_TOKEN || localStorage.getItem('feedback-reviewer-token') || ''

export function App() {
  const [apiBase, setApiBase] = useState(initialApiBase)
  const [reviewerToken, setReviewerToken] = useState(initialReviewerToken)
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<string>('')
  const [comments, setComments] = useState<CommentRecord[]>([])
  const [pageFilter, setPageFilter] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [activeShare, setActiveShare] = useState<ShareCreationResponse | null>(null)
  const [shareState, setShareState] = useState<ShareState | null>(null)
  const [shareEvents, setShareEvents] = useState<Array<{
    id: number
    eventType: string
    actorId: string
    createdAt: string
    commentId: string | null
  }>>([])
  const [eventsCursor, setEventsCursor] = useState(0)
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [loadingComments, setLoadingComments] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  useEffect(() => {
    localStorage.setItem('feedback-reviewer-token', reviewerToken)
  }, [reviewerToken])

  useEffect(() => {
    if (!reviewerToken) return
    setLoadingProjects(true)
    setError(null)

    listProjects(apiBase, reviewerToken)
      .then((items) => {
        setProjects(items)
        setSelectedProject((current) => current || items[0]?.publicKey || '')
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load projects'))
      .finally(() => setLoadingProjects(false))
  }, [apiBase, reviewerToken])

  useEffect(() => {
    if (!reviewerToken || !selectedProject) return

    setLoadingComments(true)
    setError(null)
    listComments(apiBase, reviewerToken, selectedProject, pageFilter || undefined)
      .then((items) => {
        setComments(items)
        setSelectedIds((current) => current.filter((id) => items.some((comment) => comment.id === id)))
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load comments'))
      .finally(() => setLoadingComments(false))
  }, [apiBase, pageFilter, reviewerToken, selectedProject])

  useEffect(() => {
    if (!activeShare) return
    const poll = async () => {
      try {
        const share = await getShareState(apiBase, activeShare.slug, activeShare.token)
        setShareState(share)

        const events = await getShareEvents(apiBase, activeShare.slug, activeShare.token, eventsCursor)
        if (events.events.length > 0) {
          setShareEvents((current) => {
            const next = [...current, ...events.events.map((event) => ({
              id: event.id,
              eventType: event.eventType,
              actorId: event.actorId,
              createdAt: event.createdAt,
              commentId: event.commentId,
            }))]
            return next.slice(-40)
          })
          setEventsCursor(events.nextCursor)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not poll share state')
      }
    }

    poll()
    const timer = window.setInterval(poll, 5000)
    return () => window.clearInterval(timer)
  }, [activeShare, apiBase, eventsCursor])

  const pageOptions = useMemo(() => {
    return Array.from(new Set(comments.map((comment) => comment.pageUrl))).sort()
  }, [comments])

  const selectedComments = useMemo(() => {
    return comments.filter((comment) => selectedIds.includes(comment.id))
  }, [comments, selectedIds])

  const acceptedSelection = selectedComments.filter((comment) => comment.reviewStatus === 'accepted')

  async function copyPrompt(target: 'codex' | 'claude-code' | 'generic') {
    if (!activeShare) return
    setBusyAction(`prompt:${target}`)
    setError(null)
    try {
      const response = await getPrompt(apiBase, reviewerToken, activeShare.shareId, target)
      setPrompt(response.prompt)
      await navigator.clipboard.writeText(response.prompt)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not copy prompt')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleReviewStatus(commentId: string, reviewStatus: CommentRecord['reviewStatus']) {
    setBusyAction(commentId)
    setError(null)
    try {
      const updated = await updateReviewStatus(apiBase, reviewerToken, commentId, reviewStatus)
      setComments((current) => current.map((comment) => comment.id === commentId ? updated : comment))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update review status')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleCreatePageShare() {
    if (!selectedProject || !pageFilter) return
    setBusyAction('page-share')
    setError(null)
    try {
      const share = await createShare(apiBase, reviewerToken, {
        projectId: selectedProject,
        scopeType: 'page',
        pageUrl: pageFilter,
      })
      setActiveShare(share)
      setShareEvents([])
      setEventsCursor(0)
      setPrompt('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create page share')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleCreateSelectionShare() {
    if (!selectedProject || acceptedSelection.length === 0) return
    setBusyAction('selection-share')
    setError(null)
    try {
      const share = await createShare(apiBase, reviewerToken, {
        projectId: selectedProject,
        scopeType: 'selection',
        commentIds: acceptedSelection.map((comment) => comment.id),
      })
      setActiveShare(share)
      setShareEvents([])
      setEventsCursor(0)
      setPrompt('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create selection share')
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)',
      color: '#0f172a',
      fontFamily: '"IBM Plex Sans", "Segoe UI", sans-serif',
      padding: 24,
      boxSizing: 'border-box',
    }}>
      <div style={{
        maxWidth: 1440,
        margin: '0 auto',
        display: 'grid',
        gap: 20,
      }}>
        <header style={{
          display: 'grid',
          gap: 16,
          padding: 20,
          borderRadius: 24,
          background: '#ffffff',
          boxShadow: '0 24px 60px rgba(15, 23, 42, 0.08)',
        }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#6366f1' }}>
              Reviewer Console
            </div>
            <h1 style={{ margin: '8px 0 0', fontSize: 32, lineHeight: 1.05 }}>Feedback to agent handoff</h1>
          </div>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '2fr 1fr 1fr' }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>API base</span>
              <input value={apiBase} onChange={(event) => setApiBase(event.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Reviewer token</span>
              <input value={reviewerToken} onChange={(event) => setReviewerToken(event.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Project</span>
              <select value={selectedProject} onChange={(event) => setSelectedProject(event.target.value)} style={inputStyle}>
                <option value="">Select a project</option>
                {projects.map((project) => (
                  <option key={project.publicKey} value={project.publicKey}>{project.name}</option>
                ))}
              </select>
            </label>
          </div>
        </header>

        {error && (
          <div style={{
            padding: '14px 18px',
            borderRadius: 18,
            background: '#fee2e2',
            color: '#991b1b',
            fontWeight: 600,
          }}>
            {error}
          </div>
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gap: 20,
          alignItems: 'start',
        }}>
          <section style={panelStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#64748b' }}>
                  Feedback
                </div>
                <h2 style={{ margin: '6px 0 0', fontSize: 24 }}>Review comments</h2>
              </div>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Page scope</span>
                <select value={pageFilter} onChange={(event) => setPageFilter(event.target.value)} style={inputStyle}>
                  <option value="">All pages</option>
                  {pageOptions.map((page) => (
                    <option key={page} value={page}>{page}</option>
                  ))}
                </select>
              </label>
            </div>

            {loadingProjects || loadingComments ? (
              <div style={{ color: '#475569' }}>Loading…</div>
            ) : comments.length === 0 ? (
              <div style={{ color: '#475569' }}>No comments yet for this filter.</div>
            ) : (
              <div style={{ display: 'grid', gap: 14 }}>
                {comments.map((comment) => {
                  const selected = selectedIds.includes(comment.id)
                  const accepted = comment.reviewStatus === 'accepted'
                  return (
                    <article key={comment.id} style={{
                      borderRadius: 22,
                      padding: 18,
                      background: accepted ? '#f8fafc' : '#ffffff',
                      border: accepted ? '1px solid #c7d2fe' : '1px solid rgba(15,23,42,0.08)',
                      boxShadow: '0 18px 40px rgba(15, 23, 42, 0.05)',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 10 }}>
                        <div style={{ display: 'grid', gap: 4 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#6366f1' }}>
                            {comment.reviewStatus} · {comment.implementationStatus}
                          </div>
                          <div style={{ fontSize: 12, color: '#475569' }}>{comment.pageUrl}</div>
                        </div>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155' }}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={(event) => {
                              setSelectedIds((current) => event.target.checked
                                ? [...current, comment.id]
                                : current.filter((id) => id !== comment.id))
                            }}
                          />
                          Select
                        </label>
                      </div>
                      <div style={{ fontSize: 18, lineHeight: 1.4, marginBottom: 12 }}>{comment.body}</div>
                      <div style={{
                        fontSize: 12,
                        color: '#475569',
                        padding: '8px 12px',
                        borderRadius: 12,
                        background: '#e2e8f0',
                        marginBottom: 14,
                        fontFamily: '"IBM Plex Mono", "SFMono-Regular", monospace',
                      }}>
                        {comment.selector}
                      </div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          disabled={busyAction === comment.id}
                          onClick={() => handleReviewStatus(comment.id, 'accepted')}
                          style={actionButton('#0f766e', '#ecfeff')}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          disabled={busyAction === comment.id}
                          onClick={() => handleReviewStatus(comment.id, 'rejected')}
                          style={actionButton('#9f1239', '#fff1f2')}
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          disabled={busyAction === comment.id}
                          onClick={() => handleReviewStatus(comment.id, 'open')}
                          style={actionButton('#475569', '#f8fafc')}
                        >
                          Re-open
                        </button>
                        {comment.claimedByAgentId && (
                          <span style={{
                            padding: '8px 12px',
                            borderRadius: 9999,
                            background: '#dbeafe',
                            color: '#1d4ed8',
                            fontSize: 12,
                            fontWeight: 700,
                          }}>
                            Claimed by {comment.claimedByAgentId}
                          </span>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <aside style={{ display: 'grid', gap: 20 }}>
            <section style={panelStyle}>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#64748b' }}>
                  Share
                </div>
                <h2 style={{ margin: '6px 0 0', fontSize: 24 }}>Agent handoff</h2>
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                <button
                  type="button"
                  disabled={!pageFilter || busyAction === 'page-share'}
                  onClick={handleCreatePageShare}
                  style={primaryButton}
                >
                  Create page share
                </button>
                <button
                  type="button"
                  disabled={acceptedSelection.length === 0 || busyAction === 'selection-share'}
                  onClick={handleCreateSelectionShare}
                  style={secondaryButton}
                >
                  Create selection share
                </button>
                <div style={{ fontSize: 12, color: '#475569' }}>
                  {acceptedSelection.length} accepted comment(s) selected
                </div>
              </div>

              {activeShare && (
                <div style={{
                  marginTop: 18,
                  paddingTop: 18,
                  borderTop: '1px solid rgba(15,23,42,0.08)',
                  display: 'grid',
                  gap: 12,
                }}>
                  <div style={{ fontSize: 12, color: '#475569' }}>Share slug: <strong>{activeShare.slug}</strong></div>
                  <div style={{ fontSize: 12, color: '#475569' }}>Expires: <strong>{new Date(activeShare.expiresAt).toLocaleString()}</strong></div>
                  <textarea value={activeShare.tokenUrl} readOnly rows={3} style={{ ...inputStyle, resize: 'none', fontFamily: '"IBM Plex Mono", monospace' }} />
                  <div style={{ display: 'grid', gap: 8 }}>
                    <button type="button" onClick={() => copyPrompt('codex')} disabled={busyAction === 'prompt:codex'} style={primaryButton}>
                      Copy Codex prompt
                    </button>
                    <button type="button" onClick={() => copyPrompt('claude-code')} disabled={busyAction === 'prompt:claude-code'} style={secondaryButton}>
                      Copy Claude Code prompt
                    </button>
                    <button type="button" onClick={() => copyPrompt('generic')} disabled={busyAction === 'prompt:generic'} style={secondaryButton}>
                      Copy generic prompt
                    </button>
                  </div>
                </div>
              )}
            </section>

            <section style={panelStyle}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#64748b' }}>
                  Live state
                </div>
                <h2 style={{ margin: '6px 0 0', fontSize: 24 }}>Agent activity</h2>
              </div>

              {!activeShare ? (
                <div style={{ color: '#475569' }}>Create a share to start polling state and events.</div>
              ) : (
                <div style={{ display: 'grid', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Presence</div>
                    {shareState?.presence.length ? (
                      <div style={{ display: 'grid', gap: 8 }}>
                        {shareState.presence.map((presence) => (
                          <div key={presence.agentId} style={{
                            padding: 12,
                            borderRadius: 16,
                            background: '#eff6ff',
                            color: '#1e3a8a',
                          }}>
                            <div style={{ fontWeight: 700 }}>{presence.agentId}</div>
                            <div>{presence.status}</div>
                            {presence.summary && <div style={{ fontSize: 13 }}>{presence.summary}</div>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: '#475569' }}>No active agent connected.</div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Recent events</div>
                    {shareEvents.length ? (
                      <div style={{ display: 'grid', gap: 8, maxHeight: 280, overflow: 'auto' }}>
                        {shareEvents.slice().reverse().map((event) => (
                          <div key={event.id} style={{
                            padding: 12,
                            borderRadius: 16,
                            background: '#f8fafc',
                            border: '1px solid rgba(15,23,42,0.08)',
                          }}>
                            <div style={{ fontWeight: 700 }}>{event.eventType}</div>
                            <div style={{ fontSize: 13, color: '#475569' }}>{event.actorId}</div>
                            <div style={{ fontSize: 12, color: '#64748b' }}>{new Date(event.createdAt).toLocaleTimeString()}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: '#475569' }}>No events yet.</div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Prompt</div>
                    <textarea value={prompt} readOnly rows={14} style={{ ...inputStyle, resize: 'vertical', fontFamily: '"IBM Plex Mono", monospace' }} />
                  </div>
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  )
}

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid rgba(15,23,42,0.1)',
  borderRadius: 16,
  padding: '12px 14px',
  background: '#f8fafc',
  color: '#0f172a',
  font: 'inherit',
}

const panelStyle: CSSProperties = {
  background: '#ffffff',
  borderRadius: 24,
  padding: 20,
  boxShadow: '0 24px 60px rgba(15, 23, 42, 0.08)',
}

const primaryButton: CSSProperties = {
  border: 'none',
  borderRadius: 16,
  padding: '12px 16px',
  background: '#111827',
  color: '#ffffff',
  fontWeight: 700,
  cursor: 'pointer',
}

const secondaryButton: CSSProperties = {
  border: '1px solid rgba(15,23,42,0.12)',
  borderRadius: 16,
  padding: '12px 16px',
  background: '#ffffff',
  color: '#0f172a',
  fontWeight: 700,
  cursor: 'pointer',
}

function actionButton(color: string, background: string): CSSProperties {
  return {
    border: 'none',
    borderRadius: 9999,
    padding: '8px 12px',
    background,
    color,
    cursor: 'pointer',
    fontWeight: 700,
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { getSelector } from '../lib/getSelector'

interface FeedbackWidgetProps {
  projectId: string
  apiBase: string
}

type Mode = 'idle' | 'selecting' | 'commenting'

interface ClickTarget {
  selector: string
  xPercent: number
  yPercent: number
  url: string
  clickX: number
  clickY: number
}

interface Comment {
  id: string
  project_id: string
  url: string
  x: number
  y: number
  element: string
  comment: string
  created_at: string
}

const WIDGET_ATTR = 'data-fw'

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function FeedbackWidget({ projectId, apiBase }: FeedbackWidgetProps) {
  const [mode, setMode] = useState<Mode>('idle')
  const [target, setTarget] = useState<ClickTarget | null>(null)
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [hovered, setHovered] = useState<Element | null>(null)
  const [btnHover, setBtnHover] = useState(false)

  // Sidebar state
  const [comments, setComments] = useState<Comment[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [newCommentIds, setNewCommentIds] = useState<Set<string>>(new Set())
  const [badgeAnim, setBadgeAnim] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  // Synchronous guard — state updates are async, so double-firing handleSend
  // in the same tick (e.g. Cmd+Enter held down) would otherwise slip past `sending`.
  const sendingRef = useRef(false)

  // --- Fetch comments on mount ---
  useEffect(() => {
    async function fetchComments() {
      try {
        const res = await fetch(`${apiBase}/comments?projectId=${encodeURIComponent(projectId)}`)
        if (!res.ok) return
        const data = await res.json()
        if (Array.isArray(data)) {
          setComments(data)
        }
      } catch {
        // endpoint not ready yet — use empty array
      }
    }
    fetchComments()
  }, [projectId, apiBase])

  // --- Set crosshair cursor on body when selecting ---
  useEffect(() => {
    if (mode !== 'selecting') return
    const prev = document.body.style.cursor
    document.body.style.cursor = 'crosshair'
    return () => {
      document.body.style.cursor = prev
    }
  }, [mode])

  // --- Highlight hovered element ---
  useEffect(() => {
    if (mode !== 'selecting') {
      setHovered(null)
      return
    }

    function onMove(e: MouseEvent) {
      const el = e.target as HTMLElement
      if (el && !el.closest?.(`[${WIDGET_ATTR}]`)) {
        setHovered(el)
      } else {
        setHovered(null)
      }
    }

    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [mode])

  // --- Apply/remove highlight outline on hovered element ---
  useEffect(() => {
    if (!hovered) return
    const el = hovered as HTMLElement
    const prev = el.style.outline
    const prevOffset = el.style.outlineOffset
    el.style.outline = '2px solid rgba(59, 130, 246, 0.6)'
    el.style.outlineOffset = '2px'
    return () => {
      el.style.outline = prev
      el.style.outlineOffset = prevOffset
    }
  }, [hovered])

  // --- Handle element click in selecting mode ---
  useEffect(() => {
    if (mode !== 'selecting') return

    function onClick(e: MouseEvent) {
      const el = e.target as HTMLElement
      if (el.closest?.(`[${WIDGET_ATTR}]`)) return

      e.preventDefault()
      e.stopPropagation()

      setTarget({
        selector: getSelector(el),
        xPercent: (e.clientX / window.innerWidth) * 100,
        yPercent: (e.clientY / window.innerHeight) * 100,
        url: window.location.href,
        clickX: e.clientX,
        clickY: e.clientY,
      })
      setMode('commenting')
    }

    window.addEventListener('click', onClick, true)
    return () => window.removeEventListener('click', onClick, true)
  }, [mode])

  // --- Auto-focus textarea ---
  useEffect(() => {
    if (mode === 'commenting' && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [mode])

  // --- Send comment ---
  const handleSend = useCallback(async () => {
    if (!comment.trim() || !target || sendingRef.current) return

    sendingRef.current = true
    setSending(true)

    const commentText = comment.trim()
    const targetData = { ...target }

    try {
      const res = await fetch(`${apiBase}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          url: targetData.url,
          x: targetData.xPercent,
          y: targetData.yPercent,
          element: targetData.selector,
          comment: commentText,
        }),
      })

      if (!res.ok) {
        console.warn('[FeedbackWidget] API returned', res.status)
        return
      }

      const newComment: Comment = {
        id: crypto.randomUUID(),
        project_id: projectId,
        url: targetData.url,
        x: targetData.xPercent,
        y: targetData.yPercent,
        element: targetData.selector,
        comment: commentText,
        created_at: new Date().toISOString(),
      }

      setComments((prev) => [newComment, ...prev])
      setNewCommentIds((prev) => new Set(prev).add(newComment.id))

      setBadgeAnim(true)
      setTimeout(() => setBadgeAnim(false), 400)

      setTimeout(() => {
        setNewCommentIds((prev) => {
          const next = new Set(prev)
          next.delete(newComment.id)
          return next
        })
      }, 2000)

      setTarget(null)
      setComment('')
      setHovered(null)
      setMode('selecting')
      setShowSuccess(true)

      setTimeout(() => {
        setShowSuccess(false)
        setSidebarOpen(true)
      }, 800)
    } catch (err) {
      console.warn('[FeedbackWidget] API error:', err)
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }, [comment, target, projectId, apiBase])

  // --- Keyboard: Escape to cancel popover / close sidebar, Cmd+Enter to send ---
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (mode === 'commenting') {
          // Close popover, stay in selecting mode
          setTarget(null)
          setComment('')
          setSending(false)
          setMode('selecting')
        } else if (sidebarOpen) {
          setSidebarOpen(false)
        }
        // Don't exit selecting mode on Escape — only the eye button does that
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && mode === 'commenting') {
        handleSend()
      }
    }
    if (mode !== 'idle' || sidebarOpen) {
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }
  }, [mode, handleSend, sidebarOpen])

  function reset() {
    setMode('idle')
    setTarget(null)
    setComment('')
    setSending(false)
    setShowSuccess(false)
    setHovered(null)
  }

  function exitFeedbackMode() {
    setMode('idle')
    setTarget(null)
    setComment('')
    setSending(false)
    setShowSuccess(false)
    setHovered(null)
  }

  function enterFeedbackMode() {
    // Keep sidebar open — user can comment while viewing the list
    setMode('selecting')
  }

  function handleEyeClick() {
    if (mode !== 'idle') {
      // In feedback mode — exit it, keep sidebar open
      exitFeedbackMode()
    } else if (comments.length > 0) {
      // Has comments, not in feedback mode — toggle sidebar
      setSidebarOpen((v) => !v)
    } else {
      // No comments — enter feedback mode
      setMode('selecting')
    }
  }

  // --- Highlight element from comment ---
  function highlightElement(selector: string) {
    try {
      const el = document.querySelector(selector)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('fw-highlight')
      setTimeout(() => el.classList.remove('fw-highlight'), 1400)
    } catch {
      // invalid selector — fail silently
    }
  }

  // --- Popover position ---
  const popoverStyle = (): React.CSSProperties => {
    if (!target) return { display: 'none' }
    const pad = 12
    const popW = 300
    const popH = 180
    let left = target.clickX + pad
    let top = target.clickY + pad
    if (left + popW > window.innerWidth) left = target.clickX - popW - pad
    if (top + popH > window.innerHeight) top = target.clickY - popH - pad
    if (left < pad) left = pad
    if (top < pad) top = pad
    return {
      position: 'fixed',
      left,
      top,
      zIndex: 2147483646,
    }
  }

  const commentCount = comments.length

  return (
    <div {...{ [WIDGET_ATTR]: '' }}>
      {/* Overlay — purely visual, clicks pass through */}
      {mode === 'selecting' && (
        <div
          {...{ [WIDGET_ATTR]: '' }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2147483644,
            pointerEvents: 'none',
            background: 'transparent',
          }}
        />
      )}

      {/* Popover */}
      {mode === 'commenting' && target && (
        <>
          <div
            {...{ [WIDGET_ATTR]: '' }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 2147483645,
              background: 'rgba(0, 0, 0, 0.05)',
            }}
            onClick={() => {
              setTarget(null)
              setComment('')
              setSending(false)
              setMode('selecting')
            }}
          />
          <div
            ref={popoverRef}
            {...{ [WIDGET_ATTR]: '' }}
            style={{
              ...popoverStyle(),
              width: 300,
              background: '#fff',
              borderRadius: 10,
              boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)',
              padding: 16,
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            }}
          >
            <textarea
              ref={textareaRef}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What would you change?"
              rows={3}
              style={{
                width: '100%',
                border: '1px solid #e0e0e0',
                borderRadius: 6,
                padding: '8px 10px',
                fontSize: 14,
                fontFamily: 'inherit',
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.15s',
              }}
              onFocus={(e) => (e.target.style.borderColor = '#3b82f6')}
              onBlur={(e) => (e.target.style.borderColor = '#e0e0e0')}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button
                onClick={handleSend}
                disabled={!comment.trim() || sending}
                style={{
                  padding: '6px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#fff',
                  background: !comment.trim() || sending ? '#a0a0a0' : '#111',
                  border: 'none',
                  borderRadius: 6,
                  cursor: !comment.trim() || sending ? 'default' : 'pointer',
                  transition: 'background 0.15s',
                }}
              >
                {sending ? 'Sending\u2026' : 'Send \u2192'}
              </button>
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 11,
                color: '#999',
                textAlign: 'right',
              }}
            >
              \u2318+Enter to send \u00b7 Esc to cancel
            </div>
          </div>
        </>
      )}

      {/* Pin marker at clicked position */}
      {mode === 'commenting' && target && (
        <div
          {...{ [WIDGET_ATTR]: '' }}
          style={{
            position: 'fixed',
            left: target.clickX - 6,
            top: target.clickY - 6,
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: '#3b82f6',
            border: '2px solid #fff',
            boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
            zIndex: 2147483646,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Sidebar */}
      <div
        {...{ [WIDGET_ATTR]: '' }}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 320,
          zIndex: 9999,
          background: '#111',
          borderLeft: '1px solid #222',
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        {/* Sidebar header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '16px 16px 12px',
            borderBottom: '1px solid #222',
          }}
        >
          {/* Small eye icon */}
          <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="13" stroke="#fff" strokeWidth="1.5" fill="none" />
            <circle cx="16" cy="16" r="6" fill="#fff" />
            <circle cx="16" cy="16" r="3" fill="#111" />
            <circle cx="18.5" cy="13.5" r="1.2" fill="#fff" />
          </svg>
          <span style={{ color: '#fff', fontSize: 14, fontWeight: 600, flex: 1 }}>
            Feedback
          </span>
          <span style={{ color: '#555', fontSize: 12 }}>
            {commentCount} comment{commentCount !== 1 ? 's' : ''}
          </span>
          <button
            onClick={() => setSidebarOpen(false)}
            style={{
              background: 'none',
              border: 'none',
              color: '#666',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#666')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Comment list */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {comments.length === 0 && (
            <div style={{ color: '#444', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
              No comments yet
            </div>
          )}
          {comments.map((c, i) => {
            const isNew = newCommentIds.has(c.id)
            return (
              <div
                key={c.id}
                onClick={() => highlightElement(c.element)}
                style={{
                  background: isNew ? '#1e2a1e' : '#1a1a1a',
                  borderRadius: 8,
                  padding: 12,
                  borderLeft: '2px solid #3b82f6',
                  cursor: 'pointer',
                  animation: sidebarOpen
                    ? isNew
                      ? 'fw-slide-in-new 0.3s ease both'
                      : `fw-slide-in 0.3s ease ${i * 0.08}s both`
                    : 'none',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (!isNew) e.currentTarget.style.background = '#222'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isNew ? '#1e2a1e' : '#1a1a1a'
                }}
              >
                <div style={{ color: '#fff', fontSize: 14, lineHeight: 1.4, marginBottom: 8 }}>
                  {c.comment}
                </div>
                <div
                  style={{
                    fontFamily: '"SF Mono", "Fira Code", "Fira Mono", Menlo, monospace',
                    color: '#666',
                    fontSize: 11,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    marginBottom: 2,
                  }}
                >
                  {c.element}
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span
                    style={{
                      color: '#666',
                      fontSize: 11,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '60%',
                    }}
                  >
                    {c.url.replace(/^https?:\/\//, '')}
                  </span>
                  <span style={{ color: '#444', fontSize: 11, flexShrink: 0 }}>
                    {timeAgo(c.created_at)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Leave feedback button */}
        <div style={{ padding: 12, borderTop: '1px solid #222' }}>
          {mode !== 'idle' ? (
            <button
              onClick={() => {
                exitFeedbackMode()
                setSidebarOpen(false)
              }}
              style={{
                width: '100%',
                padding: '10px 0',
                fontSize: 13,
                fontWeight: 600,
                color: '#fff',
                background: '#22c55e',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#16a34a')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#22c55e')}
            >
              <svg width="14" height="14" viewBox="0 0 28 28" fill="none">
                <path
                  d="M5 14.5L11 20.5L23 8.5"
                  stroke="#fff"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Done
            </button>
          ) : (
            <button
              onClick={enterFeedbackMode}
              style={{
                width: '100%',
                padding: '10px 0',
                fontSize: 13,
                fontWeight: 600,
                color: '#fff',
                background: '#3b82f6',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#2563eb')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#3b82f6')}
            >
              <svg width="14" height="14" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="13" stroke="#fff" strokeWidth="2" fill="none" />
                <circle cx="16" cy="16" r="6" fill="#fff" />
                <circle cx="16" cy="16" r="3" fill="#3b82f6" />
              </svg>
              Leave feedback
            </button>
          )}
        </div>
      </div>

      {/* Trigger button — hidden when sidebar is open and idle */}
      {!sidebarOpen && (
      <div
        {...{ [WIDGET_ATTR]: '' }}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 2147483647,
          transition: 'right 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <button
          onClick={handleEyeClick}
          onMouseEnter={() => setBtnHover(true)}
          onMouseLeave={() => setBtnHover(false)}
          style={{
            width: 64,
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            border: 'none',
            borderRadius: '50%',
            cursor: 'pointer',
            background:
              mode === 'selecting' || mode === 'commenting'
                ? '#c0392b'
                : btnHover
                  ? '#222'
                  : '#111',
            boxShadow: showSuccess
              ? '0 0 0 3px #22c55e, 0 4px 16px rgba(0,0,0,0.2)'
              : mode === 'selecting' || mode === 'commenting'
                ? '0 0 0 3px #3b82f6, 0 4px 16px rgba(0,0,0,0.2)'
                : '0 4px 16px rgba(0,0,0,0.2)',
            transition: 'background 0.2s, box-shadow 0.2s, transform 0.15s',
            transform: btnHover ? 'scale(1.06)' : 'scale(1)',
          }}
        >
          {showSuccess ? (
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path
                d="M7 14.5L12 19.5L21 9.5"
                stroke="#22c55e"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : mode === 'selecting' || mode === 'commenting' ? (
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <line x1="9" y1="9" x2="19" y2="19" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
              <line x1="19" y1="9" x2="9" y2="19" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="13" stroke="#fff" strokeWidth="1.5" fill="none" />
              <circle
                cx="16"
                cy="16"
                r={btnHover ? 7 : 6}
                fill="#fff"
                style={{ transition: 'r 0.2s' }}
              />
              <circle cx="16" cy="16" r="3" fill="#111" />
              <circle cx="18.5" cy="13.5" r="1.2" fill="#fff" />
            </svg>
          )}
        </button>

        {/* Badge */}
        {commentCount > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setSidebarOpen((v) => !v)
            }}
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 22,
              height: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 6px',
              background: '#3b82f6',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              border: '2px solid #111',
              borderRadius: 11,
              cursor: 'pointer',
              animation: badgeAnim ? 'fw-badge-pop 0.4s ease' : 'none',
              transition: 'transform 0.15s',
            }}
          >
            {commentCount}
          </button>
        )}
      </div>
      )}

      {/* Keyframes */}
      <style>{`
        @keyframes fw-badge-pop {
          0% { transform: scale(1); }
          30% { transform: scale(1.3); }
          100% { transform: scale(1); }
        }
        @keyframes fw-slide-in {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes fw-slide-in-new {
          0% { opacity: 0; transform: translateY(-12px); }
          50% { background: #1e3a1e; }
          100% { opacity: 1; transform: translateY(0); }
        }
        .fw-highlight {
          outline: 2px solid #3b82f6 !important;
          outline-offset: 2px !important;
          background-color: rgba(59, 130, 246, 0.15) !important;
          animation: fw-highlight-pulse 1.4s ease both !important;
        }
        @keyframes fw-highlight-pulse {
          0% { outline-color: transparent; background-color: transparent; }
          14% { outline-color: #3b82f6; background-color: rgba(59, 130, 246, 0.15); }
          71% { outline-color: #3b82f6; background-color: rgba(59, 130, 246, 0.15); }
          100% { outline-color: transparent; background-color: transparent; }
        }
      `}</style>
    </div>
  )
}

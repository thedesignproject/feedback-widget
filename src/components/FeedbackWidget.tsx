import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageCircle, LogOut, Menu, X } from 'lucide-react'
import { VtooltipRoot, VtooltipItem, VtooltipTrigger, VtooltipContent } from './VTooltipMenu'
import { getSelector } from '../lib/getSelector'

interface FeedbackWidgetProps {
  projectId: string
  apiBase: string
}

type Mode = 'idle' | 'selecting' | 'commenting'

interface ClickTarget {
  selector: string
  x: number  // page-relative px
  y: number  // page-relative px
  url: string
}

interface Comment {
  id: string
  project_id: string
  url: string
  x: number
  y: number
  element: string
  comment: string
  status: string
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

  // Draggable pill state
  const [pillPos, setPillPos] = useState({ x: window.innerWidth - 72, y: window.innerHeight - 200 })
  const dragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const didDrag = useRef(false)
  const pillRef = useRef<HTMLDivElement>(null)

  // Pin state
  const [selectedPin, setSelectedPin] = useState<string | null>(null)

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
          setComments(data.map((c: any) => ({ ...c, status: c.status || 'pending' })))
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

      setSelectedPin(null)
      setTarget({
        selector: getSelector(el),
        x: e.pageX,
        y: e.pageY,
        url: window.location.href,
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
      const res = await fetch(`${apiBase}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          url: targetData.url,
          x: targetData.x,
          y: targetData.y,
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
        x: targetData.x,
        y: targetData.y,
        element: targetData.selector,
        comment: commentText,
        status: 'pending',
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
    } catch (err) {
      console.warn('[FeedbackWidget] API error:', err)
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }, [comment, target, projectId, apiBase])

  // --- Keyboard shortcuts ---
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

      if (e.key === 'Escape') {
        if (selectedPin) {
          setSelectedPin(null)
        } else if (mode === 'commenting') {
          setTarget(null)
          setComment('')
          setSending(false)
          setMode('selecting')
        } else if (sidebarOpen) {
          setSidebarOpen(false)
        }
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && mode === 'commenting') {
        handleSend()
      }

      // Single-key shortcuts — skip when typing in an input
      if (isTyping) return

      if (e.key === 'c' || e.key === 'C') {
        if (mode !== 'idle') { exitFeedbackMode() } else { enterFeedbackMode() }
      }
      if (e.key === 's' || e.key === 'S') {
        enterFeedbackMode()
      }
      if (e.key === 'm' || e.key === 'M' || e.key === 'f' || e.key === 'F') {
        setSidebarOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
    setSelectedPin(null)
  }

  function enterFeedbackMode() {
    // Keep sidebar open — user can comment while viewing the list
    setMode('selecting')
  }

  // --- Drag handlers for pill ---
  function onPillPointerDown(e: React.PointerEvent) {
    dragging.current = true
    didDrag.current = false
    dragOffset.current = { x: e.clientX - pillPos.x, y: e.clientY - pillPos.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragging.current) return
      didDrag.current = true
      const x = Math.max(0, Math.min(window.innerWidth - 48, e.clientX - dragOffset.current.x))
      const y = Math.max(0, Math.min(window.innerHeight - 160, e.clientY - dragOffset.current.y))
      setPillPos({ x, y })
    }
    function onUp() {
      dragging.current = false
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [pillPos])

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

  // --- Popover position (page-relative, converted to fixed via scroll offset) ---
  const popoverStyle = (): React.CSSProperties => {
    if (!target) return { display: 'none' }
    const pad = 16
    const popW = 300
    const popH = 180
    const fixedX = target.x - window.scrollX
    const fixedY = target.y - window.scrollY
    let left = fixedX + pad
    let top = fixedY + pad
    if (left + popW > window.innerWidth) left = fixedX - popW - pad
    if (top + popH > window.innerHeight) top = fixedY - popH - pad
    if (left < pad) left = pad
    if (top < pad) top = pad
    return {
      position: 'fixed',
      left,
      top,
      zIndex: 2147483646,
    }
  }

  // --- Pin popover position for viewing existing comments ---
  const pinPopoverStyle = (c: Comment): React.CSSProperties => {
    const pad = 16
    const popW = 280
    const fixedX = c.x - window.scrollX
    const fixedY = c.y - window.scrollY
    let left = fixedX + pad
    let top = fixedY - 20
    if (left + popW > window.innerWidth) left = fixedX - popW - pad
    if (left < pad) left = pad
    if (top < pad) top = fixedY + 40
    return {
      position: 'fixed',
      left,
      top,
      zIndex: 2147483646,
    }
  }

  const statusColors: Record<string, { bg: string; text: string; label: string }> = {
    pending: { bg: '#fef3c7', text: '#92400e', label: 'Pending' },
    approved: { bg: '#d1fae5', text: '#065f46', label: 'Approved' },
    rejected: { bg: '#fee2e2', text: '#991b1b', label: 'Rejected' },
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

      {/* New comment pin at clicked position */}
      {mode === 'commenting' && target && (
        <div
          {...{ [WIDGET_ATTR]: '' }}
          style={{
            position: 'absolute',
            left: target.x - 12,
            top: target.y - 32,
            zIndex: 2147483646,
            pointerEvents: 'none',
          }}
        >
          <svg width="24" height="32" viewBox="0 0 24 32" fill="none">
            <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 20 12 20s12-11 12-20C24 5.373 18.627 0 12 0z" fill="#111" />
            <circle cx="12" cy="12" r="8" fill="#111" />
            <text x="12" y="16" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700" fontFamily="-apple-system, BlinkMacSystemFont, sans-serif">
              {comments.length + 1}
            </text>
          </svg>
        </div>
      )}

      {/* Persisted comment pins */}
      {comments.map((c, i) => {
        const pinNumber = comments.length - i
        const isSelected = selectedPin === c.id
        return (
          <div key={c.id} {...{ [WIDGET_ATTR]: '' }}>
            {/* Pin marker */}
            <div
              onClick={(e) => {
                e.stopPropagation()
                setSelectedPin(isSelected ? null : c.id)
              }}
              style={{
                position: 'absolute',
                left: c.x - 12,
                top: c.y - 32,
                zIndex: isSelected ? 2147483646 : 2147483640,
                cursor: 'pointer',
                transition: 'transform 0.15s',
                transform: isSelected ? 'scale(1.15)' : 'scale(1)',
              }}
            >
              <svg width="24" height="32" viewBox="0 0 24 32" fill="none">
                <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 20 12 20s12-11 12-20C24 5.373 18.627 0 12 0z" fill={isSelected ? '#3b82f6' : '#111'} />
                <circle cx="12" cy="12" r="8" fill={isSelected ? '#3b82f6' : '#111'} />
                <text x="12" y="16" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700" fontFamily="-apple-system, BlinkMacSystemFont, sans-serif">
                  {pinNumber}
                </text>
              </svg>
            </div>

            {/* Pin detail popover */}
            {isSelected && (
              <>
                <div
                  onClick={() => setSelectedPin(null)}
                  style={{ position: 'fixed', inset: 0, zIndex: 2147483645 }}
                />
                <div
                  style={{
                    ...pinPopoverStyle(c),
                    width: 280,
                    background: '#fff',
                    borderRadius: 10,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)',
                    padding: 14,
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#666' }}>
                      #{pinNumber} &middot; {timeAgo(c.created_at)}
                    </span>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 9999,
                      background: (statusColors[c.status] || statusColors.pending).bg,
                      color: (statusColors[c.status] || statusColors.pending).text,
                    }}>
                      {(statusColors[c.status] || statusColors.pending).label}
                    </span>
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.5, color: '#111' }}>
                    {c.comment}
                  </div>
                  <div style={{
                    marginTop: 8,
                    fontSize: 11,
                    color: '#999',
                    fontFamily: '"SF Mono", "Fira Code", Menlo, monospace',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {c.element}
                  </div>
                </div>
              </>
            )}
          </div>
        )
      })}

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

      {/* Floating draggable pill with tooltip menu */}
      <div
        ref={pillRef}
        {...{ [WIDGET_ATTR]: '' }}
        onPointerDown={onPillPointerDown}
        style={{
          position: 'fixed',
          left: pillPos.x,
          top: pillPos.y,
          zIndex: 2147483647,
          cursor: dragging.current ? 'grabbing' : 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        <VtooltipRoot springConfig={{ type: 'spring' as const, stiffness: 400, damping: 30, mass: 0.8 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              padding: '6px 6px',
              borderRadius: 9999,
              background: '#000',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {/* Comment */}
            <VtooltipItem index={0}>
              <VtooltipTrigger
                onClick={(e) => {
                  if (didDrag.current) { e.preventDefault(); return }
                  if (mode !== 'idle') { exitFeedbackMode() } else { enterFeedbackMode() }
                }}
              >
                <div className="fw-pill-icon" style={{ position: 'relative', display: 'flex', width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 9999, background: mode !== 'idle' ? 'rgba(255,255,255,0.1)' : 'transparent' }}>
                  {mode !== 'idle' ? (
                    <X style={{ width: 18, height: 18 }} />
                  ) : (
                    <MessageCircle style={{ width: 18, height: 18 }} />
                  )}
                </div>
                <span style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>Comment</span>
              </VtooltipTrigger>
              <VtooltipContent>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, whiteSpace: 'nowrap', padding: '0 8px', fontSize: 14, fontWeight: 500, lineHeight: 1.2, letterSpacing: '-0.01em', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
                  {mode !== 'idle' ? 'Exit' : 'Comment'}
                  <span style={{ display: 'inline-flex', width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 3, border: '1px solid rgba(255,255,255,0.3)', padding: 2, fontSize: 12, color: '#fff' }}>C</span>
                </div>
              </VtooltipContent>
            </VtooltipItem>

            {/* Share */}
            <VtooltipItem index={1}>
              <VtooltipTrigger
                onClick={(e) => {
                  if (didDrag.current) { e.preventDefault(); return }
                  enterFeedbackMode()
                }}
              >
                <div className="fw-pill-icon" style={{ position: 'relative', display: 'flex', width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 9999 }}>
                  <LogOut style={{ width: 18, height: 18, transform: 'rotate(-90deg)' }} />
                </div>
                <span style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>Share</span>
              </VtooltipTrigger>
              <VtooltipContent>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, whiteSpace: 'nowrap', padding: '0 8px', fontSize: 14, fontWeight: 500, lineHeight: 1.2, letterSpacing: '-0.01em', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
                  Share
                </div>
              </VtooltipContent>
            </VtooltipItem>

            {/* Menu */}
            <VtooltipItem index={2}>
              <VtooltipTrigger
                onClick={(e) => {
                  if (didDrag.current) { e.preventDefault(); return }
                  setSidebarOpen((v) => !v)
                }}
              >
                <div className="fw-pill-icon" style={{ position: 'relative', display: 'flex', width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 9999 }}>
                  <Menu style={{ width: 18, height: 18 }} />
                  {commentCount > 0 && (
                    <div style={{
                      position: 'absolute',
                      right: 2,
                      top: 2,
                      width: 6,
                      height: 6,
                      borderRadius: 9999,
                      border: '1.7px solid #000',
                      background: '#0ea5e9',
                      animation: badgeAnim ? 'fw-badge-pop 0.4s ease' : 'none',
                    }} />
                  )}
                </div>
                <span style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>Menu</span>
              </VtooltipTrigger>
              <VtooltipContent>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, whiteSpace: 'nowrap', padding: '0 8px', fontSize: 14, fontWeight: 500, lineHeight: 1.2, letterSpacing: '-0.01em', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
                  Menu
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                    <span style={{ display: 'inline-flex', width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 3, border: '1px solid rgba(255,255,255,0.3)', padding: 2, fontSize: 12, color: '#fff' }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" /></svg>
                    </span>
                    <span style={{ display: 'inline-flex', width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 3, border: '1px solid rgba(255,255,255,0.3)', padding: 2, fontSize: 12, color: '#fff' }}>K</span>
                  </span>
                </div>
              </VtooltipContent>
            </VtooltipItem>
          </div>
        </VtooltipRoot>
      </div>

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
        [data-fw] button:focus,
        [data-fw] button:focus-visible {
          outline: none;
          box-shadow: none;
        }
        @keyframes fw-pin-drop {
          0% { transform: translateY(-20px); opacity: 0; }
          60% { transform: translateY(4px); opacity: 1; }
          100% { transform: translateY(0); opacity: 1; }
        }
        .fw-pill-icon:hover {
          background: rgba(255, 255, 255, 0.15);
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

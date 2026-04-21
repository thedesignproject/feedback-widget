import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageCircle, LogOut, Menu, X } from 'lucide-react'
import { VtooltipRoot, VtooltipItem, VtooltipTrigger, VtooltipContent } from './VTooltipMenu'
import { getSelector } from '../lib/getSelector'

interface FeedbackWidgetProps {
  projectId: string
  apiBase?: string
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

const AVATAR_COLORS = ['#8b5cf6', '#f97316', '#3b82f6', '#ec4899', '#14b8a6', '#f43f5e', '#6366f1', '#84cc16']
function avatarColor(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

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

const DEFAULT_API_BASE = 'https://feedback-widget-sigma.vercel.app/api'

export function FeedbackWidget({ projectId, apiBase = DEFAULT_API_BASE }: FeedbackWidgetProps) {
  const [mode, setMode] = useState<Mode>('idle')
  const [target, setTarget] = useState<ClickTarget | null>(null)
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  const [hovered, setHovered] = useState<Element | null>(null)

  // Draggable pill state
  const [pillPos, setPillPos] = useState({ x: window.innerWidth - 72, y: window.innerHeight - 200 })
  const dragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const didDrag = useRef(false)
  const pillRef = useRef<HTMLDivElement>(null)

  // Pin state
  const [selectedPin, setSelectedPin] = useState<string | null>(null)
  const [hoveredPin, setHoveredPin] = useState<string | null>(null)

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)

  // Sidebar state
  const [comments, setComments] = useState<Comment[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
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

  // --- Set crosshair cursor when selecting ---
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

      setBadgeAnim(true)
      setTimeout(() => setBadgeAnim(false), 400)

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
        } else if (mode === 'selecting') {
          exitFeedbackMode()
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

  function exitFeedbackMode() {
    setMode('idle')
    setTarget(null)
    setComment('')
    setSending(false)
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
  }, [])

  async function patchComment(id: string, updates: Record<string, string>) {
    try {
      await fetch(`${apiBase}/comments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates }),
      })
    } catch (err) {
      console.warn('[FeedbackWidget] PATCH failed:', err)
    }
  }

  function updateStatus(commentId: string, status: 'approved' | 'rejected') {
    setComments((prev) => prev.map((c) => c.id === commentId ? { ...c, status } : c))
    patchComment(commentId, { status })
  }

  function deleteComment(commentId: string) {
    setComments((prev) => prev.filter((c) => c.id !== commentId))
    fetch(`${apiBase}/comments?id=${commentId}`, { method: 'DELETE' }).catch(() => {})
  }

  function saveEdit(commentId: string) {
    if (!editText.trim()) return
    const text = editText.trim()
    setComments((prev) => prev.map((c) => c.id === commentId ? { ...c, comment: text } : c))
    setEditingId(null)
    patchComment(commentId, { comment: text })
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

  const cutoff = new Date('2026-04-19T00:00:00Z')
  const visibleComments = useMemo(() => comments.filter((c) => new Date(c.created_at) >= cutoff), [comments])
  const sortedComments = useMemo(() => [...visibleComments].sort((a, b) => {
    const aResolved = a.status === 'approved' || a.status === 'rejected'
    const bResolved = b.status === 'approved' || b.status === 'rejected'
    if (aResolved !== bResolved) return aResolved ? 1 : -1
    return 0
  }), [visibleComments])
  const commentCount = visibleComments.length

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

      {/* Instruction tooltip */}
      {mode === 'selecting' && (
        <div
          {...{ [WIDGET_ATTR]: '' }}
          style={{
            position: 'fixed',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2147483647,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            borderRadius: 9999,
            background: '#fff',
            border: '1px solid #e5e7eb',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 13,
            color: '#111',
            whiteSpace: 'nowrap',
            animation: 'fw-instruction-in 0.3s ease both',
          }}
        >
          <span className="fw-rec-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: '#E5502A', flexShrink: 0 }} />
          <span style={{ fontWeight: 500 }}>Click any element to leave feedback</span>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1px 6px',
            borderRadius: 4,
            border: '1px solid #d1d5db',
            fontSize: 11,
            fontWeight: 600,
            color: '#888',
            lineHeight: 1.4,
          }}>Esc</span>
          <span
            onClick={exitFeedbackMode}
            style={{
              color: '#999',
              fontSize: 12,
              cursor: 'pointer',
              marginLeft: 2,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#111')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#999')}
          >exit</span>
        </div>
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
              display: 'flex',
              flexDirection: 'column',
              width: comment.length > 0 ? 300 : 'auto',
              background: '#1e1e1e',
              borderRadius: comment.length > 0 ? 14 : 9999,
              padding: comment.length > 0 ? '10px 10px 6px' : '6px 6px 6px 10px',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              transition: 'border-radius 0.2s, width 0.2s, padding 0.2s',
            }}
          >
            {/* Top row: avatar + input + send */}
            <div style={{ display: 'flex', alignItems: comment.length > 0 ? 'flex-start' : 'center', gap: 10 }}>
              {/* Avatar */}
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#3b82f6', flexShrink: 0, marginTop: comment.length > 0 ? 2 : 0 }} />
              {/* Textarea (single row when empty, expands when typing) */}
              <textarea
                ref={textareaRef}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSend() }
                  if (e.key === 'Enter' && !e.shiftKey && comment.length === 0) { e.preventDefault() }
                }}
                placeholder="Add a comment"
                rows={comment.length > 0 ? 3 : 1}
                style={{
                  flex: 1,
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  color: '#fff',
                  fontSize: 14,
                  fontFamily: 'inherit',
                  minWidth: 0,
                  resize: 'none',
                  lineHeight: 1.5,
                  padding: 0,
                  transition: 'height 0.15s ease',
                }}
              />
              {/* Send button (inline when collapsed) */}
              {comment.length === 0 && (
                <button
                  onClick={handleSend}
                  disabled
                  aria-label="Send"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    border: 'none',
                    background: '#333',
                    cursor: 'default',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </button>
              )}
            </div>

            {/* Bottom toolbar (visible when typing) */}
            {comment.length > 0 && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 6,
                paddingTop: 6,
                borderTop: '1px solid #333',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {/* Emoji */}
                  <button style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6, color: '#888' }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = '#888')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                      <line x1="9" y1="9" x2="9.01" y2="9" />
                      <line x1="15" y1="9" x2="15.01" y2="9" />
                    </svg>
                  </button>
                  {/* Mention */}
                  <button style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6, color: '#888' }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = '#888')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="4" />
                      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
                    </svg>
                  </button>
                  {/* Image attachment */}
                  <button style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6, color: '#888' }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = '#888')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </button>
                </div>
                {/* Send button */}
                <button
                  onClick={handleSend}
                  disabled={!comment.trim() || sending}
                  aria-label="Send"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    border: 'none',
                    background: !comment.trim() || sending ? '#333' : '#3b82f6',
                    cursor: !comment.trim() || sending ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'background 0.2s',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={!comment.trim() || sending ? '#666' : '#fff'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* New comment pin at clicked position */}
      {mode === 'commenting' && target && (
        <div
          {...{ [WIDGET_ATTR]: '' }}
          style={{
            position: 'absolute',
            left: target.x - 16,
            top: target.y - 40,
            zIndex: 2147483646,
            pointerEvents: 'none',
          }}
        >
          <svg width="32" height="40" viewBox="0 0 32 40" fill="none">
            <path d="M16 38c0 0-14-12.5-14-22a14 14 0 1 1 28 0c0 9.5-14 22-14 22z" fill="#F5F0DC" stroke="#222" strokeWidth="2" />
            <text x="16" y="19.5" textAnchor="middle" fill="#111" fontSize="11" fontWeight="700" fontFamily="-apple-system, BlinkMacSystemFont, sans-serif">
              U
            </text>
          </svg>
        </div>
      )}

      {/* Persisted comment pins */}
      {visibleComments.map((c, i) => {
        const pinNumber = visibleComments.length - i
        const isSelected = selectedPin === c.id
        const isHovered = hoveredPin === c.id && !isSelected
        const statusDotColor = c.status === 'approved' ? '#22c55e' : c.status === 'rejected' ? '#ef4444' : '#111'
        const truncated = c.comment.length > 60 ? c.comment.slice(0, 60) + '\u2026' : c.comment
        const pinColor = isSelected ? '#3b82f6' : '#f5f5f5'
        const initial = (c.comment[0] || 'U').toUpperCase()
        return (
          <div key={c.id} {...{ [WIDGET_ATTR]: '' }}>
            {/* Pin marker */}
            <div
              onClick={(e) => {
                e.stopPropagation()
                setSelectedPin(isSelected ? null : c.id)
              }}
              onMouseEnter={() => setHoveredPin(c.id)}
              onMouseLeave={() => setHoveredPin(null)}
              style={{
                position: 'absolute',
                left: c.x - 16,
                top: c.y - 40,
                zIndex: isSelected ? 2147483646 : isHovered ? 2147483642 : 2147483640,
                cursor: 'pointer',
                transition: 'transform 0.15s',
                transform: isSelected || isHovered ? 'scale(1.15)' : 'scale(1)',
              }}
            >
              <svg width="32" height="40" viewBox="0 0 32 40" fill="none">
                <path d="M16 38c0 0-14-12.5-14-22a14 14 0 1 1 28 0c0 9.5-14 22-14 22z" fill={isSelected ? '#3b82f6' : '#F5F0DC'} stroke={isSelected ? '#2563eb' : '#222'} strokeWidth="2" />
                <text x="16" y="19.5" textAnchor="middle" fill={isSelected ? '#fff' : '#111'} fontSize="11" fontWeight="700" fontFamily="-apple-system, BlinkMacSystemFont, sans-serif">
                  {initial}
                </text>
              </svg>
            </div>

            {/* Hover tooltip */}
            {isHovered && (
              <div
                style={{
                  position: 'absolute',
                  left: c.x - 16,
                  top: c.y - 78,
                  zIndex: 2147483643,
                  pointerEvents: 'none',
                  animation: 'fw-tooltip-in 0.15s ease both',
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: '#1e1e1e',
                  borderRadius: 8,
                  padding: '6px 10px',
                  maxWidth: 240,
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                }}>
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: statusDotColor,
                    flexShrink: 0,
                  }} />
                  <span style={{
                    fontSize: 12,
                    color: '#fff',
                    lineHeight: 1.3,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {truncated}
                  </span>
                </div>
              </div>
            )}

            {/* Pin detail popover */}
            {isSelected && (() => {
              const avColor = avatarColor(c.id)
              const initial = (c.comment[0] || 'U').toUpperCase()
              const stBadge = c.status === 'approved'
                ? { bg: '#ecfdf5', color: '#059669', label: 'Approved' }
                : c.status === 'rejected'
                  ? { bg: '#fef2f2', color: '#dc2626', label: 'Rejected' }
                  : { bg: '#fffbeb', color: '#d97706', label: 'Pending' }
              const selectorShort = c.element.split('>').pop()?.trim() || c.element
              return (
                <>
                  <div
                    onClick={() => setSelectedPin(null)}
                    style={{ position: 'fixed', inset: 0, zIndex: 2147483645 }}
                  />
                  <div
                    style={{
                      ...pinPopoverStyle(c),
                      width: 300,
                      background: '#fff',
                      borderRadius: 16,
                      boxShadow: '0 12px 40px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
                      padding: 16,
                      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                      animation: 'fw-tooltip-in 0.15s ease both',
                    }}
                  >
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
                      {/* Avatar */}
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                        background: avColor,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontSize: 13, fontWeight: 700,
                      }}>
                        {initial}
                      </div>
                      {/* Name + meta */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#111', marginBottom: 2 }}>User</div>
                        <div style={{ fontSize: 11, color: '#aaa' }}>
                          #{pinNumber} &middot; {timeAgo(c.created_at)}
                        </div>
                      </div>
                      {/* Status badge */}
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 9999,
                        background: stBadge.bg, color: stBadge.color, flexShrink: 0, marginTop: 2,
                      }}>
                        {stBadge.label}
                      </span>
                    </div>

                    {/* Comment text */}
                    <div style={{ fontSize: 14, lineHeight: 1.6, color: '#333', marginBottom: 14 }}>
                      {c.comment}
                    </div>

                    {/* Element chip */}
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontSize: 11, color: '#999', background: '#f5f5f5',
                      padding: '4px 10px', borderRadius: 6,
                      maxWidth: '100%', overflow: 'hidden',
                    }}>
                      {/* Grid icon */}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7" />
                        <rect x="14" y="3" width="7" height="7" />
                        <rect x="3" y="14" width="7" height="7" />
                        <rect x="14" y="14" width="7" height="7" />
                      </svg>
                      <span style={{
                        fontFamily: '"SF Mono", "Fira Code", Menlo, monospace',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {selectorShort}
                      </span>
                    </div>
                  </div>
                </>
              )
            })()}
          </div>
        )
      })}

      {/* Sidebar overlay — click outside to close */}
      {sidebarOpen && (
        <div
          {...{ [WIDGET_ATTR]: '' }}
          onClick={() => setSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
        />
      )}

      {/* Reviewer Sidebar */}
      <div
        {...{ [WIDGET_ATTR]: '' }}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 340,
          zIndex: 9999,
          background: '#1a1a1a',
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          boxShadow: sidebarOpen ? '-8px 0 32px rgba(0,0,0,0.3)' : 'none',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #2a2a2a' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff', flex: 1 }}>
            Comments
          </span>
          <span style={{ fontSize: 11, color: '#666', marginRight: 10 }}>
            {commentCount}
          </span>
          <button
            onClick={() => setSidebarOpen(false)}
            style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 4, display: 'flex' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Comment list */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {visibleComments.length === 0 && (
            <div style={{ color: '#555', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
              No comments yet
            </div>
          )}
          {sortedComments.map((c, i) => {
              const pinNum = visibleComments.length - visibleComments.indexOf(c)
              const isResolved = c.status === 'approved' || c.status === 'rejected'
              const isPending = !c.status || c.status === 'pending'
              const isEditing = editingId === c.id
              const initial = (c.comment[0] || 'U').toUpperCase()
              const isMenuOpen = menuOpenId === c.id
              return (
                <div
                  key={c.id}
                  className="fw-sidebar-card"
                  onClick={() => { if (!isEditing && !isMenuOpen) { setSelectedPin(c.id); highlightElement(c.element) } }}
                  style={{
                    padding: '12px 16px',
                    cursor: isEditing ? 'default' : 'pointer',
                    position: 'relative',
                    zIndex: isMenuOpen ? 100000 : 'auto',
                    display: 'flex',
                    gap: 10,
                    borderBottom: '1px solid #2a2a2a',
                    opacity: isResolved ? 0.5 : 1,
                    transition: 'background 0.1s, opacity 0.2s',
                    animation: sidebarOpen ? `fw-slide-in 0.2s ease ${i * 0.04}s both` : 'none',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#222' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  {/* Avatar */}
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                    background: isResolved ? '#333' : '#3b82f6',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 12, fontWeight: 700,
                  }}>
                    {initial}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Meta line */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                      <span style={{ fontSize: 11, color: '#888' }}>#{pinNum}</span>
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M2 4h4M4.5 2L6.5 4L4.5 6" stroke="#555" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      <span style={{ fontSize: 11, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.url.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '') || '/'}
                      </span>
                    </div>

                    {/* Author + time */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#ddd' }}>User</span>
                      <span style={{ fontSize: 11, color: '#555' }}>{timeAgo(c.created_at)}</span>
                    </div>

                    {/* Comment text */}
                    {isEditing ? (
                      <div onClick={(e) => e.stopPropagation()}>
                        <textarea
                          autoFocus
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit(c.id) }
                            if (e.key === 'Escape') { setEditingId(null) }
                          }}
                          rows={2}
                          style={{
                            width: '100%', boxSizing: 'border-box',
                            fontSize: 13, lineHeight: 1.4, color: '#fff',
                            border: '1px solid #444', borderRadius: 5,
                            padding: '6px 8px', fontFamily: 'inherit',
                            outline: 'none', resize: 'none', background: '#2a2a2a',
                          }}
                          onFocus={(e) => (e.target.style.borderColor = '#3b82f6')}
                          onBlur={(e) => (e.target.style.borderColor = '#444')}
                        />
                        <div style={{ display: 'flex', gap: 6, marginTop: 4, justifyContent: 'flex-end' }}>
                          <button onClick={() => setEditingId(null)} style={{ fontSize: 11, color: '#666', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>Cancel</button>
                          <button onClick={() => saveEdit(c.id)} style={{ fontSize: 11, color: '#3b82f6', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>Save</button>
                        </div>
                      </div>
                    ) : (
                      <div
                        onClick={(e) => { e.stopPropagation(); setEditingId(c.id); setEditText(c.comment) }}
                        style={{ fontSize: 13, lineHeight: 1.4, color: '#ccc', cursor: 'text' }}
                      >
                        {c.comment}
                      </div>
                    )}
                  </div>

                  {/* Top-right area: hover actions + blue dot */}
                  <div style={{
                    position: 'absolute', top: 10, right: 12,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <div className="fw-card-actions" style={{
                      display: 'none', alignItems: 'center', gap: 2,
                    }}>
                      {isPending && (
                        <button
                          onClick={(e) => { e.stopPropagation(); updateStatus(c.id, 'approved') }}
                          title="Mark as resolved"
                          style={{
                            width: 22, height: 22, borderRadius: '50%', border: '1.5px solid #555',
                            background: 'transparent', cursor: 'pointer', display: 'flex',
                            alignItems: 'center', justifyContent: 'center', color: '#888', padding: 0,
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#22c55e'; e.currentTarget.style.color = '#22c55e' }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#555'; e.currentTarget.style.color = '#888' }}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuOpenId(isMenuOpen ? null : c.id) }}
                        title="More"
                        style={{
                          width: 24, height: 24, borderRadius: 4, border: 'none',
                          background: isMenuOpen ? '#333' : 'transparent', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#888', padding: 0,
                        }}
                        onMouseEnter={(e) => { if (!isMenuOpen) e.currentTarget.style.background = '#333' }}
                        onMouseLeave={(e) => { if (!isMenuOpen) e.currentTarget.style.background = 'transparent' }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
                      </button>
                    </div>
                    {isPending && !isEditing && (
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6', flexShrink: 0 }} />
                    )}
                  </div>

                  {/* Dropdown menu */}
                  {isMenuOpen && (
                    <>
                    <div
                      onClick={(e) => { e.stopPropagation(); setMenuOpenId(null) }}
                      style={{ position: 'fixed', inset: 0, zIndex: 99998 }}
                    />
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: 'absolute', top: 34, right: 12, zIndex: 99999,
                        background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: 8,
                        padding: '4px 0', minWidth: 160,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                        animation: 'fw-tooltip-in 0.1s ease both',
                      }}
                    >
                      <button
                        onClick={() => { updateStatus(c.id, c.status === 'approved' ? 'pending' as any : 'approved'); setMenuOpenId(null) }}
                        style={{ width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: '#ccc', fontSize: 12, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#333')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                        {c.status === 'approved' ? 'Unresolve' : 'Mark as resolved'}
                      </button>
                      <button
                        onClick={() => { setEditingId(c.id); setEditText(c.comment); setMenuOpenId(null) }}
                        style={{ width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: '#ccc', fontSize: 12, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#333')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        Edit
                      </button>
                      <div style={{ height: 1, background: '#3a3a3a', margin: '4px 0' }} />
                      <button
                        onClick={() => { deleteComment(c.id); setMenuOpenId(null) }}
                        style={{ width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: '#ef4444', fontSize: 12, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#333')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                        Delete
                      </button>
                    </div>
                    </>
                  )}
                </div>
              )
            })}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #2a2a2a' }}>
          <button
            onClick={() => { enterFeedbackMode(); setSidebarOpen(false) }}
            style={{
              width: '100%', padding: '9px 0', fontSize: 15, fontWeight: 500,
              color: '#fff', background: '#3b82f6', border: 'none', borderRadius: 8,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 6, transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#2563eb')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#3b82f6')}
          >
            + New feedback
          </button>
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
                <div className="fw-pill-icon" style={{ position: 'relative', display: 'flex', width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 9999, background: mode !== 'idle' ? '#333333' : 'transparent' }}>
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
                  <span style={{ display: 'inline-flex', width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 3, border: '1px solid rgba(255,255,255,0.3)', padding: 2, fontSize: 12, color: '#fff' }}>S</span>
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
                  Feedback
                  <span style={{ display: 'inline-flex', width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 3, border: '1px solid rgba(255,255,255,0.3)', padding: 2, fontSize: 12, color: '#fff' }}>F</span>
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
        @keyframes fw-instruction-in {
          0% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
          100% { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        .fw-rec-dot {
          animation: fw-rec-pulse 1.5s ease-in-out infinite;
        }
        @keyframes fw-rec-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes fw-tooltip-in {
          0% { opacity: 0; transform: translateY(4px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes fw-pin-drop {
          0% { transform: translateY(-20px); opacity: 0; }
          60% { transform: translateY(4px); opacity: 1; }
          100% { transform: translateY(0); opacity: 1; }
        }
        .fw-sidebar-card:hover .fw-card-actions {
          display: flex !important;
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

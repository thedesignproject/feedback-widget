import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageCircle, Menu, X, Bot } from 'lucide-react'
import { VtooltipRoot, VtooltipItem, VtooltipTrigger, VtooltipContent } from './VTooltipMenu'
import { getSelector } from '../lib/getSelector'
import { useScreenshotCapture } from '../lib/screenshotCapture'
import { AgentBridgeModal } from './AgentBridgeModal'
import { readAuthorMap, readAuthorName, rememberCommentAuthor, writeAuthorName } from '../lib/authorStorage'

interface FeedbackWidgetProps {
  projectId: string
  apiBase: string
}

type Mode = 'idle' | 'selecting' | 'commenting'
type ReviewStatus = 'open' | 'accepted' | 'rejected'

interface ClickTarget {
  selector: string
  x: number  // page-relative px
  y: number  // page-relative px
  url: string
}

interface Comment {
  id: string
  projectId: string
  pageUrl: string
  x: number
  y: number
  selector: string
  body: string
  reviewStatus: ReviewStatus
  imageUrl?: string | null
  createdAt: string
  authorName?: string
}


function toPagePercent(pageX: number, pageY: number) {
  const { scrollWidth, scrollHeight } = document.documentElement
  return {
    x: (pageX / scrollWidth) * 100,
    y: (pageY / scrollHeight) * 100,
  }
}

function fromPagePercent(x: number, y: number) {
  const { scrollWidth, scrollHeight } = document.documentElement
  // Legacy rows stored absolute pixels (often > 100). Fall back to pixel coords.
  if (x > 100 || y > 100) {
    return { pageX: x, pageY: y }
  }
  return {
    pageX: (x / 100) * scrollWidth,
    pageY: (y / 100) * scrollHeight,
  }
}

function fromPagePercentFixed(x: number, y: number) {
  const { pageX, pageY } = fromPagePercent(x, y)
  return { fixedX: pageX - window.scrollX, fixedY: pageY - window.scrollY }
}

const WIDGET_ATTR = 'data-fw'

const PIN_GRADIENT = 'radial-gradient(circle at 50% 40%, #ffffff 0%, #ffffff 6%, #c4d6ff 25%, #5b87e8 65%, #2563eb 100%)'

const NOISE_OVERLAY_BG = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.55'/></svg>\")"

function PinMarker({ outline = false }: { outline?: boolean }) {
  return (
    <div style={{
      width: 32, height: 32,
      borderRadius: '50% 50% 50% 0',
      background: PIN_GRADIENT,
      outline: outline ? '2px solid #fff' : 'none',
      outlineOffset: outline ? 1 : 0,
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute',
        left: '50%', top: '40%',
        width: 22, height: 22,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 65%)',
        animation: 'fw-pin-inner-pulse 1.8s ease-in-out infinite',
        pointerEvents: 'none',
        mixBlendMode: 'screen',
      }} />
      <div style={{
        position: 'absolute',
        inset: 0,
        borderRadius: 'inherit',
        backgroundImage: NOISE_OVERLAY_BG,
        mixBlendMode: 'overlay',
        opacity: 0.5,
        pointerEvents: 'none',
      }} />
    </div>
  )
}

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

function normalizeReviewStatus(value: unknown): ReviewStatus {
  if (value === 'accepted' || value === 'rejected') return value
  return 'open'
}

async function fetchProjectComments(apiBase: string, projectId: string): Promise<Comment[]> {
  try {
    const res = await fetch(`${apiBase}/v1/public/comments?projectKey=${encodeURIComponent(projectId)}`)
    if (!res.ok) return []

    const data: unknown = await res.json()
    if (!Array.isArray(data)) return []

    const authorMap = readAuthorMap()
    return data.map((comment) => {
      const c = comment as Comment
      return {
        ...c,
        reviewStatus: normalizeReviewStatus((comment as { reviewStatus?: unknown }).reviewStatus),
        authorName: c.authorName ?? authorMap[c.id],
      }
    })
  } catch {
    // Endpoint not ready yet; keep the widget usable with an empty sidebar.
    return []
  }
}

export function FeedbackWidget({ projectId, apiBase }: FeedbackWidgetProps) {
  const [mode, setMode] = useState<Mode>('idle')
  const [target, setTarget] = useState<ClickTarget | null>(null)
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  const [hovered, setHovered] = useState<Element | null>(null)

  const [authorName, setAuthorNameState] = useState<string | null>(null)
  const authorNameRef = useRef<string | null>(null)
  const [showNameModal, setShowNameModal] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [popoverMenuOpen, setPopoverMenuOpen] = useState(false)
  // selectedPin is declared below; reset menu when it changes

  useEffect(() => {
    const stored = readAuthorName()
    setAuthorNameState(stored)
    authorNameRef.current = stored
  }, [])
  function saveAuthorName(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    writeAuthorName(trimmed)
    setAuthorNameState(trimmed)
    authorNameRef.current = trimmed
  }

  // Draggable pill state
  const [pillPos, setPillPos] = useState({ x: window.innerWidth - 72, y: window.innerHeight - 200 })
  const dragging = useRef(false)

  // Pins/popovers use position:fixed, so their viewport coords must be recomputed
  // on scroll (and on resize / body reflow, which shift the page-percent mapping).
  // RAF-coalesced and gated by needsPositionSyncRef so idle pages stay cheap.
  const [, forceUpdate] = useState(0)
  const needsPositionSyncRef = useRef(false)
  useEffect(() => {
    let raf = 0
    const bump = () => {
      if (!needsPositionSyncRef.current) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => forceUpdate(n => n + 1))
    }

    function onResize() {
      bump()
      setPillPos(prev => ({
        x: Math.max(0, Math.min(window.innerWidth - 48, prev.x)),
        y: Math.max(0, Math.min(window.innerHeight - 160, prev.y)),
      }))
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', bump, { passive: true })

    const ro = new ResizeObserver(bump)
    ro.observe(document.body)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', bump)
      ro.disconnect()
    }
  }, [])
  const dragOffset = useRef({ x: 0, y: 0 })
  const didDrag = useRef(false)
  const pillRef = useRef<HTMLDivElement>(null)

  // Pin state
  const [selectedPin, setSelectedPin] = useState<string | null>(null)
  const [hoveredPin, setHoveredPin] = useState<string | null>(null)
  useEffect(() => { setPopoverMenuOpen(false) }, [selectedPin])

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)

  // Track current URL for SPA navigation (pins scoped to page)
  const [currentUrl, setCurrentUrl] = useState(() => window.location.href.split('?')[0].split('#')[0])
  useEffect(() => {
    const update = () => setCurrentUrl(window.location.href.split('?')[0].split('#')[0])
    window.addEventListener('popstate', update)
    // Patch pushState/replaceState to detect SPA navigation
    const origPush = history.pushState.bind(history)
    const origReplace = history.replaceState.bind(history)
    history.pushState = (...args) => { origPush(...args); update() }
    history.replaceState = (...args) => { origReplace(...args); update() }
    return () => {
      window.removeEventListener('popstate', update)
      history.pushState = origPush
      history.replaceState = origReplace
    }
  }, [])

  // Sidebar state
  const [comments, setComments] = useState<Comment[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [badgeAnim, setBadgeAnim] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  // Synchronous guard — state updates are async, so double-firing handleSend
  // in the same tick (e.g. Cmd+Enter held down) would otherwise slip past `sending`.
  const sendingRef = useRef(false)

  const { image, previewUrl: imagePreviewUrl, capture: captureImage, clear: clearImage, toBase64: encodeImage } = useScreenshotCapture()

  // --- Fetch comments on mount ---
  useEffect(() => {
    let cancelled = false
    fetchProjectComments(apiBase, projectId).then((nextComments) => {
      if (!cancelled) setComments(nextComments)
    })
    return () => {
      cancelled = true
    }
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
      clearImage()
      const pct = toPagePercent(e.pageX, e.pageY)
      setTarget({
        selector: getSelector(el),
        x: pct.x,
        y: pct.y,
        url: window.location.href,
      })

      captureImage(el)

      if (!authorNameRef.current) {
        setShowNameModal(true)
        return
      }

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
      const payload: Record<string, unknown> = {
        projectKey: projectId,
        pageUrl: targetData.url,
        x: targetData.x,
        y: targetData.y,
        selector: targetData.selector,
        body: commentText,
      }

      const encoded = await encodeImage()
      if (encoded) {
        payload.imageBase64 = encoded.base64
        payload.imageMimeType = encoded.mimeType
      }

      const res = await fetch(`${apiBase}/v1/public/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        console.warn('[FeedbackWidget] API returned', res.status)
        return
      }

      const data = await res.json() as Partial<Comment>

      const newComment: Comment = {
        id: data.id ?? crypto.randomUUID(),
        projectId,
        pageUrl: targetData.url,
        x: targetData.x,
        y: targetData.y,
        selector: targetData.selector,
        body: commentText,
        reviewStatus: 'open',
        imageUrl: data.imageUrl ?? null,
        createdAt: data.createdAt ?? new Date().toISOString(),
        authorName: authorNameRef.current ?? undefined,
      }

      if (newComment.authorName) {
        rememberCommentAuthor(newComment.id, newComment.authorName)
      }

      setComments((prev) => [newComment, ...prev])

      setBadgeAnim(true)
      setTimeout(() => setBadgeAnim(false), 400)

      setTarget(null)
      setComment('')
      clearImage()
      setHovered(null)
      setMode('selecting')
    } catch (err) {
      console.warn('[FeedbackWidget] API error:', err)
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }, [comment, target, projectId, apiBase, encodeImage, clearImage])

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
          clearImage()
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
  }, [mode, handleSend, sidebarOpen, selectedPin])

  function exitFeedbackMode() {
    setMode('idle')
    setTarget(null)
    setComment('')
    clearImage()
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

  async function patchReviewStatus(id: string, reviewStatus: string) {
    try {
      await fetch(`${apiBase}/v1/public/comments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, reviewStatus }),
      })
    } catch (err) {
      console.warn('[FeedbackWidget] PATCH failed:', err)
    }
  }

  function updateStatus(commentId: string, reviewStatus: ReviewStatus) {
    setComments((prev) => prev.map((c) => c.id === commentId ? { ...c, reviewStatus } : c))
    patchReviewStatus(commentId, reviewStatus)
  }

  function deleteComment(commentId: string) {
    setComments((prev) => prev.filter((c) => c.id !== commentId))
  }

  function saveEdit(commentId: string) {
    if (!editText.trim()) return
    const text = editText.trim()
    setComments((prev) => prev.map((c) => c.id === commentId ? { ...c, body: text } : c))
    setEditingId(null)
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

  // Popover position — viewport-relative (fixed) so it doesn't extend scrollHeight.
  // Re-renders on scroll via the bump listener, keeping it anchored to the pin.
  const popoverStyle = (): React.CSSProperties => {
    if (!target) return { display: 'none' }
    const pad = 16
    const popW = 300
    const popH = 180
    const { fixedX, fixedY } = fromPagePercentFixed(target.x, target.y)
    let leftFixed = fixedX + pad
    let topFixed = fixedY + pad
    if (leftFixed + popW > window.innerWidth) leftFixed = fixedX - popW - pad
    if (topFixed + popH > window.innerHeight) topFixed = fixedY - popH - pad
    if (leftFixed < pad) leftFixed = pad
    if (topFixed < pad) topFixed = pad
    return {
      position: 'fixed',
      left: leftFixed,
      top: topFixed,
      zIndex: 2147483646,
    }
  }

  const pinPopoverStyle = (c: Comment): React.CSSProperties => {
    const pad = 16
    const popW = 280
    const { fixedX, fixedY } = fromPagePercentFixed(c.x, c.y)
    let leftFixed = fixedX + pad
    let topFixed = fixedY - 20
    if (leftFixed + popW > window.innerWidth) leftFixed = fixedX - popW - pad
    if (leftFixed < pad) leftFixed = pad
    if (topFixed < pad) topFixed = fixedY + 40
    return {
      position: 'fixed',
      left: leftFixed,
      top: topFixed,
      zIndex: 2147483646,
    }
  }

  const cutoff = new Date('2026-04-19T00:00:00Z')
  const visibleComments = useMemo(() => comments.filter((c) => {
    if (new Date(c.createdAt) < cutoff) return false
    const commentUrl = c.pageUrl.split('?')[0].split('#')[0]
    return commentUrl === currentUrl
  }), [comments, currentUrl])
  const sortedComments = useMemo(() => [...visibleComments].sort((a, b) => {
    const aResolved = a.reviewStatus === 'accepted' || a.reviewStatus === 'rejected'
    const bResolved = b.reviewStatus === 'accepted' || b.reviewStatus === 'rejected'
    if (aResolved !== bResolved) return aResolved ? 1 : -1
    return 0
  }), [visibleComments])
  const commentCount = visibleComments.length

  // Only sync on scroll when a viewport-anchored popover is open or commenting.
  // Persisted pins/tooltip are absolute (page-anchored), so scroll moves them natively.
  needsPositionSyncRef.current = selectedPin !== null || mode !== 'idle' || !!target

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
              clearImage()
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
              width: comment.length > 0 || !!image ? 300 : 'auto',
              background: '#1e1e1e',
              borderRadius: comment.length > 0 || !!image ? 14 : 9999,
              padding: comment.length > 0 || !!image ? '10px 10px 6px' : '6px 6px 6px 10px',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              transition: 'border-radius 0.2s, width 0.2s, padding 0.2s',
            }}
          >
            {/* Top row: avatar + input + send */}
            <div style={{ display: 'flex', alignItems: comment.length > 0 || !!image ? 'flex-start' : 'center', gap: 10 }}>
              {/* Avatar */}
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#3b82f6', flexShrink: 0, marginTop: comment.length > 0 ? 2 : 0 }} />
              {/* Textarea (single row when empty, expands when typing) */}
              <textarea
                ref={textareaRef}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (comment.trim()) handleSend()
                  }
                }}
                placeholder="Add a comment"
                rows={comment.length > 0 || !!image ? 3 : 1}
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

            {/* Screenshot thumbnail (auto-captured) */}
            {imagePreviewUrl && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                marginTop: 6, paddingTop: 6, borderTop: '1px solid #333',
              }}>
                <img
                  src={imagePreviewUrl}
                  alt="captured element"
                  style={{ height: 48, maxWidth: 100, objectFit: 'cover', borderRadius: 6, flexShrink: 0, border: '1px solid #333' }}
                />
                <span style={{ fontSize: 11, color: '#666', flex: 1 }}>Screenshot captured</span>
                <button
                  onClick={() => clearImage()}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', padding: 2, display: 'flex', flexShrink: 0 }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            )}

            {/* Bottom toolbar (visible when typing or image captured) */}
            {(comment.length > 0 || !!image) && (
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
      {mode === 'commenting' && target && (() => {
        const { pageX, pageY } = fromPagePercent(target.x, target.y)
        return (
        <div
          {...{ [WIDGET_ATTR]: '' }}
          style={{
            position: 'absolute',
            left: pageX,
            top: pageY - 44,
            zIndex: 2147483646,
            pointerEvents: 'none',
            animation: 'fw-pin-glow-pulse 2.4s ease-in-out infinite',
            transformOrigin: 'bottom left',
          }}
        >
          <PinMarker />
        </div>
        )
      })()}

      {/* Persisted comment pins */}
      {visibleComments.map((c, i) => {
        const { pageX: pinPageX, pageY: pinPageY } = fromPagePercent(c.x, c.y)
        const pinNumber = visibleComments.length - i
        const isSelected = selectedPin === c.id
        const isHovered = hoveredPin === c.id && !isSelected
        const isResolved = c.reviewStatus === 'accepted' || c.reviewStatus === 'rejected'
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
                left: pinPageX,
                top: pinPageY - 44,
                zIndex: isSelected ? 2147483646 : isHovered ? 2147483642 : 2147483640,
                cursor: 'pointer',
                transition: 'transform 0.15s, opacity 0.2s',
                transform: isSelected || isHovered ? 'scale(1.15)' : 'scale(1)',
                transformOrigin: 'bottom left',
                opacity: isResolved && !isSelected && !isHovered ? 0.4 : 1,
                animation: 'fw-pin-glow-pulse 2.4s ease-in-out infinite',
              }}
            >
              <PinMarker outline={isSelected} />
            </div>

            {/* Hover tooltip — same material as pin, expanded card */}
            {isHovered && (
              <div
                style={{
                  position: 'absolute',
                  left: pinPageX,
                  top: pinPageY - 12,
                  zIndex: 2147483643,
                  pointerEvents: 'none',
                  transform: 'translateY(-100%)',
                }}
              >
                <div style={{
                  position: 'relative',
                  width: 280,
                  background: 'rgba(255, 255, 255, 0.65)',
                  backdropFilter: 'blur(20px) saturate(180%)',
                  WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                  borderRadius: '14px 14px 14px 0',
                  padding: 14,
                  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.5)',
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                  animation: 'fw-tooltip-liquid 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
                  transformOrigin: '0% 100%',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: PIN_GRADIENT,
                    flexShrink: 0,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ marginBottom: 4, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{c.authorName ?? 'User'}</span>
                      <span style={{ fontSize: 12, color: '#888' }}>{timeAgo(c.createdAt)}</span>
                    </div>
                    <div style={{ fontSize: 13, color: '#333', lineHeight: 1.4, wordBreak: 'break-word' }}>
                      {c.body}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Pin detail popover */}
            {isSelected && (() => {
              const avColor = avatarColor(c.id)
              const initial = (c.body[0] || 'U').toUpperCase()
              const stBadge = c.reviewStatus === 'accepted'
                ? { bg: '#ecfdf5', color: '#059669', label: 'Approved' }
                : c.reviewStatus === 'rejected'
                  ? { bg: '#fef2f2', color: '#dc2626', label: 'Rejected' }
                  : { bg: '#fffbeb', color: '#d97706', label: 'Pending' }
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
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#111', marginBottom: 2 }}>{c.authorName ?? 'User'}</div>
                        <div style={{ fontSize: 11, color: '#aaa' }}>
                          #{pinNumber} &middot; {timeAgo(c.createdAt)}
                        </div>
                      </div>
                      {/* Action cluster: resolve + menu + status dot */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, position: 'relative' }}>
                        {!isResolved && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              updateStatus(c.id, 'accepted')
                              setSelectedPin(null)
                            }}
                            title="Mark as resolved"
                            style={{
                              width: 22, height: 22, borderRadius: '50%',
                              border: '1.5px solid #d4d4d4',
                              background: 'transparent', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              color: '#888', padding: 0,
                              transition: 'all 0.15s',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#22c55e'; e.currentTarget.style.color = '#22c55e' }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#d4d4d4'; e.currentTarget.style.color = '#888' }}
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); setPopoverMenuOpen((v) => !v) }}
                          title="More"
                          style={{
                            width: 24, height: 24, borderRadius: 4, border: 'none',
                            background: popoverMenuOpen ? '#f0f0f0' : 'transparent',
                            cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#888', padding: 0,
                            transition: 'background 0.15s',
                          }}
                          onMouseEnter={(e) => { if (!popoverMenuOpen) e.currentTarget.style.background = '#f5f5f5' }}
                          onMouseLeave={(e) => { if (!popoverMenuOpen) e.currentTarget.style.background = 'transparent' }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
                        </button>
                        {!isResolved && (
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6', flexShrink: 0 }} />
                        )}

                        {popoverMenuOpen && (
                          <>
                            <div
                              onClick={(e) => { e.stopPropagation(); setPopoverMenuOpen(false) }}
                              style={{ position: 'fixed', inset: 0, zIndex: 99998 }}
                            />
                            <div
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                position: 'absolute', top: 30, right: 0, zIndex: 99999,
                                background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8,
                                padding: '4px 0', minWidth: 180,
                                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                                animation: 'fw-tooltip-in 0.1s ease both',
                              }}
                            >
                              <button
                                onClick={() => { updateStatus(c.id, isResolved ? 'open' : 'accepted'); setPopoverMenuOpen(false); setSelectedPin(null) }}
                                style={{ width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: '#333', fontSize: 13, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'inherit' }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                                {isResolved ? 'Reopen' : 'Mark as resolved'}
                              </button>
                              <button
                                onClick={() => { setEditingId(c.id); setEditText(c.body); setPopoverMenuOpen(false) }}
                                style={{ width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: '#333', fontSize: 13, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'inherit' }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                Edit
                              </button>
                              <div style={{ height: 1, background: '#eee', margin: '4px 0' }} />
                              <button
                                onClick={() => { deleteComment(c.id); setPopoverMenuOpen(false); setSelectedPin(null) }}
                                style={{ width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: '#ef4444', fontSize: 13, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'inherit' }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#fef2f2')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                                Delete
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Comment text — editable when editingId matches */}
                    {editingId === c.id ? (
                      <div style={{ marginBottom: c.imageUrl ? 10 : 14 }}>
                        <textarea
                          autoFocus
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(c.id) }
                            if (e.key === 'Escape') { setEditingId(null) }
                          }}
                          rows={3}
                          style={{
                            width: '100%', boxSizing: 'border-box',
                            fontSize: 14, lineHeight: 1.5, color: '#111',
                            border: '1px solid #d4d4d4', borderRadius: 8,
                            padding: '8px 10px', fontFamily: 'inherit',
                            outline: 'none', resize: 'vertical', background: '#fff',
                          }}
                          onFocus={(e) => (e.target.style.borderColor = '#3b82f6')}
                          onBlur={(e) => (e.target.style.borderColor = '#d4d4d4')}
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 6, justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => setEditingId(null)}
                            style={{ fontSize: 12, color: '#666', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 10px', fontFamily: 'inherit' }}
                          >Cancel</button>
                          <button
                            onClick={() => saveEdit(c.id)}
                            style={{ fontSize: 12, color: '#fff', background: '#3b82f6', fontWeight: 600, border: 'none', borderRadius: 6, cursor: 'pointer', padding: '4px 12px', fontFamily: 'inherit' }}
                          >Save</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 14, lineHeight: 1.6, color: '#333', marginBottom: c.imageUrl ? 10 : 14 }}>
                        {c.body}
                      </div>
                    )}

                    {/* Screenshot */}
                    {c.imageUrl && (
                      <img
                        src={c.imageUrl}
                        alt=""
                        onClick={() => window.open(c.imageUrl!, '_blank')}
                        style={{ width: '100%', borderRadius: 8, border: '1px solid #eee', cursor: 'zoom-in', display: 'block', marginBottom: 14 }}
                      />
                    )}

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
          style={{ position: 'fixed', inset: 0, zIndex: 2147483646 }}
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
          zIndex: 2147483647,
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
              const isResolved = c.reviewStatus === 'accepted' || c.reviewStatus === 'rejected'
              const isPending = !c.reviewStatus || c.reviewStatus === 'open'
              const isEditing = editingId === c.id
              const initial = (c.body[0] || 'U').toUpperCase()
              const isMenuOpen = menuOpenId === c.id
              return (
                <div
                  key={c.id}
                  className="fw-sidebar-card"
                  onClick={() => { if (!isEditing && !isMenuOpen) { setSelectedPin(c.id); highlightElement(c.selector) } }}
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
                        {c.pageUrl.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '') || '/'}
                      </span>
                    </div>

                    {/* Author + time */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#ddd' }}>{c.authorName ?? 'User'}</span>
                      <span style={{ fontSize: 11, color: '#555' }}>{timeAgo(c.createdAt)}</span>
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
                      <>
                        <div
                          onClick={(e) => { e.stopPropagation(); setEditingId(c.id); setEditText(c.body) }}
                          style={{ fontSize: 13, lineHeight: 1.4, color: isResolved ? '#555' : '#ccc', cursor: 'text' }}
                        >
                          {c.body}
                        </div>
                        {c.imageUrl && (
                          <img
                            src={c.imageUrl}
                            alt=""
                            onClick={(e) => { e.stopPropagation(); window.open(c.imageUrl!, '_blank') }}
                            style={{ marginTop: 8, maxWidth: '100%', borderRadius: 6, border: '1px solid #2a2a2a', cursor: 'zoom-in', display: 'block', filter: isResolved ? 'grayscale(0.7) brightness(0.5)' : 'none' }}
                          />
                        )}
                      </>
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
                          onClick={(e) => { e.stopPropagation(); updateStatus(c.id, 'accepted') }}
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
                        onClick={() => { updateStatus(c.id, c.reviewStatus === 'accepted' ? 'open' : 'accepted'); setMenuOpenId(null) }}
                        style={{ width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: '#ccc', fontSize: 12, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#333')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                        {c.reviewStatus === 'accepted' ? 'Unresolve' : 'Mark as resolved'}
                      </button>
                      <button
                        onClick={() => { setEditingId(c.id); setEditText(c.body); setMenuOpenId(null) }}
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

            {/* Agent bridge */}
            <VtooltipItem index={1}>
              <VtooltipTrigger
                onClick={(e) => {
                  if (didDrag.current) { e.preventDefault(); return }
                  setAgentOpen(true)
                }}
              >
                <div className="fw-pill-icon" style={{ position: 'relative', display: 'flex', width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 9999 }}>
                  <Bot style={{ width: 18, height: 18 }} />
                </div>
                <span style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>Connect agent</span>
              </VtooltipTrigger>
              <VtooltipContent>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, whiteSpace: 'nowrap', padding: '0 8px', fontSize: 14, fontWeight: 500, lineHeight: 1.2, letterSpacing: '-0.01em', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
                  Connect agent
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

      {/* Agent bridge modal */}
      {agentOpen && <AgentBridgeModal apiBase={apiBase} projectId={projectId} onClose={() => setAgentOpen(false)} />}

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
        @keyframes fw-pin-glow-pulse {
          0%, 100% {
            filter:
              drop-shadow(0 0 8px rgba(91, 135, 232, 0.5))
              drop-shadow(0 0 16px rgba(91, 135, 232, 0.25))
              drop-shadow(0 2px 4px rgba(0, 0, 0, 0.18));
          }
          50% {
            filter:
              drop-shadow(0 0 12px rgba(91, 135, 232, 0.65))
              drop-shadow(0 0 26px rgba(91, 135, 232, 0.35))
              drop-shadow(0 2px 4px rgba(0, 0, 0, 0.18));
          }
        }
        @keyframes fw-pin-inner-pulse {
          0%, 100% { opacity: 0.5; transform: translate(-50%, -50%) scale(0.8); }
          50% { opacity: 1; transform: translate(-50%, -50%) scale(1.2); }
        }
        @keyframes fw-tooltip-liquid {
          0% { opacity: 0; transform: scale(0.08); filter: blur(10px); }
          35% { opacity: 1; }
          100% { opacity: 1; transform: scale(1); filter: blur(0); }
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
        @keyframes fw-modal-overlay-in {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes fw-modal-card-in {
          0% { opacity: 0; transform: scale(0.94) translateY(8px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      {showNameModal && (
        <div
          {...{ [WIDGET_ATTR]: '' }}
          style={{
            position: 'fixed', inset: 0, zIndex: 2147483647,
            background: 'rgba(10, 10, 15, 0.55)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'fw-modal-overlay-in 0.18s ease both',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!nameInput.trim()) return
              saveAuthorName(nameInput)
              setShowNameModal(false)
              setNameInput('')
              setMode('commenting')
            }}
            style={{
              width: 360, maxWidth: 'calc(100vw - 32px)',
              background: '#fff', borderRadius: 16, padding: 24,
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.25), 0 4px 12px rgba(0, 0, 0, 0.12)',
              animation: 'fw-modal-card-in 0.22s cubic-bezier(0.16, 1, 0.3, 1) both',
              display: 'flex', flexDirection: 'column', gap: 16,
            }}
          >
            <div style={{
              width: 44, height: 44, borderRadius: '50% 50% 50% 0',
              background: PIN_GRADIENT,
              alignSelf: 'flex-start',
            }} />
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111', margin: 0, marginBottom: 6 }}>
                What's your name?
              </h2>
              <p style={{ fontSize: 13, color: '#666', margin: 0, lineHeight: 1.4 }}>
                Your name will appear on the comments you leave.
              </p>
            </div>
            <input
              autoFocus
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="e.g. Tomas"
              required
              maxLength={40}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '10px 12px', fontSize: 14, color: '#111',
                background: '#fafafa',
                border: '1px solid #e5e5e5', borderRadius: 8,
                outline: 'none', fontFamily: 'inherit',
                transition: 'border-color 0.15s, background 0.15s',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#2563eb'; e.currentTarget.style.background = '#fff' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#e5e5e5'; e.currentTarget.style.background = '#fafafa' }}
            />
            <button
              type="submit"
              disabled={!nameInput.trim()}
              style={{
                width: '100%', padding: '11px 0', fontSize: 14, fontWeight: 600,
                color: '#fff',
                background: nameInput.trim() ? '#111' : '#ccc',
                border: 'none', borderRadius: 8,
                cursor: nameInput.trim() ? 'pointer' : 'not-allowed',
                transition: 'background 0.15s',
                fontFamily: 'inherit',
              }}
            >
              Continue
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

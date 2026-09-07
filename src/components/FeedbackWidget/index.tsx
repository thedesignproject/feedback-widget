import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, MessageCircle, PanelRightOpen, X } from 'lucide-react'
import { getSelector } from '../../lib/getSelector'
import { buildTextRangeAnchor } from '../../lib/textAnchor'
import { useScreenshotCapture } from '../../lib/screenshotCapture'
import { AgentBridgeModal } from '../AgentBridgeModal'
import type { ClickTarget, Comment, FeedbackWidgetProps, Mode, ReviewStatus } from './types'
import { AUTHOR_NAME_KEY, COMMENT_CUTOFF, CRRT_CARROT_LOGO_URL, PIN_GRADIENT, WIDGET_ATTR } from './constants'
import { fromPagePercentFixed, toPagePercent } from './coords'
import { avatarColor, getInitials, normalizeReviewStatus, timeAgo } from './format'
import { deleteComment as apiDeleteComment, fetchAgentEligibility, fetchProjectComments, patchReviewStatus as apiPatchReviewStatus, postComment } from './api'
import { FeedbackWidgetStyles } from './styles'
import { ensureWidgetFonts } from './fonts'
import { PinActionCluster, PinMarker } from './pin'
import { NameModal } from './modal'
import { SelectingInstructionBar } from './selecting'
import { TextRangeQuote } from './quote'
import { listenForWidgetEvent } from './events'
import { SpeechInputButton } from './voice'

type CaretPositionDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null
  caretRangeFromPoint?: (x: number, y: number) => Range | null
}

function clearNativeSelection() {
  window.getSelection()?.removeAllRanges()
}

function textNodeAtPoint(x: number, y: number): Node | null {
  const doc = document as CaretPositionDocument
  if (typeof doc.caretPositionFromPoint === 'function') {
    return doc.caretPositionFromPoint(x, y)?.offsetNode ?? null
  }
  if (typeof doc.caretRangeFromPoint === 'function') {
    return doc.caretRangeFromPoint(x, y)?.startContainer ?? null
  }
  return null
}

function isTextAtPoint(x: number, y: number): boolean {
  const node = textNodeAtPoint(x, y)
  if (!node || node.nodeType !== Node.TEXT_NODE) return false
  if (!(node.textContent ?? '').trim()) return false

  const range = document.createRange()
  range.selectNodeContents(node)
  for (const rect of Array.from(range.getClientRects())) {
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return true
    }
  }
  return false
}

function dashboardAuthUrl(apiBase: string, path: '/dashboard/login' | '/dashboard/signup') {
  try {
    const origin = new URL(apiBase, window.location.origin).origin
    return new URL(path, origin).toString()
  } catch {
    return path
  }
}

function getElementFixedPos(
  selector: string,
  xPct: number,
  yPct: number,
): { left: number; top: number } | null {
  try {
    const el = document.querySelector(selector)
    if (!el) return null
    const rect = (el as HTMLElement).getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return null
    const pageX = (xPct / 100) * document.documentElement.scrollWidth
    const pageY = (yPct / 100) * document.documentElement.scrollHeight
    return { left: pageX - window.scrollX, top: pageY - window.scrollY }
  } catch {
    return null
  }
}

function CarrotPixelIcon({ size = 20 }: { size?: number | string }) {
  return (
    <img
      src={CRRT_CARROT_LOGO_URL}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'block',
        objectFit: 'cover',
        imageRendering: 'pixelated',
        flexShrink: 0,
      }}
    />
  )
}

function LauncherAction({
  icon,
  title,
  subtitle,
  shortcut,
  onClick,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  shortcut: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        width: '100%',
        display: 'grid',
        gridTemplateColumns: '36px minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: 10,
        padding: 8,
        border: 0,
        borderRadius: 10,
        background: 'transparent',
        color: 'var(--fw-foreground)',
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--fw-contrast-07)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <span
        style={{
          width: 36,
          height: 36,
          borderRadius: 9999,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--fw-contrast-05)',
          border: '1px solid var(--fw-contrast-09)',
          color: '#E8853D',
        }}
      >
        {icon}
      </span>
      <span style={{ minWidth: 0, display: 'grid', gap: 2 }}>
        <span
          style={{
            fontFamily: "'VT323', 'JetBrains Mono', ui-monospace, monospace",
            fontSize: 24,
            fontWeight: 400,
            letterSpacing: '0.02em',
            lineHeight: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </span>
        <span style={{ fontSize: 12, color: 'var(--fw-foreground-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {subtitle}
        </span>
      </span>
      <kbd
        style={{
          minWidth: 26,
          padding: '4px 7px',
          borderRadius: 6,
          border: '1px solid var(--fw-contrast-12)',
          background: 'var(--fw-key-background)',
          color: 'var(--fw-foreground-soft)',
          fontSize: 11,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          textAlign: 'center',
          whiteSpace: 'nowrap',
        }}
      >
        {shortcut}
      </kbd>
    </button>
  )
}

function AgentAuthGate({
  readyCount,
  signUpUrl,
  loginUrl,
  onClose,
}: {
  readyCount: number
  signUpUrl: string
  loginUrl: string
  onClose: () => void
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div {...{ [WIDGET_ATTR]: '' }}>
      <div
        aria-hidden
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 2147483646,
          background: 'rgba(0, 0, 0, 0.48)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sign in to use agent"
        style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          zIndex: 2147483647,
          width: 'min(360px, calc(100vw - 32px))',
          transform: 'translate(-50%, -50%)',
          borderRadius: 18,
          border: '1px solid rgba(232, 133, 61, 0.22)',
          background: 'var(--fw-surface-solid)',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.58)',
          color: 'var(--fw-foreground)',
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          overflow: 'hidden',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 30,
            height: 30,
            border: '1px solid var(--fw-contrast-08)',
            borderRadius: 9999,
            background: 'var(--fw-contrast-03)',
            color: 'var(--fw-foreground-muted)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={15} />
        </button>

        <div style={{ padding: '26px 24px 22px' }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 18,
              background: '#E8853D',
              color: '#080808',
            }}
          >
            <Bot size={22} />
          </div>
          <h2 style={{ margin: 0, fontSize: 22, lineHeight: 1.1, letterSpacing: 0, fontWeight: 750 }}>
            Log in to copy prompt
          </h2>
          <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.5, color: 'var(--fw-foreground-muted)' }}>
            Preview the agent prompt first. Copying it requires an account so CRRT can track the handoff.
          </p>
          <div
            style={{
              marginTop: 16,
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--fw-contrast-04)',
              border: '1px solid var(--fw-contrast-06)',
              color: 'var(--fw-foreground-soft)',
              fontSize: 13,
            }}
          >
            {readyCount > 0
              ? `${readyCount} approved comment${readyCount === 1 ? '' : 's'} ready`
              : 'Approve comments first, then send them to agent'}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <a
              href={signUpUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                flex: 1,
                height: 42,
                borderRadius: 9999,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#E8853D',
                color: '#080808',
                textDecoration: 'none',
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              Sign up
            </a>
            <a
              href={loginUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                flex: 1,
                height: 42,
                borderRadius: 9999,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid var(--fw-contrast-10)',
                color: 'var(--fw-foreground)',
                textDecoration: 'none',
                fontSize: 14,
                fontWeight: 650,
              }}
            >
              Log in
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

export function FeedbackWidget({ disabled = false, ...props }: FeedbackWidgetProps) {
  if (disabled) return null
  return <FeedbackWidgetInner {...props} />
}

function FeedbackWidgetInner({
  projectId,
  apiBase = 'https://crrt.ai/api',
  theme = 'dark',
  personalComments,
  viewerEmail,
  page,
}: Omit<FeedbackWidgetProps, 'disabled'>) {
  useEffect(() => {
    ensureWidgetFonts()
  }, [])

  const [mode, setMode] = useState<Mode>('idle')
  const widgetRef = useRef<HTMLDivElement>(null)
  const [target, setTarget] = useState<ClickTarget | null>(null)
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  const [speechStopSignal, setSpeechStopSignal] = useState(0)
  const [hovered, setHovered] = useState<Element | null>(null)
  const [apiError, setApiError] = useState('')

  const [authorName, setAuthorName] = useState<string | null>(null)
  const authorNameRef = useRef<string | null>(null)
  const [showNameModal, setShowNameModal] = useState(false)
  const [nameInput, setNameInput] = useState('')
  useEffect(() => {
    if (personalComments) {
      const name = viewerEmail || 'You'
      authorNameRef.current = name; setAuthorName(name); return
    }
    try {
      const stored = localStorage.getItem(AUTHOR_NAME_KEY)
      if (stored) {
        authorNameRef.current = stored
        setAuthorName(stored)
      }
    } catch {}
  }, [personalComments, viewerEmail])

  function saveAuthorName(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    authorNameRef.current = trimmed
    setAuthorName(trimmed)
    try { localStorage.setItem(AUTHOR_NAME_KEY, trimmed) } catch {}
  }

  function openNameEditor() {
    if (personalComments) return
    setNameInput(authorNameRef.current ?? '')
    setShowNameModal(true)
  }

  const pendingSendAfterName = useRef(false)

  function handleNameSubmit() {
    if (!nameInput.trim()) return
    const wasCommenting = mode === 'commenting'
    saveAuthorName(nameInput)
    setShowNameModal(false)
    setNameInput('')
    if (pendingSendAfterName.current) {
      pendingSendAfterName.current = false
      handleSend()
    } else if (!wasCommenting && target) {
      setMode('commenting')
    }
  }

  function handleNameCancel() {
    setShowNameModal(false)
    setNameInput('')
  }

  // Launcher hover/menu state.
  const [pillHover, setPillHover] = useState(false)
  const [launcherFocused, setLauncherFocused] = useState(false)
  const [launcherOpen, setLauncherOpen] = useState(false)
  const [selectingHintShown, setSelectingHintShown] = useState(false)
  const [showSelectingHint, setShowSelectingHint] = useState(false)
  const pillLeaveTimer = useRef<number | null>(null)
  const onPillEnter = useCallback(() => {
    if (pillLeaveTimer.current) {
      window.clearTimeout(pillLeaveTimer.current)
      pillLeaveTimer.current = null
    }
    setPillHover(true)
  }, [])
  const onPillLeave = useCallback(() => {
    if (pillLeaveTimer.current) window.clearTimeout(pillLeaveTimer.current)
    pillLeaveTimer.current = window.setTimeout(() => {
      pillLeaveTimer.current = null
      setPillHover(false)
    }, 120)
  }, [])
  useEffect(() => () => {
    if (pillLeaveTimer.current) window.clearTimeout(pillLeaveTimer.current)
  }, [])

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
    }
    window.addEventListener('resize', onResize)
    // Capture phase + document target catches scroll on any nested scrollable
    // container (dashboards with internal overflow:auto panels). Bubble-phase
    // listeners on window miss those because scroll events don't bubble.
    document.addEventListener('scroll', bump, { passive: true, capture: true })

    const ro = new ResizeObserver(bump)
    ro.observe(document.body)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('scroll', bump, { capture: true })
      ro.disconnect()
    }
  }, [])
  // Pin state
  const [selectedPin, setSelectedPin] = useState<string | null>(null)
  const [hoveredPin, setHoveredPin] = useState<string | null>(null)

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)

  // Track current URL for SPA navigation (pins scoped to page).
  // Poll location.href because some routers (e.g. Next.js App Router) cache
  // history.pushState at module load and bypass any wrapper we install.
  const [currentUrl, setCurrentUrl] = useState(() => (
    page ? page.url : typeof window === 'undefined' ? '' : window.location.href.split('#')[0]
  ))
  useEffect(() => {
    if (page) { setCurrentUrl(page.url); return }
    const id = window.setInterval(() => {
      const next = window.location.href.split('#')[0]
      setCurrentUrl((prev) => (prev === next ? prev : next))
    }, 300)
    return () => window.clearInterval(id)
  }, [page?.url])

  // Sidebar state
  const [comments, setComments] = useState<Comment[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [badgeAnim, setBadgeAnim] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const [agentGateOpen, setAgentGateOpen] = useState(false)
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'approved'>('all')
  const [pinsVisible, setPinsVisible] = useState(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  // Synchronous guard — state updates are async, so double-firing handleSend
  // in the same tick (e.g. Cmd+Enter held down) would otherwise slip past `sending`.
  const sendingRef = useRef(false)

  const [postSendHint, setPostSendHint] = useState(false)
  const [launcherBump, setLauncherBump] = useState(false)
  const signUpUrl = useMemo(() => dashboardAuthUrl(apiBase, '/dashboard/signup'), [apiBase])
  const loginUrl = useMemo(() => dashboardAuthUrl(apiBase, '/dashboard/login'), [apiBase])

  const {
    image,
    previewUrl: imagePreviewUrl,
    status: screenshotStatus,
    capture: captureImage,
    clear: clearImage,
    toBase64: encodeImage,
  } = useScreenshotCapture(page?.capture)
  const screenshotCapturing = screenshotStatus === 'capturing'
  const sendDisabled = !comment.trim() || sending || screenshotCapturing

  useEffect(() => {
    page?.selecting(mode === 'selecting')
    return () => page?.selecting(false)
  }, [mode, page?.selecting])
  useEffect(() => { page?.track(comments.map(({ id, selector }) => ({ id, selector }))) }, [comments, page?.track])
  useEffect(() => {
    if (!page?.target) return
    setTarget(page.target); setSelectedPin(null); setSidebarOpen(false); setMode('commenting')
    void captureImage()
  }, [page?.target])
  useEffect(() => {
    if (!page) return
    setTarget(null); setComment(''); clearImage(); setMode('idle'); setSelectedPin(null)
  }, [page?.url])

  const pagePoint = (x: number, y: number) => page
    ? { fixedX: x / 100 * page.width - page.scrollX, fixedY: y / 100 * page.height - page.scrollY }
    : fromPagePercentFixed(x, y)

  // --- Fetch comments on mount ---
  useEffect(() => {
    let cancelled = false
    let refreshVersion = 0
    const request = personalComments ? personalComments.list(currentUrl) : fetchProjectComments(apiBase, projectId)
    request.then((nextComments) => {
      if (!cancelled) setComments(nextComments)
    }).catch((error) => { if (!cancelled) setApiError(String(error.message)) })
    const refresh = async () => {
      if (!personalComments) return
      const version = ++refreshVersion
      try {
        const fresh = await personalComments.list(currentUrl)
        if (!cancelled && version === refreshVersion) setComments((items) => items.map((item) => {
          const updated = fresh.find((candidate) => candidate.id === item.id)
          return updated ? { ...item, imageUrl: updated.imageUrl } : item
        }))
      } catch { /* Preserve drafts and loaded comments while offline. */ }
    }
    const timer = personalComments ? window.setInterval(refresh, 240_000) : undefined
    window.addEventListener('focus', refresh)
    return () => {
      cancelled = true
      window.clearInterval(timer); window.removeEventListener('focus', refresh)
    }
  }, [projectId, apiBase, personalComments, currentUrl])

  // --- Set crosshair cursor when selecting; switch to text over real glyphs ---
  const [textHover, setTextHover] = useState(false)
  useEffect(() => {
    if (mode !== 'selecting' || page) return
    const prev = document.body.style.cursor
    document.body.style.cursor = textHover ? 'text' : 'crosshair'
    return () => {
      document.body.style.cursor = prev
    }
  }, [mode, textHover])

  // --- Highlight hovered element ---
  useEffect(() => {
    if (mode !== 'selecting' || page) {
      setHovered(null)
      setTextHover(false)
      return
    }

    function onMove(e: MouseEvent) {
      const el = e.target as HTMLElement
      if (el && !el.closest?.(`[${WIDGET_ATTR}]`)) {
        setHovered(el)
        setTextHover(isTextAtPoint(e.clientX, e.clientY))
      } else {
        setHovered(null)
        setTextHover(false)
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
    el.style.outline = '2px solid rgba(232, 133, 61, 0.6)'
    el.style.outlineOffset = '2px'
    return () => {
      el.style.outline = prev
      el.style.outlineOffset = prevOffset
    }
  }, [hovered])

  // --- Handle element click / text selection in selecting mode ---
  useEffect(() => {
    if (mode !== 'selecting' || page) return

    function onClick(e: MouseEvent) {
      const el = e.target as HTMLElement
      if (el.closest?.(`[${WIDGET_ATTR}]`)) return

      e.preventDefault()
      e.stopPropagation()
      setShowSelectingHint(false)

      setSelectedPin(null)
      setSidebarOpen(false)
      clearImage()

      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        const built = buildTextRangeAnchor(sel.getRangeAt(0), {
          getSelector,
          url: window.location.href,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
          },
          isExcluded: (node) => node.closest(`[${WIDGET_ATTR}]`) !== null,
        })
        if (built) {
          const pct = toPagePercent(
            built.midpointClient.x + window.scrollX,
            built.midpointClient.y + window.scrollY,
          )
          setTarget({
            selector: built.anchor.containerSelector,
            x: pct.x,
            y: pct.y,
            url: window.location.href,
            targetType: 'text_range',
            anchor: built.anchor,
          })

          if (!authorNameRef.current) {
            setShowNameModal(true)
            return
          }

          setMode('commenting')
          return
        }
      }

      const pct = toPagePercent(e.pageX, e.pageY)
      setTarget({
        selector: getSelector(el),
        x: pct.x,
        y: pct.y,
        url: window.location.href,
      })

      const rect = el.getBoundingClientRect()
      captureImage({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      })

      if (!authorNameRef.current) {
        setShowNameModal(true)
        return
      }

      setMode('commenting')
    }

    window.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('click', onClick, true)
    }
  }, [mode])

  // --- Auto-focus textarea ---
  useEffect(() => {
    if (mode === 'commenting' && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [mode])

  // --- Send comment ---
  const handleSend = useCallback(async () => {
    if (!comment.trim() || !target || sendingRef.current || screenshotCapturing) return
    setSpeechStopSignal((signal) => signal + 1)

    if (!authorNameRef.current) {
      pendingSendAfterName.current = true
      setNameInput('')
      setShowNameModal(true)
      return
    }

    sendingRef.current = true
    setSending(true)
    setApiError('')

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

      if (authorNameRef.current) {
        payload.authorName = authorNameRef.current
      }

      if (targetData.anchor) {
        payload.targetType = 'text_range'
        payload.anchor = targetData.anchor
      }

      const encoded = await encodeImage()
      if (encoded) {
        payload.imageBase64 = encoded.base64
        payload.imageMimeType = encoded.mimeType
      }

      const data = await (personalComments ? personalComments.create(payload) : postComment(apiBase, payload))
      if (!data) return

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
        authorName: data.authorName ?? authorNameRef.current ?? undefined,
        targetType: targetData.targetType,
        anchor: targetData.anchor ?? null,
      }

      setComments((prev) => [newComment, ...prev])

      setBadgeAnim(true)
      setTimeout(() => setBadgeAnim(false), 720)

      setPostSendHint(true)
      setLauncherBump(true)
      setTimeout(() => setLauncherBump(false), 650)
      setTimeout(() => setPostSendHint(false), 2200)

      clearNativeSelection()
      setTarget(null)
      setComment('')
      clearImage()
      setHovered(null)
      setMode('selecting')
      setSidebarOpen(false)
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Could not save comment')
      console.warn('[FeedbackWidget] API error:', err)
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }, [comment, target, projectId, apiBase, encodeImage, clearImage, screenshotCapturing, personalComments])

  // --- Keyboard shortcuts ---
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const element = e.composedPath()[0] as HTMLElement
      const tag = element.tagName
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable

      if (e.key === 'Escape') {
        if (showNameModal) {
          setShowNameModal(false)
          setNameInput('')
        } else if (selectedPin) {
          setSelectedPin(null)
        } else if (mode === 'commenting') {
          clearNativeSelection()
          setTarget(null)
          setComment('')
          clearImage()
          setSending(false)
          setMode('selecting')
        } else if (mode === 'selecting') {
          exitFeedbackMode()
        } else if (sidebarOpen) {
          setSidebarOpen(false)
        } else if (launcherOpen) {
          setLauncherOpen(false)
        }
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && mode === 'commenting') {
        handleSend()
      }

      // Single-key shortcuts — skip when typing in an input
      if (isTyping) return
      if (e.repeat) return

      // Shift+A — open Agent bridge modal directly (no reveal step now that aux chips are gone)
      if (e.shiftKey && e.key.toLowerCase() === 'a') {
        openAgentBridge()
        return
      }

      if (e.key === 'c' || e.key === 'C') {
        if (mode === 'idle') {
          enterFeedbackMode()
          return
        }
        if (mode === 'selecting') {
          exitFeedbackMode()
          return
        }
      }
      if (e.key === 's' || e.key === 'S') {
        enterFeedbackMode()
      }
      if (e.key === 'm' || e.key === 'M' || e.key === 'f' || e.key === 'F') {
        setSidebarOpen((v) => !v)
      }
      if (e.key === 'h' || e.key === 'H') {
        setPinsVisible((v) => !v)
      }
    }
    return listenForWidgetEvent(widgetRef.current!, 'keydown', onKey)
  }, [mode, handleSend, launcherOpen, openAgentBridge, sidebarOpen, selectedPin, showNameModal])

  function exitFeedbackMode() {
    clearNativeSelection()
    setMode('idle')
    setShowSelectingHint(false)
    setTarget(null)
    setComment('')
    clearImage()
    setSending(false)
    setHovered(null)
    setSelectedPin(null)
  }

  function enterFeedbackMode() {
    clearNativeSelection()
    setSidebarOpen(false)
    setLauncherOpen(false)
    if (!selectingHintShown) {
      setSelectingHintShown(true)
      setShowSelectingHint(true)
    }
    setMode('selecting')
  }

  function openReviewFromHint() {
    exitFeedbackMode()
    setPostSendHint(false)
    setSidebarOpen(true)
  }

  function openAgentBridge() {
    if (personalComments) return
    setLauncherOpen(false)
    setAgentGateOpen(false)
    setSidebarOpen(false)
    setAgentOpen(true)
  }

  async function ensureAgentAccess() {
    const eligibility = await fetchAgentEligibility(apiBase, projectId)
    if (eligibility?.canRequest && !eligibility.mustSignUp) return true
    setAgentGateOpen(true)
    return false
  }

  // Close the launcher menu on outside click.
  useEffect(() => {
    if (!launcherOpen) return
    function onPointerDown(e: PointerEvent) {
      const targetEl = e.composedPath()[0] as HTMLElement
      if (!targetEl.closest('[data-fw-launcher-root]')) setLauncherOpen(false)
    }
    return listenForWidgetEvent(widgetRef.current!, 'pointerdown', onPointerDown, true)
  }, [launcherOpen])

  // External trigger — landing page "Drop a carrot" buttons dispatch this event.
  useEffect(() => {
    const handler = () => { if (mode === 'idle') enterFeedbackMode() }
    window.addEventListener('crrt:activate', handler)
    return () => window.removeEventListener('crrt:activate', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  function updateStatus(commentId: string, reviewStatus: ReviewStatus) {
    setComments((prev) => prev.map((c) => c.id === commentId ? { ...c, reviewStatus } : c))
    apiPatchReviewStatus(apiBase, commentId, reviewStatus)
  }

  async function deleteComment(commentId: string) {
    if (personalComments) {
      try { await personalComments.remove(commentId); setApiError('') }
      catch (error) { setApiError(String((error as Error).message)); return }
    }
    setComments((prev) => prev.filter((c) => c.id !== commentId))
    if (!personalComments) apiDeleteComment(apiBase, commentId, projectId)
  }

  async function saveEdit(commentId: string) {
    if (!editText.trim()) return
    const text = editText.trim()
    if (personalComments) {
      try { await personalComments.update(commentId, text); setApiError('') }
      catch (error) { setApiError(String((error as Error).message)); return }
    }
    setComments((prev) => prev.map((c) => c.id === commentId ? { ...c, body: text } : c))
    setEditingId(null)
  }

  // --- Highlight element from comment ---
  function highlightElement(selector: string) {
    if (page) { page.highlight(selector); return }
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
    const popH = 300
    const { fixedX, fixedY } = pagePoint(target.x, target.y)
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
    const { fixedX, fixedY } = pagePoint(c.x, c.y)
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

  const visibleComments = useMemo(() => comments.filter((c) => {
    if (new Date(c.createdAt) < COMMENT_CUTOFF) return false
    const commentUrl = c.pageUrl.split('#')[0]
    return commentUrl === currentUrl
  }), [comments, currentUrl])
  const filteredComments = useMemo(() => visibleComments.filter((c) => {
    const status = c.reviewStatus ?? 'open'
    if (filterStatus === 'open') return status === 'open'
    if (filterStatus === 'approved') return status === 'accepted'
    return true
  }), [visibleComments, filterStatus])
  const sortedComments = useMemo(() => [...filteredComments].sort((a, b) => {
    const aResolved = a.reviewStatus === 'accepted' || a.reviewStatus === 'rejected'
    const bResolved = b.reviewStatus === 'accepted' || b.reviewStatus === 'rejected'
    if (aResolved !== bResolved) return aResolved ? 1 : -1
    return 0
  }), [filteredComments])
  const readyForAgentCount = useMemo(
    () => visibleComments.filter((c) => c.reviewStatus === 'accepted').length,
    [visibleComments],
  )
  const openCommentCount = useMemo(
    () => visibleComments.filter((c) => c.reviewStatus === 'open').length,
    [visibleComments],
  )
  const sidebarTitle = filterStatus === 'approved'
    ? 'Ready for agent'
    : filterStatus === 'open'
      ? 'Open comments'
      : 'All comments'
  // Pin only renders if its selector still resolves on the current DOM.
  // Driven by a MutationObserver so we only recompute on real DOM changes,
  // and only re-render when the live set actually differs.
  const [liveCommentIds, setLiveCommentIds] = useState<Set<string>>(() => new Set())
  const filteredCommentsRef = useRef(filteredComments)
  filteredCommentsRef.current = filteredComments
  useEffect(() => {
    if (page) { setLiveCommentIds(new Set(page.liveIds)); return }
    const recompute = () => {
      const next = new Set<string>()
      for (const c of filteredCommentsRef.current) {
        try { if (document.querySelector(c.selector)) next.add(c.id) } catch { /* invalid selector */ }
      }
      setLiveCommentIds((prev) => {
        if (prev.size !== next.size) return next
        for (const id of next) if (!prev.has(id)) return next
        return prev
      })
    }
    recompute()
    let pending = false
    const obs = new MutationObserver(() => {
      if (pending) return
      pending = true
      window.setTimeout(() => { pending = false; recompute() }, 250)
    })
    obs.observe(document.body, { childList: true, subtree: true, attributes: true })
    return () => obs.disconnect()
  }, [filteredComments, page?.liveIds])
  const commentCount = filteredComments.length

  // Sync on scroll when anything position:fixed is visible — popovers, the
  // commenting flow, or persisted pins. Gating keeps idle pages cheap.
  needsPositionSyncRef.current = selectedPin !== null || mode !== 'idle' || !!target || (pinsVisible && filteredComments.length > 0)

  const pathDisplay = page ? new URL(page.url).pathname.slice(0, 28) : typeof window === 'undefined'
    ? '/'
    : window.location.pathname.slice(0, 28) || '/'
  const avatarInitial = authorName ? (getInitials(authorName) ?? authorName[0]?.toUpperCase() ?? 'U') : 'U'
  const badgeAnimation = badgeAnim ? 'fw-badge-pop 720ms cubic-bezier(0.16, 1, 0.3, 1)' : 'crrt-pulse 2.4s ease-in-out infinite'
  const launcherActive = launcherOpen || mode !== 'idle'
  const hideWidget = page?.hide

  return (
    <div ref={widgetRef} {...{ [WIDGET_ATTR]: '', 'data-fw-crrt': '', 'data-crrt-theme': theme }}>
      {apiError && <div role="alert" style={{ position: 'fixed', bottom: 24, left: 24, zIndex: 2147483647, padding: 16, background: 'var(--fw-surface)', color: 'var(--fw-foreground)', borderRadius: 8 }}>{apiError}<button onClick={() => setApiError('')} aria-label="Dismiss error">×</button></div>}
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
      {mode === 'selecting' && showSelectingHint && (
        <SelectingInstructionBar onCancel={exitFeedbackMode} />
      )}
      {mode === 'selecting' && !showSelectingHint && postSendHint && (
        <SelectingInstructionBar
          message="Saved. Drop another or review comments."
          keyLabel="F"
          actionLabel="review"
          tone="success"
          onCancel={openReviewFromHint}
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
              clearNativeSelection()
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
              width: 340,
              background: 'var(--fw-surface)',
              border: '1px solid var(--fw-contrast-06)',
              borderRadius: 14,
              fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              boxShadow: '0 12px 32px rgba(10, 10, 10, 0.4), 0 2px 8px rgba(10, 10, 10, 0.2)',
              overflow: 'hidden',
            }}
          >
            {/* Header: time pill (Phosphor amber) + location chip (Carrot tint) */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px 8px',
            }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '3px 8px',
                borderRadius: 4,
                background: 'rgba(255, 176, 0, 0.18)',
                color: 'var(--fw-time-chip-label)',
                fontFamily: "'VT323', 'JetBrains Mono', monospace",
                fontSize: 13,
                letterSpacing: '0.04em',
                lineHeight: 1,
              }}>
                Just now
              </span>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 8px',
                borderRadius: 4,
                background: 'rgba(232, 133, 61, 0.15)',
                color: 'var(--fw-location-chip-label)',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                lineHeight: 1,
                maxWidth: 180,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {pathDisplay}
                </span>
              </span>
            </div>

            {/* Textarea */}
            <div style={{ padding: '0 14px 4px' }}>
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
                placeholder="Leave your comment…"
                rows={3}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--fw-foreground)',
                  fontSize: 14,
                  fontFamily: 'inherit',
                  lineHeight: 1.5,
                  resize: 'none',
                  padding: 0,
                }}
              />
            </div>

            {target.anchor && (
              <TextRangeQuote
                text={target.anchor.selectedText}
                style={{ margin: '0 14px 8px' }}
              />
            )}

            {/* Screenshot capture status */}
            {screenshotStatus !== 'idle' && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                margin: '0 14px 6px',
                background: 'var(--fw-contrast-03)',
                border: '1px solid var(--fw-contrast-06)',
                borderRadius: 8,
              }}>
                {imagePreviewUrl ? (
                  <img
                    src={imagePreviewUrl}
                    alt="captured viewport"
                    style={{ height: 36, width: 56, objectFit: 'cover', borderRadius: 4, flexShrink: 0, border: '1px solid var(--fw-contrast-08)' }}
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    style={{ height: 36, width: 56, borderRadius: 4, flexShrink: 0, border: '1px solid var(--fw-contrast-08)', background: 'var(--fw-contrast-04)' }}
                  />
                )}
                <span style={{ fontSize: 12, color: 'var(--fw-foreground-muted)', flex: 1, fontFamily: 'inherit' }}>
                  {screenshotStatus === 'capturing'
                    ? 'Capturing screenshot…'
                    : screenshotStatus === 'failed'
                      ? 'Screenshot unavailable'
                      : 'Screenshot'}
                </span>
                {screenshotStatus === 'ready' ? (
                  <button
                    onClick={() => clearImage()}
                    aria-label="Remove screenshot"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fw-foreground-faint)', padding: 2, display: 'flex', flexShrink: 0, borderRadius: 4 }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--fw-foreground)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--fw-foreground-faint)')}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                ) : screenshotStatus === 'failed' ? (
                  <button
                    onClick={() => captureImage()}
                    aria-label="Retry screenshot"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fw-foreground-muted)', padding: 2, fontSize: 12, fontWeight: 500, fontFamily: 'inherit' }}
                  >
                    Retry
                  </button>
                ) : null}
              </div>
            )}

            {/* Footer toolbar: avatar + cancel + send */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 10px 10px',
              borderTop: '1px solid var(--fw-contrast-06)',
              marginTop: 4,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                {authorName && (
                  <button
                    title={`Signed in as ${authorName}`}
                    onClick={openNameEditor}
                    style={{
                      width: 28, height: 28,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: personalComments ? 'var(--fw-surface-raised)' : avatarColor(authorName),
                      border: 'none', borderRadius: '50%',
                      cursor: 'pointer', flexShrink: 0,
                      color: personalComments ? 'var(--fw-foreground)' : '#FFFFFF', fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                  >
                    {avatarInitial}
                  </button>
                )}
                <SpeechInputButton
                  value={comment}
                  onChange={setComment}
                  stopSignal={speechStopSignal}
                  disabled={sending}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={() => {
                    clearNativeSelection()
                    setTarget(null)
                    setComment('')
                    clearImage()
                    setSending(false)
                    setMode('selecting')
                  }}
                  style={{
                    height: 30,
                    padding: '0 12px',
                    borderRadius: 9999,
                    background: 'transparent',
                    border: '1px solid var(--fw-contrast-08)',
                    color: 'var(--fw-foreground-muted)',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'background 150ms ease, color 150ms ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--fw-contrast-04)'; e.currentTarget.style.color = 'var(--fw-foreground)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fw-foreground-muted)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSend}
                  disabled={sendDisabled}
                  aria-label="Send"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    height: 30,
                    padding: '0 14px',
                    borderRadius: 9999,
                    border: '1px solid ' + (sendDisabled ? 'var(--fw-contrast-06)' : '#B85F1F'),
                    background: sendDisabled ? 'var(--fw-contrast-04)' : '#E8853D',
                    color: sendDisabled ? 'var(--fw-foreground-faint)' : '#FFFFFF',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: sendDisabled ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                    transition: 'background 150ms ease',
                  }}
                  /* v8 ignore next 2 */
                  onMouseEnter={sendDisabled ? undefined : (e) => { e.currentTarget.style.background = '#B85F1F' }}
                  onMouseLeave={sendDisabled ? undefined : (e) => { e.currentTarget.style.background = '#E8853D' }}
                >
                  <span>Send</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* New comment pin at clicked position */}
      {mode === 'commenting' && target && (() => {
        const { fixedX, fixedY } = pagePoint(target.x, target.y)
        return (
          <div
            {...{ [WIDGET_ATTR]: '' }}
            style={{
              position: 'fixed',
              left: fixedX,
              top: fixedY - 11,
              zIndex: 2147483646,
              pointerEvents: 'none',
              animation: 'fw-pin-drop 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
              transformOrigin: 'bottom left',
            }}
          >
            <PinMarker />
          </div>
        )
      })()}

      {/* Persisted comment pins */}
      {pinsVisible && filteredComments.map((c, i) => {
        if (!liveCommentIds.has(c.id)) return null
        const point = pagePoint(c.x, c.y)
        const pinPos = page ? { left: point.fixedX, top: point.fixedY } : getElementFixedPos(c.selector, c.x, c.y)
        if (!pinPos) return null
        const pinNumber = filteredComments.length - i
        const isSelected = selectedPin === c.id
        const isHovered = hoveredPin === c.id && !isSelected
        const isResolved = c.reviewStatus === 'accepted' || c.reviewStatus === 'rejected'
        const pinAuthor = c.authorName ?? 'User'
        return (
          <div key={c.id} {...{ [WIDGET_ATTR]: '' }}>
            {/* Pin marker */}
            <div
              data-fw-pin
              onClick={(e) => {
                e.stopPropagation()
                setSelectedPin(isSelected ? null : c.id)
              }}
              onMouseEnter={() => setHoveredPin(c.id)}
              onMouseLeave={() => setHoveredPin(null)}
              style={{
                position: 'fixed',
                left: pinPos.left,
                top: pinPos.top - 11,
                zIndex: isSelected ? 2147483646 : isHovered ? 2147483642 : 2147483640,
                cursor: 'pointer',
                transition: 'transform 0.15s, opacity 0.2s',
                transform: isSelected || isHovered ? 'scale(1.15)' : 'scale(1)',
                transformOrigin: 'bottom left',
                opacity: isResolved && !isSelected && !isHovered ? 0.4 : 1,
              }}
            >
              <PinMarker outline={isSelected} hovered={isHovered} number={pinNumber} resolved={isResolved} />
            </div>

            {/* Hover tooltip — dark CRRT glass. Flips toward whichever side has
                room so it never clips against the viewport edge. */}
            {isHovered && (() => {
              const TOOLTIP_W = 280
              const TOOLTIP_H_EST = 140
              const MARGIN = 8
              const PIN_W = 28
              const flipH = pinPos.left + TOOLTIP_W + MARGIN > window.innerWidth
              const flipV = pinPos.top - 11 - TOOLTIP_H_EST < MARGIN
              const wrapperLeft = flipH
                ? Math.max(MARGIN, pinPos.left + PIN_W - TOOLTIP_W)
                : pinPos.left
              const wrapperTop = flipV ? pinPos.top + 25 : pinPos.top - 11
              const wrapperTransform = flipV ? 'translateY(0)' : 'translateY(-100%)'
              const tailRadius = flipV
                ? (flipH ? '14px 0 14px 14px' : '0 14px 14px 14px')
                : (flipH ? '14px 14px 0 14px' : '14px 14px 14px 0')
              const tailOrigin = flipV
                ? (flipH ? '100% 0%' : '0% 0%')
                : (flipH ? '100% 100%' : '0% 100%')
              return (
              <div
                style={{
                  position: 'fixed',
                  left: wrapperLeft,
                  top: wrapperTop,
                  zIndex: 2147483643,
                  pointerEvents: 'none',
                  transform: wrapperTransform,
                }}
              >
                <div style={{
                  width: TOOLTIP_W,
                  background: 'var(--fw-surface-translucent)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  borderRadius: tailRadius,
                  padding: 14,
                  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3)',
                  border: '1px solid var(--fw-contrast-08)',
                  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                  animation: 'fw-tooltip-liquid 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
                  transformOrigin: tailOrigin,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: PIN_GRADIENT,
                    flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 12, fontWeight: 700,
                  }}>
                    {getInitials(c.authorName) ?? ''}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ marginBottom: 4, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fw-foreground)' }}>{pinAuthor}</span>
                      <span style={{ fontSize: 12, color: 'var(--fw-foreground-faint)' }}>{timeAgo(c.createdAt)}</span>
                    </div>
                    {c.anchor && (
                      <TextRangeQuote
                        text={c.anchor.selectedText}
                        style={{ fontSize: 12, marginBottom: 4, WebkitLineClamp: 2 }}
                      />
                    )}
                    <div style={{ fontSize: 13, color: 'var(--fw-foreground-soft)', lineHeight: 1.4, wordBreak: 'break-word' }}>
                      {c.body}
                    </div>
                  </div>
                </div>
              </div>
              )
            })()}

            {/* Pin detail popover */}
            {isSelected && (() => {
              const avColor = avatarColor(c.id)
              const initial = getInitials(c.authorName) ?? (c.body[0] || 'U').toUpperCase()
              const bodyMarginBottom = c.imageUrl ? 10 : 14
              return (
                <>
                  <div
                    data-fw-pin-backdrop
                    onClick={() => setSelectedPin(null)}
                    style={{ position: 'fixed', inset: 0, zIndex: 2147483645 }}
                  />
                  <div
                    style={{
                      ...pinPopoverStyle(c),
                      width: 300,
                      background: 'var(--fw-surface)',
                      border: '1px solid var(--fw-contrast-08)',
                      borderRadius: 16,
                      boxShadow: '0 12px 40px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
                      padding: 16,
                      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                      animation: 'fw-tooltip-in 0.15s ease both',
                    }}
                  >
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                        background: avColor,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontSize: 13, fontWeight: 700,
                      }}>
                        {initial}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fw-foreground)', marginBottom: 2 }}>{pinAuthor}</div>
                        <div style={{ fontSize: 12, color: 'var(--fw-foreground-faint)' }}>
                          #{pinNumber} &middot; {timeAgo(c.createdAt)}
                        </div>
                      </div>
                      <PinActionCluster
                        key={c.id}
                        reviewEnabled={!personalComments}
                        isResolved={isResolved}
                        onResolve={() => { updateStatus(c.id, 'accepted'); setSelectedPin(null) }}
                        onToggleResolve={() => { updateStatus(c.id, isResolved ? 'open' : 'accepted'); setSelectedPin(null) }}
                        onViewList={() => { setSelectedPin(null); setSidebarOpen(true) }}
                        onEdit={() => { setEditingId(c.id); setEditText(c.body) }}
                        onDelete={() => { deleteComment(c.id); setSelectedPin(null) }}
                      />
                    </div>

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
                            fontSize: 14, lineHeight: 1.5, color: 'var(--fw-foreground)',
                            border: '1px solid var(--fw-contrast-08)', borderRadius: 8,
                            padding: '8px 10px', fontFamily: 'inherit',
                            outline: 'none', resize: 'vertical', background: 'var(--fw-surface-input)',
                          }}
                          onFocus={(e) => (e.target.style.borderColor = '#E8853D')}
                          onBlur={(e) => (e.target.style.borderColor = 'var(--fw-contrast-08)')}
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 6, justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => setEditingId(null)}
                            style={{ fontSize: 12, color: 'var(--fw-foreground-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 10px', fontFamily: 'inherit' }}
                          >Cancel</button>
                          <button
                            onClick={() => saveEdit(c.id)}
                            style={{ fontSize: 12, color: '#fff', background: '#E8853D', fontWeight: 600, border: 'none', borderRadius: 6, cursor: 'pointer', padding: '4px 12px', fontFamily: 'inherit' }}
                          >Save</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {c.anchor && (
                          <TextRangeQuote
                            text={c.anchor.selectedText}
                            style={{ marginBottom: 10 }}
                          />
                        )}
                        <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--fw-foreground-soft)', marginBottom: bodyMarginBottom }}>
                          {c.body}
                        </div>
                      </>
                    )}

                    {c.imageUrl && (
                      <img
                        src={c.imageUrl}
                        alt=""
                        onClick={() => window.open(c.imageUrl!, '_blank')}
                        style={{ width: '100%', borderRadius: 8, border: '1px solid var(--fw-contrast-08)', cursor: 'zoom-in', display: 'block', marginBottom: 14 }}
                      />
                    )}
                  </div>
                </>
              )
            })()}
          </div>
        )
      })}

      {/* Sidebar overlay — only when NOT selecting/commenting, so user can click page elements to drop pins */}
      {sidebarOpen && mode === 'idle' && (
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
          background: 'var(--fw-surface-deep)',
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          boxShadow: sidebarOpen ? '-8px 0 32px rgba(0,0,0,0.5)' : 'none',
          borderLeft: '1px solid var(--fw-contrast-06)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '16px 16px 12px',
          gap: 12,
          borderBottom: '1px solid var(--fw-contrast-06)',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, lineHeight: 1.1, fontWeight: 750, color: 'var(--fw-foreground)' }}>
              {personalComments ? 'My extension comments' : 'Feedback'}
            </div>
            <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.2, color: 'var(--fw-foreground-faint)' }}>
              {visibleComments.length} comment{visibleComments.length === 1 ? '' : 's'}{!personalComments && <> · {readyForAgentCount} ready</>}
            </div>
          </div>
          <button
            onClick={() => { if (mode !== 'idle') exitFeedbackMode(); setSidebarOpen(false) }}
            aria-label="Close"
            style={{
              width: 34,
              height: 34,
              background: 'var(--fw-contrast-03)',
              border: '1px solid var(--fw-contrast-06)',
              color: 'var(--fw-foreground-muted)',
              cursor: 'pointer',
              padding: 0,
              borderRadius: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s, background 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--fw-foreground)'; e.currentTarget.style.background = 'var(--fw-contrast-04)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--fw-foreground-muted)'; e.currentTarget.style.background = 'var(--fw-contrast-03)' }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Agent CTA — visible path into agent flow, not only Shift+A. */}
        {!personalComments && <div
          style={{
            padding: '14px 16px 12px',
            borderBottom: '1px solid var(--fw-contrast-04)',
          }}
        >
          <button
            type="button"
            onClick={openAgentBridge}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '11px 12px',
              borderRadius: 10,
              border: '1px solid rgba(232, 133, 61, 0.28)',
              background: 'rgba(232, 133, 61, 0.08)',
              color: 'var(--fw-foreground)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
              transition: 'background 160ms ease, border-color 160ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(232, 133, 61, 0.13)'
              e.currentTarget.style.borderColor = 'rgba(232, 133, 61, 0.42)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(232, 133, 61, 0.08)'
              e.currentTarget.style.borderColor = 'rgba(232, 133, 61, 0.28)'
            }}
          >
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                background: '#E8853D',
                color: '#080808',
              }}
            >
              <Bot size={17} />
            </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 650, lineHeight: 1.25 }}>
                  Open agent
                </span>
                <span style={{ display: 'block', marginTop: 2, fontSize: 12, color: 'var(--fw-foreground-muted)', lineHeight: 1.35 }}>
                  {readyForAgentCount > 0
                    ? `${readyForAgentCount} ready comment${readyForAgentCount === 1 ? '' : 's'}`
                    : 'Approve comments to queue work'}
                </span>
              </span>
            <span
              style={{
                flexShrink: 0,
                padding: '3px 7px',
                borderRadius: 9999,
                border: '1px solid var(--fw-contrast-10)',
                color: 'var(--fw-foreground-muted)',
                fontSize: 11,
                lineHeight: 1,
              }}
            >
              Shift + A
            </span>
          </button>
        </div>}

        {/* Filter row */}
        {!personalComments && <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid var(--fw-contrast-04)' }}>
          <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--fw-foreground)', fontWeight: 600 }}>{sidebarTitle}</span>
            <span style={{ fontSize: 12, color: 'var(--fw-foreground-faint)' }}>{filteredComments.length}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {([
              { id: 'all', label: 'All', count: visibleComments.length },
              { id: 'open', label: 'Open', count: openCommentCount },
              { id: 'approved', label: 'Ready', count: readyForAgentCount },
            ] as const).map((item) => {
              const active = filterStatus === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilterStatus(item.id)}
                  style={{
                    height: 32,
                    borderRadius: 9999,
                    border: active ? '1px solid rgba(232, 133, 61, 0.32)' : '1px solid var(--fw-contrast-06)',
                    background: active ? 'rgba(232, 133, 61, 0.13)' : 'var(--fw-contrast-03)',
                    color: active ? 'var(--fw-active-label)' : 'var(--fw-foreground-muted)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 12,
                    fontWeight: 650,
                  }}
                >
                  {item.label} <span style={{ color: active ? 'var(--fw-active-label-soft)' : 'var(--fw-foreground-faint)', fontWeight: 500 }}>{item.count}</span>
                </button>
              )
            })}
          </div>
        </div>}

        {/* Comment list */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {sortedComments.length === 0 && (
            <div style={{ color: 'var(--fw-empty-state)', fontSize: 13, textAlign: 'center', marginTop: 40, padding: '0 24px', lineHeight: 1.5 }}>
              {visibleComments.length === 0
                ? 'No comments yet'
                : filterStatus === 'approved'
                  ? 'Approve comments to queue them here'
                  : 'No comments match this filter'}
            </div>
          )}
          {sortedComments.map((c, i) => {
              const pinNum = filteredComments.length - filteredComments.indexOf(c)
              const isResolved = c.reviewStatus === 'accepted' || c.reviewStatus === 'rejected'
              const isPending = !c.reviewStatus || c.reviewStatus === 'open'
              const isEditing = editingId === c.id
              const initial = getInitials(c.authorName) ?? (c.body[0] || 'U').toUpperCase()
              const isMenuOpen = menuOpenId === c.id
              return (
                <div
                  key={c.id}
                  className="fw-sidebar-card"
                  onClick={() => { if (!isEditing && !isMenuOpen) { setSelectedPin(c.id); highlightElement(c.selector) } }}
                  style={{
                    padding: '14px 16px',
                    cursor: isEditing ? 'default' : 'pointer',
                    position: 'relative',
                    zIndex: isMenuOpen ? 100000 : 'auto',
                    borderBottom: '1px solid var(--fw-contrast-04)',
                    opacity: isResolved ? 0.55 : 1,
                    transition: 'background 0.1s, opacity 0.2s',
                    animation: sidebarOpen ? `fw-slide-in 0.2s ease ${i * 0.04}s both` : 'none',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--fw-contrast-02)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  {/* Top row: avatar + name + meta + actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    {/* Avatar */}
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                      background: isResolved ? '#2C2C2C' : avatarColor(c.authorName ?? c.id),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#FFFFFF', fontSize: 11, fontWeight: 700,
                      fontFamily: 'inherit',
                    }}>
                      {initial}
                    </div>
                    {/* Name + meta inline */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fw-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.authorName ?? 'User'}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--fw-foreground-faint)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                        {timeAgo(c.createdAt)} <span style={{ color: 'var(--fw-surface-divider-strong)' }}>·</span> <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>#{pinNum}</span>
                      </span>
                    </div>
                    {/* Actions inline — same row as the author */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      {!personalComments && isPending && (
                        <button
                          onClick={(e) => { e.stopPropagation(); updateStatus(c.id, 'accepted') }}
                          title="Approve"
                          aria-label="Approve"
                          style={{
                            width: 28, height: 28, borderRadius: 7,
                            border: '1px solid rgba(232, 133, 61, 0.35)',
                            background: 'rgba(232, 133, 61, 0.08)',
                            cursor: 'pointer', display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            color: '#E8853D', padding: 0,
                            transition: 'background 150ms ease, color 150ms ease, border-color 150ms ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#E8853D'
                            e.currentTarget.style.color = '#FFFFFF'
                            e.currentTarget.style.borderColor = '#B85F1F'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(232, 133, 61, 0.08)'
                            e.currentTarget.style.color = '#E8853D'
                            e.currentTarget.style.borderColor = 'rgba(232, 133, 61, 0.35)'
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuOpenId(isMenuOpen ? null : c.id) }}
                        title="More"
                        aria-label="More"
                        style={{
                          width: 28, height: 28, borderRadius: 7,
                          border: '1px solid ' + (isMenuOpen ? 'var(--fw-contrast-14)' : 'var(--fw-contrast-08)'),
                          background: isMenuOpen ? 'var(--fw-contrast-06)' : 'transparent',
                          cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: 'var(--fw-foreground-muted)', padding: 0,
                          transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease',
                        }}
                        onMouseEnter={(e) => { if (!isMenuOpen) { e.currentTarget.style.background = 'var(--fw-contrast-06)'; e.currentTarget.style.color = 'var(--fw-foreground)' } }}
                        onMouseLeave={(e) => { if (!isMenuOpen) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fw-foreground-muted)' } }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
                      </button>
                    </div>
                  </div>

                  {/* Body */}
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
                          fontSize: 14, lineHeight: 1.5, color: 'var(--fw-foreground)',
                          border: '1px solid var(--fw-contrast-08)', borderRadius: 6,
                          padding: '8px 10px', fontFamily: 'inherit',
                          outline: 'none', resize: 'none', background: 'var(--fw-surface)',
                        }}
                        onFocus={(e) => (e.target.style.borderColor = '#E8853D')}
                        onBlur={(e) => (e.target.style.borderColor = 'var(--fw-contrast-08)')}
                      />
                      <div style={{ display: 'flex', gap: 8, marginTop: 6, justifyContent: 'flex-end' }}>
                        <button onClick={() => setEditingId(null)} style={{ fontSize: 12, color: 'var(--fw-foreground-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 10px', fontFamily: 'inherit' }}>Cancel</button>
                        <button onClick={() => saveEdit(c.id)} style={{ fontSize: 12, color: '#FFFFFF', fontWeight: 600, background: '#E8853D', border: 'none', borderRadius: 6, cursor: 'pointer', padding: '4px 12px', fontFamily: 'inherit' }}>Save</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {c.anchor && (
                        <TextRangeQuote
                          text={c.anchor.selectedText}
                          style={{ marginLeft: 32, marginBottom: 6 }}
                        />
                      )}
                      <div
                        style={{
                          fontSize: 13.5,
                          lineHeight: 1.5,
                          color: isResolved ? 'var(--fw-foreground-faint)' : 'var(--fw-foreground-soft)',
                          marginLeft: 32,
                          wordBreak: 'break-word',
                        }}
                      >
                        {c.body}
                      </div>
                      {c.imageUrl && (
                        <img
                          src={c.imageUrl}
                          alt=""
                          onClick={(e) => { e.stopPropagation(); window.open(c.imageUrl!, '_blank') }}
                          style={{
                            marginTop: 8,
                            marginLeft: 32,
                            maxWidth: 'calc(100% - 32px)',
                            borderRadius: 6,
                            border: '1px solid var(--fw-contrast-06)',
                            cursor: 'zoom-in',
                            display: 'block',
                            filter: isResolved ? 'grayscale(0.7) brightness(0.5)' : 'none',
                          }}
                        />
                      )}
                    </>
                  )}

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
                        background: 'var(--fw-surface-raised)', border: '1px solid var(--fw-surface-divider)', borderRadius: 8,
                        padding: '4px 0', minWidth: 160,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                        animation: 'fw-tooltip-in 0.1s ease both',
                      }}
                    >
                      {!personalComments && <button
                        onClick={() => { updateStatus(c.id, c.reviewStatus === 'accepted' ? 'open' : 'accepted'); setMenuOpenId(null) }}
                        style={{ width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: 'var(--fw-foreground-subtle)', fontSize: 12, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--fw-surface-hover)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                        {c.reviewStatus === 'accepted' ? 'Reopen' : 'Approve'}
                      </button>}
                      <button
                        onClick={() => { setEditingId(c.id); setEditText(c.body); setMenuOpenId(null) }}
                        style={{ width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: 'var(--fw-foreground-subtle)', fontSize: 12, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--fw-surface-hover)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        Edit
                      </button>
                      <div style={{ height: 1, background: 'var(--fw-surface-divider)', margin: '4px 0' }} />
                      <button
                        onClick={() => { deleteComment(c.id); setMenuOpenId(null) }}
                        style={{ width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: '#ef4444', fontSize: 12, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--fw-surface-hover)')}
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
      </div>

      {/* CRRT trigger — Paper B option. Stays visible while feedback mode is active. */}
      <div
        {...{ [WIDGET_ATTR]: '', 'data-fw-launcher-root': '' }}
        onMouseEnter={onPillEnter}
        onMouseLeave={onPillLeave}
        onFocus={() => setLauncherFocused(true)}
        onBlur={() => setLauncherFocused(false)}
        style={{
          position: 'fixed',
          right: 24,
          top: '50%',
          zIndex: 2147483647,
          width: 44,
          height: 44,
          userSelect: 'none',
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          opacity: sidebarOpen ? 0 : 1,
          transform: sidebarOpen ? 'translateY(calc(-50% + 8px))' : 'translateY(-50%)',
          pointerEvents: sidebarOpen ? 'none' : 'auto',
          transition: 'opacity 200ms cubic-bezier(0.16, 1, 0.3, 1), transform 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', lineHeight: 0 }}>
          {hideWidget && (
            <button
              type="button"
              aria-label="Hide CRRT on this tab"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                hideWidget()
              }}
              style={{
                position: 'absolute',
                top: -7,
                left: -7,
                zIndex: 2,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 20,
                height: 20,
                padding: 0,
                borderRadius: 9999,
                border: '1px solid rgba(255, 255, 255, 0.14)',
                background: '#171717',
                color: 'rgba(255, 255, 255, 0.78)',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.28)',
                cursor: 'pointer',
                opacity: pillHover || launcherFocused ? 1 : 0,
                pointerEvents: pillHover || launcherFocused ? 'auto' : 'none',
                transform: pillHover || launcherFocused ? 'scale(1)' : 'scale(0.86)',
                transition: 'opacity 140ms ease, transform 140ms ease, color 140ms ease',
              }}
              onMouseEnter={(event) => { event.currentTarget.style.color = '#FFFFFF' }}
              onMouseLeave={(event) => { event.currentTarget.style.color = 'rgba(255, 255, 255, 0.78)' }}
            >
              <X size={11} strokeWidth={2.25} aria-hidden="true" />
            </button>
          )}
          <div
            data-fw-launcher-menu
            id="crrt-launcher-menu"
            role="menu"
            aria-hidden={!launcherOpen}
            aria-label="CRRT actions"
            style={{
              position: 'absolute',
              right: 54,
              top: '50%',
              width: 282,
              padding: 8,
              borderRadius: 16,
              lineHeight: 1.2,
              background: 'var(--fw-menu-translucent)',
              border: '1px solid var(--fw-contrast-10)',
              boxShadow: '0 18px 54px rgba(0, 0, 0, 0.42), inset 0 1px 0 var(--fw-contrast-04)',
              backdropFilter: 'blur(18px)',
              WebkitBackdropFilter: 'blur(18px)',
              opacity: launcherOpen ? 1 : 0,
              transform: launcherOpen ? 'translateY(-50%) translateX(0) scale(1)' : 'translateY(-50%) translateX(8px) scale(0.98)',
              transformOrigin: 'right center',
              pointerEvents: launcherOpen ? 'auto' : 'none',
              transition: 'opacity 160ms ease, transform 180ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <LauncherAction
              icon={<MessageCircle size={17} />}
              title="Drop comment"
              subtitle="Pin feedback on the page"
              shortcut="C"
              onClick={() => {
                setLauncherOpen(false)
                enterFeedbackMode()
              }}
            />
            <LauncherAction
              icon={<PanelRightOpen size={17} />}
              title="Open sidebar"
              subtitle="Review active comments"
              shortcut="F"
              onClick={() => {
                setLauncherOpen(false)
                setSidebarOpen(true)
              }}
            />
            {!personalComments && <LauncherAction
              icon={<Bot size={17} />}
              title="Open agent"
              subtitle="Send context to agent"
              shortcut="Shift + A"
              onClick={() => {
                setLauncherOpen(false)
                openAgentBridge()
              }}
            />}
          </div>

          {/* Primary launcher — click toggles menu; active state uses Paper orange border. */}
          <button
            type="button"
            aria-expanded={launcherOpen}
            aria-haspopup="menu"
            aria-controls="crrt-launcher-menu"
            aria-label={launcherOpen ? 'Close CRRT menu' : 'Open CRRT menu'}
            onClick={async () => {
              if (mode !== 'idle') return
              try {
                if (personalComments?.beforeOpen && !await personalComments.beforeOpen()) return
                setLauncherOpen((value) => !value)
              } catch (error) {
                setApiError(error instanceof Error ? error.message : 'Could not open CRRT')
              }
            }}
            style={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              boxSizing: 'border-box',
              padding: 0,
              borderRadius: 9999,
              background: '#030303',
              border: '1px solid ' + (launcherActive ? 'rgba(228, 110, 57, 0.72)' : 'rgba(255, 255, 255, 0.10)'),
              color: '#FFFFFF',
              lineHeight: 0,
              cursor: 'pointer',
              fontFamily: 'inherit',
              boxShadow: launcherActive
                ? '0 0 0 3px rgba(232, 133, 61, 0.08), 0 10px 24px rgba(232, 133, 61, 0.10)'
                : 'none',
              transition: 'border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease',
              transform: pillHover && !launcherOpen ? 'translateY(-1px) scale(1.02)' : 'translateY(0) scale(1)',
              animation: launcherBump ? 'fw-widget-receive 650ms cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
              overflow: 'hidden',
            }}
          >
            <CarrotPixelIcon size={36} />
          </button>
          {commentCount > 0 && (
            <span
              aria-hidden
              style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 10,
                height: 10,
                borderRadius: 9999,
                border: '1.5px solid rgba(10, 10, 10, 0.95)',
                background: '#E8853D',
                animation: badgeAnimation,
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      </div>

      {/* Agent bridge modal */}
      {agentOpen && !agentGateOpen && (
        <AgentBridgeModal
          apiBase={apiBase}
          projectId={projectId}
          onClose={() => setAgentOpen(false)}
          onBeforeCopy={ensureAgentAccess}
        />
      )}
      {agentGateOpen && (
        <AgentAuthGate
          readyCount={readyForAgentCount}
          signUpUrl={signUpUrl}
          loginUrl={loginUrl}
          onClose={() => setAgentGateOpen(false)}
        />
      )}

      <FeedbackWidgetStyles />

      {showNameModal && (
        <NameModal
          value={nameInput}
          onChange={setNameInput}
          onSubmit={handleNameSubmit}
          onCancel={handleNameCancel}
          existingName={authorNameRef.current}
        />
      )}
    </div>
  )
}

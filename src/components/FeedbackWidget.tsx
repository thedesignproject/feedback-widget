import { useCallback, useEffect, useRef, useState } from 'react'
import { getSelector } from '../lib/getSelector'

interface FeedbackWidgetProps {
  projectId: string
  apiBase: string
  projectKey?: string
}

type Mode = 'idle' | 'selecting' | 'commenting' | 'submitted'

interface ClickTarget {
  selector: string
  x: number
  y: number
  url: string
}

const WIDGET_ATTR = 'data-fw'

async function submitComment(apiBase: string, projectKey: string, target: ClickTarget, body: string) {
  const publicPayload = {
    projectKey,
    pageUrl: target.url,
    x: target.x,
    y: target.y,
    selector: target.selector,
    body,
  }

  const publicRes = await fetch(`${apiBase}/v1/public/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(publicPayload),
  })

  if (publicRes.status !== 404 && publicRes.status !== 405) {
    return publicRes
  }

  return fetch(`${apiBase}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: projectKey,
      url: target.url,
      x: target.x,
      y: target.y,
      element: target.selector,
      comment: body,
    }),
  })
}

export function FeedbackWidget({ projectId, projectKey, apiBase }: FeedbackWidgetProps) {
  const resolvedProjectKey = projectKey || projectId
  const [mode, setMode] = useState<Mode>('idle')
  const [target, setTarget] = useState<ClickTarget | null>(null)
  const [comment, setComment] = useState('')
  const [hovered, setHovered] = useState<HTMLElement | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sendingRef = useRef(false)

  const exitToIdle = useCallback(() => {
    setMode('idle')
    setTarget(null)
    setComment('')
    setHovered(null)
    setError(null)
    setSending(false)
    sendingRef.current = false
  }, [])

  useEffect(() => {
    if (mode !== 'selecting') {
      setHovered(null)
      return
    }

    const previousCursor = document.body.style.cursor
    document.body.style.cursor = 'crosshair'

    function onMove(event: MouseEvent) {
      const node = event.target as HTMLElement | null
      if (node && !node.closest?.(`[${WIDGET_ATTR}]`)) {
        setHovered(node)
      } else {
        setHovered(null)
      }
    }

    window.addEventListener('mousemove', onMove)
    return () => {
      document.body.style.cursor = previousCursor
      window.removeEventListener('mousemove', onMove)
    }
  }, [mode])

  useEffect(() => {
    if (!hovered) return
    const previousOutline = hovered.style.outline
    const previousOffset = hovered.style.outlineOffset
    hovered.style.outline = '2px solid rgba(59, 130, 246, 0.7)'
    hovered.style.outlineOffset = '2px'

    return () => {
      hovered.style.outline = previousOutline
      hovered.style.outlineOffset = previousOffset
    }
  }, [hovered])

  useEffect(() => {
    if (mode !== 'selecting') return

    function onClick(event: MouseEvent) {
      const node = event.target as HTMLElement | null
      if (!node || node.closest?.(`[${WIDGET_ATTR}]`)) return

      event.preventDefault()
      event.stopPropagation()

      setError(null)
      setTarget({
        selector: getSelector(node),
        x: event.pageX,
        y: event.pageY,
        url: window.location.href,
      })
      setMode('commenting')
    }

    window.addEventListener('click', onClick, true)
    return () => window.removeEventListener('click', onClick, true)
  }, [mode])

  useEffect(() => {
    if (mode === 'commenting') {
      textareaRef.current?.focus()
    }
  }, [mode])

  useEffect(() => {
    if (mode !== 'submitted') return
    const timer = window.setTimeout(() => {
      setMode('idle')
      setSuccessMessage(null)
      setTarget(null)
      setComment('')
    }, 1800)

    return () => window.clearTimeout(timer)
  }, [mode])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement | null)?.tagName
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

      if (event.key === 'Escape') {
        if (mode === 'commenting') {
          setMode('selecting')
          setComment('')
          setError(null)
          setTarget(null)
          return
        }

        if (mode === 'selecting' || mode === 'submitted') {
          exitToIdle()
        }
      }

      if (isTyping) return

      if (event.key === 'c' || event.key === 'C') {
        setMode((current) => current === 'idle' ? 'selecting' : 'idle')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [exitToIdle, mode])

  const handleSend = useCallback(async () => {
    if (!target || !comment.trim() || sendingRef.current) return

    sendingRef.current = true
    setSending(true)
    setError(null)

    try {
      const response = await submitComment(apiBase, resolvedProjectKey, target, comment.trim())
      if (!response.ok) {
        setError(`Could not send feedback (${response.status})`)
        return
      }

      setMode('submitted')
      setSuccessMessage('Feedback sent')
      setComment('')
      setTarget(null)
      setHovered(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send feedback')
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }, [apiBase, comment, resolvedProjectKey, target])

  const popoverStyle = (): React.CSSProperties => {
    if (!target) return { display: 'none' }
    const width = 320
    const height = 220
    const padding = 16
    const fixedX = target.x - window.scrollX
    const fixedY = target.y - window.scrollY

    let left = fixedX + padding
    let top = fixedY + padding

    if (left + width > window.innerWidth - padding) left = fixedX - width - padding
    if (top + height > window.innerHeight - padding) top = fixedY - height - padding
    if (left < padding) left = padding
    if (top < padding) top = padding

    return {
      position: 'fixed',
      left,
      top,
      width,
      zIndex: 2147483647,
    }
  }

  return (
    <div {...{ [WIDGET_ATTR]: '' }}>
      {mode === 'selecting' && (
        <div
          {...{ [WIDGET_ATTR]: '' }}
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 2147483644,
            background: 'rgba(255,255,255,0.02)',
          }}
        />
      )}

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
            padding: '10px 14px',
            borderRadius: 9999,
            background: '#ffffff',
            color: '#111827',
            border: '1px solid rgba(17,24,39,0.08)',
            boxShadow: '0 12px 30px rgba(15, 23, 42, 0.12)',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 13,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2563eb' }} />
          <span style={{ fontWeight: 600 }}>Click any element to leave feedback</span>
          <button
            type="button"
            onClick={exitToIdle}
            style={{
              border: '1px solid rgba(17,24,39,0.12)',
              background: '#f8fafc',
              color: '#475569',
              borderRadius: 9999,
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {mode === 'commenting' && target && (
        <>
          <div
            {...{ [WIDGET_ATTR]: '' }}
            onClick={() => {
              setMode('selecting')
              setComment('')
              setError(null)
              setTarget(null)
            }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 2147483645,
              background: 'rgba(15, 23, 42, 0.08)',
            }}
          />
          <div
            {...{ [WIDGET_ATTR]: '' }}
            style={{
              ...popoverStyle(),
              background: '#0f172a',
              color: '#e2e8f0',
              borderRadius: 18,
              padding: 16,
              boxShadow: '0 24px 60px rgba(15, 23, 42, 0.4)',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>Leave feedback</div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>{target.selector}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMode('selecting')
                  setComment('')
                  setError(null)
                  setTarget(null)
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Esc
              </button>
            </div>

            <textarea
              ref={textareaRef}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  handleSend()
                }
              }}
              placeholder="What would you change?"
              rows={4}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                resize: 'none',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                background: 'rgba(15, 23, 42, 0.4)',
                borderRadius: 14,
                color: '#f8fafc',
                padding: 12,
                outline: 'none',
                font: 'inherit',
                marginBottom: 12,
              }}
            />

            {error && (
              <div style={{ marginBottom: 12, fontSize: 12, color: '#fca5a5' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>Cmd/Ctrl + Enter to send</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    setMode('selecting')
                    setComment('')
                    setError(null)
                    setTarget(null)
                  }}
                  style={{
                    border: '1px solid rgba(148, 163, 184, 0.24)',
                    background: 'transparent',
                    color: '#cbd5e1',
                    borderRadius: 9999,
                    padding: '8px 14px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!comment.trim() || sending}
                  aria-label="Send"
                  style={{
                    border: 'none',
                    background: !comment.trim() || sending ? '#334155' : '#2563eb',
                    color: '#ffffff',
                    borderRadius: 9999,
                    padding: '8px 16px',
                    cursor: !comment.trim() || sending ? 'default' : 'pointer',
                    fontWeight: 700,
                  }}
                >
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {mode === 'submitted' && successMessage && (
        <div
          {...{ [WIDGET_ATTR]: '' }}
          style={{
            position: 'fixed',
            bottom: 84,
            right: 24,
            zIndex: 2147483647,
            padding: '12px 14px',
            borderRadius: 16,
            background: '#111827',
            color: '#ecfeff',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            boxShadow: '0 16px 40px rgba(15, 23, 42, 0.24)',
          }}
        >
          {successMessage}
        </div>
      )}

      <button
        type="button"
        {...{ [WIDGET_ATTR]: '' }}
        onClick={() => {
          if (mode === 'selecting') {
            exitToIdle()
            return
          }

          setError(null)
          setSuccessMessage(null)
          setMode('selecting')
        }}
        style={{
          position: 'fixed',
          right: 24,
          bottom: 24,
          zIndex: 2147483647,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          border: 'none',
          borderRadius: 9999,
          padding: '12px 18px',
          background: mode === 'selecting' ? '#0f172a' : '#111827',
          color: '#ffffff',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: 14,
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 18px 40px rgba(15, 23, 42, 0.22)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.12)',
            fontSize: 12,
          }}
        >
          {mode === 'selecting' ? '×' : '+'}
        </span>
        {mode === 'selecting' ? 'Cancel feedback' : 'Feedback'}
      </button>
    </div>
  )
}


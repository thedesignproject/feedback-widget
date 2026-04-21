import { useCallback, useEffect, useMemo, useState } from 'react'

type Target = 'claude-code' | 'codex' | 'generic'

interface PromptResponse {
  slug: string
  target: string
  prompt: string
  docUrl: string
}

interface StateResponse {
  share: { slug: string; scopeType: 'page' | 'selection' | 'project'; revision: number }
  project: { publicKey: string; name: string; repoUrl: string | null }
  comments: Array<{
    id: string
    pageUrl: string
    selector: string
    body: string
    reviewStatus: 'open' | 'accepted' | 'rejected'
    implementationStatus: 'unassigned' | 'claimed' | 'in_progress' | 'blocked' | 'done'
    claimedByAgentId: string | null
    createdAt: string
  }>
  presence: Array<{
    agentId: string
    status: string
    summary: string | null
    lastSeenAt: string
  }>
}

const TARGETS: Array<{ id: Target; label: string; hint: string }> = [
  { id: 'claude-code', label: 'Claude Code', hint: 'Anthropic Claude Code CLI' },
  { id: 'codex', label: 'Codex', hint: 'OpenAI Codex CLI' },
  { id: 'generic', label: 'Generic', hint: 'Any agent with a prompt box' },
]

const WIDGET_ATTR = 'data-fw'
const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif'
const mono = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

function readShareFromUrl() {
  const search = new URLSearchParams(window.location.search)
  return {
    slug: search.get('fw_share') ?? '',
    token: search.get('token') ?? '',
  }
}

interface AgentBridgeModalProps {
  apiBase: string
  onClose: () => void
}

export function AgentBridgeModal({ apiBase, onClose }: AgentBridgeModalProps) {
  const { slug, token } = useMemo(readShareFromUrl, [])
  const hasShare = Boolean(slug && token)

  const [prompts, setPrompts] = useState<Record<Target, string>>({ 'claude-code': '', 'codex': '', 'generic': '' })
  const [state, setState] = useState<StateResponse | null>(null)
  const [copied, setCopied] = useState<Target | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!hasShare) return

    async function load() {
      try {
        const promptEntries = await Promise.all(
          TARGETS.map(async ({ id }) => {
            const res = await fetch(`${apiBase}/v1/shares/${slug}/prompt?token=${encodeURIComponent(token)}&target=${id}`)
            if (!res.ok) throw new Error(`Prompt fetch failed (${res.status})`)
            const body = (await res.json()) as PromptResponse
            return [id, body.prompt] as const
          }),
        )
        setPrompts(Object.fromEntries(promptEntries) as Record<Target, string>)

        const stateRes = await fetch(`${apiBase}/v1/agent/shares/${slug}/state?token=${encodeURIComponent(token)}`)
        if (stateRes.ok) setState((await stateRes.json()) as StateResponse)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load session.')
      }
    }

    load()
  }, [apiBase, hasShare, slug, token])

  const handleCopy = useCallback(async (target: Target) => {
    const text = prompts[target]
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(target)
      window.setTimeout(() => setCopied((current) => (current === target ? null : current)), 1600)
    } catch {
      setError('Copy failed — select the prompt manually and copy.')
    }
  }, [prompts])

  const acceptedComments = state?.comments.filter((c) => c.reviewStatus === 'accepted') ?? []
  const openCount = state?.comments.filter((c) => c.reviewStatus === 'open').length ?? 0

  return (
    <div {...{ [WIDGET_ATTR]: '' }} style={{ fontFamily: font, color: '#111' }}>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 2147483646,
          background: 'rgba(15, 23, 42, 0.5)',
          backdropFilter: 'blur(4px)',
          animation: 'fw-agent-fade 0.15s ease both',
        }}
      />
      <div
        role="dialog"
        aria-label="Connect agent"
        style={{
          position: 'fixed',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 2147483647,
          width: 'min(560px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 48px)',
          display: 'flex', flexDirection: 'column',
          background: '#fff',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(15, 23, 42, 0.25), 0 2px 8px rgba(15, 23, 42, 0.08)',
          animation: 'fw-agent-pop 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.2) both',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '18px 20px', borderBottom: '1px solid #eee' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>
              {state?.project.name ?? 'Connect an agent'}
            </div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
              Paste one of these prompts into your agent — it joins this session and starts on accepted feedback.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              marginLeft: 'auto', width: 32, height: 32, borderRadius: 8,
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; e.currentTarget.style.color = '#111' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#888' }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto' }}>
          {!hasShare ? (
            <EmptyState />
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20 }}>
                {TARGETS.map(({ id, label, hint }) => {
                  const ready = Boolean(prompts[id])
                  const justCopied = copied === id
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handleCopy(id)}
                      disabled={!ready}
                      style={{
                        textAlign: 'left',
                        padding: '12px 14px',
                        background: justCopied ? '#0f172a' : '#fff',
                        color: justCopied ? '#f8fafc' : '#111',
                        border: `1px solid ${justCopied ? '#0f172a' : '#e5e5e5'}`,
                        borderRadius: 10,
                        cursor: ready ? 'pointer' : 'default',
                        opacity: ready ? 1 : 0.55,
                        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
                        fontFamily: font,
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>
                        {justCopied ? 'Copied ✓' : `Copy ${label}`}
                      </div>
                      <div style={{ fontSize: 11, color: justCopied ? '#94a3b8' : '#888' }}>{hint}</div>
                    </button>
                  )
                })}
              </div>

              {error && (
                <div style={{ marginBottom: 16, padding: 10, borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 12 }}>
                  {error}
                </div>
              )}

              {state && state.presence.length > 0 && (
                <Section label="Live agents">
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {state.presence.map((p) => (
                      <div key={p.agentId} style={{ padding: '6px 10px', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}>
                        <span style={{ fontWeight: 700 }}>{p.agentId}</span>
                        <span style={{ color: '#888', marginLeft: 6 }}>{p.status}</span>
                        {p.summary && <span style={{ color: '#555', marginLeft: 6 }}>· {p.summary}</span>}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              <Section label={`Accepted feedback (${acceptedComments.length})`}>
                {acceptedComments.length === 0 ? (
                  <div style={{ background: '#fafafa', border: '1px dashed #ddd', borderRadius: 10, padding: 16, textAlign: 'center', color: '#888', fontSize: 13 }}>
                    No accepted comments yet. They'll show up here the moment a reviewer accepts one.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {acceptedComments.map((comment) => (
                      <div key={comment.id} style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, padding: 12 }}>
                        <div style={{ display: 'flex', gap: 10 }}>
                          <StatusPill status={comment.implementationStatus} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: '#111', lineHeight: 1.5, marginBottom: 4 }}>{comment.body}</div>
                            <div style={{ fontSize: 11, color: '#aaa', fontFamily: mono, wordBreak: 'break-all' }}>
                              {comment.pageUrl} · {comment.selector}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {openCount > 0 && (
                <div style={{ marginTop: 12, fontSize: 12, color: '#aaa' }}>
                  {openCount} more comment{openCount === 1 ? '' : 's'} waiting on review.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fw-agent-fade { 0% { opacity: 0; } 100% { opacity: 1; } }
        @keyframes fw-agent-pop {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.96); }
          100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function EmptyState() {
  return (
    <div style={{ textAlign: 'center', padding: '12px 4px 8px' }}>
      <div style={{
        width: 48, height: 48, borderRadius: 12, margin: '0 auto 14px',
        background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <circle cx="12" cy="5" r="2" />
          <path d="M12 7v4" />
          <line x1="8" y1="16" x2="8" y2="16" />
          <line x1="16" y1="16" x2="16" y2="16" />
        </svg>
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>No active session</div>
      <p style={{ fontSize: 13, color: '#666', lineHeight: 1.55, maxWidth: 380, margin: '0 auto' }}>
        To bring an agent into this page, create a share from the reviewer dashboard and open this page with the
        resulting link. The "Copy prompt" buttons will appear here.
      </p>
      <div style={{ marginTop: 14, fontSize: 11, color: '#999', fontFamily: mono }}>
        ?fw_share=&lt;slug&gt;&amp;token=&lt;token&gt;
      </div>
    </div>
  )
}

const STATUS_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  unassigned: { bg: '#f3f4f6', fg: '#6b7280', label: 'Open' },
  claimed: { bg: '#fef3c7', fg: '#92400e', label: 'Claimed' },
  in_progress: { bg: '#dbeafe', fg: '#1e40af', label: 'In progress' },
  blocked: { bg: '#fee2e2', fg: '#b91c1c', label: 'Blocked' },
  done: { bg: '#dcfce7', fg: '#166534', label: 'Done' },
}

function StatusPill({ status }: { status: string }) {
  const style = STATUS_COLORS[status] ?? STATUS_COLORS.unassigned
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 9999,
      background: style.bg, color: style.fg, fontSize: 10, fontWeight: 600,
      whiteSpace: 'nowrap', flexShrink: 0, marginTop: 1,
    }}>
      {style.label}
    </span>
  )
}

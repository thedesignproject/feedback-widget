import { useCallback, useEffect, useMemo, useState } from 'react'

type Target = 'codex' | 'claude-code' | 'generic'

interface PromptResponse {
  slug: string
  target: string
  prompt: string
  docUrl: string
}

interface StateResponse {
  share: {
    id: string
    slug: string
    scopeType: 'page' | 'selection' | 'project'
    scopePageUrl: string | null
    expiresAt: string
    revision: number
  }
  project: {
    publicKey: string
    name: string
    repoUrl: string | null
  }
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

const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif'
const mono = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

const TARGETS: Array<{ id: Target; label: string; hint: string }> = [
  { id: 'claude-code', label: 'Claude Code', hint: 'For Anthropic Claude Code CLI' },
  { id: 'codex', label: 'Codex', hint: 'For OpenAI Codex CLI' },
  { id: 'generic', label: 'Generic', hint: 'For any other agent with a prompt box' },
]

function readTokenFromQuery(): string {
  const search = new URLSearchParams(window.location.search)
  return search.get('token') || ''
}

function readSlugFromPath(): string {
  const match = window.location.pathname.match(/^\/d\/([^/?#]+)/)
  return match ? match[1] : ''
}

export function DocView() {
  const slug = useMemo(readSlugFromPath, [])
  const token = useMemo(readTokenFromQuery, [])
  const apiBase = useMemo(() => `${window.location.origin}/api`, [])

  const [prompts, setPrompts] = useState<Record<Target, string>>({
    'claude-code': '',
    'codex': '',
    'generic': '',
  })
  const [state, setState] = useState<StateResponse | null>(null)
  const [copied, setCopied] = useState<Target | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug || !token) {
      setError('Missing slug or token in URL.')
      return
    }

    async function load() {
      try {
        const promptEntries = await Promise.all(
          TARGETS.map(async ({ id }) => {
            const res = await fetch(`${apiBase}/v1/shares/${slug}/prompt?token=${encodeURIComponent(token)}&target=${id}`)
            if (!res.ok) {
              const detail = await res.text().catch(() => '')
              throw new Error(`Prompt fetch failed (${res.status}) ${detail}`)
            }
            const body = (await res.json()) as PromptResponse
            return [id, body.prompt] as const
          }),
        )
        setPrompts(Object.fromEntries(promptEntries) as Record<Target, string>)

        const stateRes = await fetch(`${apiBase}/v1/agent/shares/${slug}/state?token=${encodeURIComponent(token)}`)
        if (stateRes.ok) {
          setState((await stateRes.json()) as StateResponse)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load session.')
      }
    }

    load()
  }, [apiBase, slug, token])

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

  if (error) {
    return (
      <div style={{ fontFamily: font, minHeight: '100vh', background: '#fafafa', padding: '60px 24px' }}>
        <div style={{ maxWidth: 520, margin: '0 auto', background: '#fff', border: '1px solid #eee', borderRadius: 14, padding: 28 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, marginTop: 0 }}>Session unavailable</h1>
          <p style={{ color: '#666', fontSize: 14 }}>{error}</p>
          <p style={{ color: '#999', fontSize: 12, marginTop: 16 }}>
            The URL must be of the form <code style={{ fontFamily: mono }}>/d/&lt;slug&gt;?token=&lt;token&gt;</code>.
          </p>
        </div>
      </div>
    )
  }

  const acceptedCount = state?.comments.filter((c) => c.reviewStatus === 'accepted').length ?? 0
  const openCount = state?.comments.filter((c) => c.reviewStatus === 'open').length ?? 0
  const doneCount = state?.comments.filter((c) => c.implementationStatus === 'done').length ?? 0

  return (
    <div style={{ fontFamily: font, minHeight: '100vh', background: '#fafafa', color: '#111' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '48px 24px 80px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" /></svg>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em' }}>Feedback Widget</div>
          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#999' }}>
            {state ? `${acceptedCount} accepted · ${openCount} open · ${doneCount} done` : 'Loading…'}
          </div>
        </div>

        <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 6px' }}>
          {state?.project.name ?? 'Agent session'}
        </h1>
        <p style={{ color: '#888', fontSize: 15, margin: '0 0 36px' }}>
          Paste one of these prompts into your agent. It joins this session automatically and starts on the accepted feedback.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 40 }}>
          {TARGETS.map(({ id, label, hint }) => {
            const ready = Boolean(prompts[id])
            const justCopied = copied === id
            return (
              <button
                key={id}
                onClick={() => handleCopy(id)}
                disabled={!ready}
                style={{
                  textAlign: 'left',
                  padding: '18px 18px 16px',
                  background: justCopied ? '#0f172a' : '#fff',
                  color: justCopied ? '#f8fafc' : '#111',
                  border: `1px solid ${justCopied ? '#0f172a' : '#e5e5e5'}`,
                  borderRadius: 14,
                  cursor: ready ? 'pointer' : 'default',
                  opacity: ready ? 1 : 0.6,
                  transition: 'transform 0.15s, border-color 0.15s, background 0.15s',
                  fontFamily: font,
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
                  {justCopied ? 'Copied ✓' : `Copy ${label} prompt`}
                </div>
                <div style={{ fontSize: 12, color: justCopied ? '#94a3b8' : '#888' }}>{hint}</div>
              </button>
            )
          })}
        </div>

        <details style={{ marginBottom: 32, background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: '14px 16px' }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#555' }}>
            What the agent will do
          </summary>
          <ol style={{ color: '#666', fontSize: 13, lineHeight: 1.7, marginTop: 12, marginBottom: 0, paddingLeft: 20 }}>
            <li>Announce presence on this session so you can see it in-flight.</li>
            <li>Read the list of accepted comments below.</li>
            <li>Claim one at a time, implement, and report progress.</li>
            <li>Never change review status — that stays with humans.</li>
          </ol>
        </details>

        {state && state.presence.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
              Live agents
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {state.presence.map((p) => (
                <div key={p.agentId} style={{ padding: '8px 12px', background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, fontSize: 13 }}>
                  <span style={{ fontWeight: 700 }}>{p.agentId}</span>
                  <span style={{ color: '#888', marginLeft: 8 }}>{p.status}</span>
                  {p.summary && <span style={{ color: '#555', marginLeft: 8 }}>· {p.summary}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginBottom: 12, fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Accepted feedback ({acceptedCount})
        </div>
        {state && state.comments.filter((c) => c.reviewStatus === 'accepted').length === 0 ? (
          <div style={{ background: '#fff', border: '1px dashed #ddd', borderRadius: 12, padding: 24, textAlign: 'center', color: '#888', fontSize: 14 }}>
            No accepted comments yet. The agent will see any new ones as soon as a reviewer accepts them.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {state?.comments
              .filter((c) => c.reviewStatus === 'accepted')
              .map((comment) => (
                <div key={comment.id} style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <StatusPill status={comment.implementationStatus} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, color: '#111', marginBottom: 6, lineHeight: 1.5 }}>{comment.body}</div>
                      <div style={{ fontSize: 11, color: '#aaa', fontFamily: mono, wordBreak: 'break-all' }}>
                        {comment.pageUrl} · {comment.selector}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}

        {state && openCount > 0 && (
          <div style={{ marginTop: 28, fontSize: 12, color: '#aaa' }}>
            {openCount} more comment{openCount === 1 ? '' : 's'} waiting on review. They'll appear here once accepted.
          </div>
        )}

        <div style={{ marginTop: 64, paddingTop: 24, borderTop: '1px solid #eee', display: 'flex', gap: 16, fontSize: 12, color: '#aaa' }}>
          <a href="/skill.md" style={{ color: '#888', textDecoration: 'none' }}>Skill</a>
          <a href={`${apiBase}/v1/agent/shares/${slug}/state?token=${encodeURIComponent(token)}`} style={{ color: '#888', textDecoration: 'none' }}>Raw state</a>
          <span style={{ marginLeft: 'auto' }}>
            {state?.share.scopeType === 'project' ? 'Always-on project session' : `${state?.share.scopeType ?? ''} session`}
          </span>
        </div>
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
    <span
      style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 9999,
        background: style.bg,
        color: style.fg,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        marginTop: 2,
      }}
    >
      {style.label}
    </span>
  )
}

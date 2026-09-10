import { useCallback, useEffect, useRef, useState } from 'react'
import { disconnectLinear, getLinearIntegration, selectLinearTeam, type ProjectTrackerIntegration } from '../api'
import { cn } from '../lib/utils'
import { Spinner } from './primitives'

const button = 'inline-flex items-center justify-center rounded-md px-3 py-2 text-xs font-semibold transition-all disabled:opacity-50'

export function LinearIntegrationSettings({ apiBase, accessToken, projectKey }: { apiBase: string; accessToken: string; projectKey: string }) {
  const [integration, setIntegration] = useState<ProjectTrackerIntegration | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const popup = useRef<Window | null>(null)
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setIntegration(await getLinearIntegration(apiBase, accessToken, projectKey)) }
    catch { setError('Could not load the Linear connection.') }
    finally { setLoading(false) }
  }, [accessToken, apiBase, projectKey])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const callbackOrigin = new URL(apiBase, window.location.href).origin
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== callbackOrigin || event.source !== popup.current) return
      const message = event.data as { type?: string; ok?: boolean; projectKey?: string }
      if (message.type !== 'crrt:linear-connect' || message.projectKey !== projectKey) return
      popup.current = null; setBusy(false)
      if (message.ok) void load()
      else setError('Linear authorization could not be completed.')
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [apiBase, load, projectKey])
  useEffect(() => {
    if (!busy) return
    const timer = window.setInterval(() => {
      if (!popup.current || !popup.current.closed) return
      popup.current = null
      setBusy(false)
    }, 500)
    return () => window.clearInterval(timer)
  }, [busy])

  async function connect() {
    setBusy(true); setError(null)
    try {
      const response = await getLinearIntegration(apiBase, accessToken, projectKey, true)
      if (!response.authorizeUrl || new URL(response.authorizeUrl).origin !== 'https://linear.app') throw new Error('invalid_authorize_url')
      popup.current = window.open(response.authorizeUrl, 'crrt-linear-connect')
      if (!popup.current) throw new Error('popup_blocked')
    } catch { popup.current = null; setBusy(false); setError('Allow pop-ups for CRRT, then try again.') }
  }

  async function select(containerId: string) {
    setBusy(true); setError(null)
    try { setIntegration(await selectLinearTeam(apiBase, accessToken, projectKey, containerId)) }
    catch { setError('Could not update the Linear team.') }
    finally { setBusy(false) }
  }

  async function disconnect() {
    setBusy(true); setError(null)
    try { await disconnectLinear(apiBase, accessToken, projectKey); await load() }
    catch { setError('Could not disconnect Linear.') }
    finally { setBusy(false) }
  }

  return <section className="mt-8" aria-labelledby="linear-integration-heading">
    <h2 id="linear-integration-heading" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Linear</h2>
    <p className="mt-1 text-[11px] text-muted-foreground">Choose the team that receives manually approved feedback.</p>
    <div className="mt-3 rounded-lg border border-border bg-card p-4">
      {loading ? <div className="flex justify-center py-4" aria-label="Loading Linear connection"><Spinner size={16} /></div> : integration?.connected ? <div className="space-y-3">
        <div className="flex items-center justify-between gap-3"><div><p className="text-[13px] font-semibold text-foreground">{integration.workspace}</p><p className="mt-1 text-[11px] text-muted-foreground">Connected and ready for issue creation.</p></div><span className="rounded-full bg-status-accepted-bg px-2 py-0.5 text-[10px] font-semibold text-status-accepted">Connected</span></div>
        {integration.reauthorizationRequired && <div role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-[11px] text-muted-foreground">Reconnect Linear to let CRRT close linked issues when feedback is rejected.</div>}
        <label className="block text-[11px] font-medium text-muted-foreground">Team<select aria-label="Linear team" value={integration.selectedDestinationId ?? ''} disabled={busy} onChange={(event) => { void select(event.target.value) }} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground">{integration.destinations.map((destination) => <option key={destination.id} value={destination.id}>{destination.name}</option>)}</select></label>
        <div className="flex justify-end gap-2">{integration.reauthorizationRequired && <button type="button" disabled={busy} onClick={() => { void connect() }} className={cn(button, 'bg-primary text-primary-foreground')}>{busy ? 'Connecting…' : 'Reconnect'}</button>}<button type="button" disabled={busy} onClick={() => { void disconnect() }} className={cn(button, 'border border-border text-muted-foreground hover:text-status-rejected')}>{busy ? 'Working…' : 'Disconnect'}</button></div>
      </div> : <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[13px] font-semibold text-foreground">No Linear workspace connected</p><p className="mt-1 text-[11px] text-muted-foreground">Authorize CRRT with read and write access.</p></div><button type="button" disabled={busy} onClick={() => { void connect() }} className={cn(button, 'bg-primary text-primary-foreground')}>{busy ? 'Connecting…' : 'Connect Linear'}</button></div>}
      {error && <p role="alert" className="mt-3 text-[11px] text-status-rejected">{error}</p>}
    </div>
  </section>
}

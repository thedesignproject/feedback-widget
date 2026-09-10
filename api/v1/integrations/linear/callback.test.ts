import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../_lib/linear.js', () => ({ exchangeLinearCode: vi.fn(), getLinearWorkspace: vi.fn(), verifyLinearOAuthState: vi.fn() }))
vi.mock('../../../_lib/tokens.js', () => ({ encryptToken: vi.fn((value: string) => `encrypted:${value}`) }))
vi.mock('../../../_lib/store.js', () => ({ getProjectMember: vi.fn(), upsertProjectIntegration: vi.fn() }))
vi.mock('../../../_lib/widget-github-auth.js', () => ({ widgetCallbackHtml: vi.fn((_origin: string, message: unknown) => JSON.stringify(message)) }))

import handler from './callback.js'
import { exchangeLinearCode, getLinearWorkspace, verifyLinearOAuthState } from '../../../_lib/linear.js'
import { getProjectMember, upsertProjectIntegration } from '../../../_lib/store.js'

function response() {
  return {
    statusCode: 200, body: null as unknown, headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this },
    json(body: unknown) { this.body = body; return this },
    send(body: unknown) { this.body = body; return this },
    setHeader(key: string, value: string) { this.headers[key] = value },
  }
}
const call = (req: unknown, res: unknown) => (handler as unknown as (req: unknown, res: unknown) => Promise<unknown>)(req, res)
const state = { projectKey: 'p', userId: 'u', origin: 'https://app.crrt.test', redirectUri: 'https://api.crrt.test/callback' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(verifyLinearOAuthState).mockReturnValue(state as never)
  vi.mocked(getProjectMember).mockResolvedValue({ role: 'admin' } as never)
  vi.mocked(exchangeLinearCode).mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', expiresAt: 'later', grantedScopes: 'read,write' })
  vi.mocked(getLinearWorkspace).mockResolvedValue({ id: 'workspace', name: 'Acme', teams: [{ id: 'team', key: 'WEB', name: 'Web' }] })
})

describe('Linear OAuth callback', () => {
  it('validates the method, required query, and signed state', async () => {
    let res = response()
    await call({ method: 'POST', query: {}, headers: {} }, res)
    expect(res.statusCode).toBe(405)
    res = response()
    await call({ method: 'GET', query: {}, headers: {} }, res)
    expect(res.statusCode).toBe(400)
    vi.mocked(verifyLinearOAuthState).mockReturnValueOnce(null)
    res = response()
    await call({ method: 'GET', query: { code: 'code', state: 'state' }, headers: {} }, res)
    expect(res.statusCode).toBe(400)
  })

  it('stores encrypted tokens and an initial team in a hardened callback page', async () => {
    const res = response()
    await call({ method: 'GET', query: { code: 'code', state: 'state' }, headers: {} }, res)
    expect(upsertProjectIntegration).toHaveBeenCalledWith(expect.objectContaining({
      projectKey: 'p', accessTokenCiphertext: 'encrypted:access', refreshTokenCiphertext: 'encrypted:refresh',
      containerId: 'team', containerName: 'WEB · Web', grantedScopes: 'read,write',
    }))
    expect(res.headers['Content-Security-Policy']).toContain("default-src 'none'")
    expect(res.body).toContain('"ok":true')
  })

  it('supports workspaces without teams or rotating refresh tokens', async () => {
    vi.mocked(exchangeLinearCode).mockResolvedValueOnce({ accessToken: 'access', refreshToken: null, expiresAt: null, grantedScopes: null })
    vi.mocked(getLinearWorkspace).mockResolvedValueOnce({ id: 'workspace', name: 'Acme', teams: [] })
    const res = response()
    await call({ method: 'GET', query: { code: 'code', state: 'state' }, headers: {} }, res)
    expect(upsertProjectIntegration).toHaveBeenCalledWith(expect.objectContaining({ refreshTokenCiphertext: null, containerId: null, containerName: null }))
  })

  it('returns a safe callback failure for unauthorized or failed exchanges', async () => {
    vi.mocked(getProjectMember).mockResolvedValueOnce(null)
    let res = response()
    await call({ method: 'GET', query: { code: 'code', state: 'state' }, headers: {} }, res)
    expect(res.body).toContain('"ok":false')
    vi.mocked(exchangeLinearCode).mockRejectedValueOnce(new Error('secret response'))
    res = response()
    await call({ method: 'GET', query: { code: 'code', state: 'state' }, headers: {} }, res)
    expect(res.body).toContain('linear_oauth_failed')
  })
})

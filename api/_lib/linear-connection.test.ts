import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./tokens.js', () => ({ decryptToken: vi.fn((value: string) => `plain:${value}`), encryptToken: vi.fn((value: string) => `cipher:${value}`) }))
vi.mock('./linear.js', () => ({ refreshLinearToken: vi.fn() }))
vi.mock('./store.js', () => ({ updateProjectIntegrationTokens: vi.fn() }))

import { getLinearAccessToken } from './linear-connection.js'
import { refreshLinearToken } from './linear.js'
import { updateProjectIntegrationTokens } from './store.js'

const integration = {
  id: 'integration', accessTokenCiphertext: 'access', refreshTokenCiphertext: 'refresh',
  tokenExpiresAt: new Date(Date.now() + 120_000).toISOString(), grantedScopes: 'read,write',
}

beforeEach(() => vi.clearAllMocks())

describe('getLinearAccessToken', () => {
  it('decrypts a still-valid token, including non-expiring legacy records', async () => {
    await expect(getLinearAccessToken(integration)).resolves.toBe('plain:access')
    await expect(getLinearAccessToken({ ...integration, tokenExpiresAt: null })).resolves.toBe('plain:access')
    expect(refreshLinearToken).not.toHaveBeenCalled()
  })

  it('requires reauthorization when an expired token cannot refresh', async () => {
    await expect(getLinearAccessToken({ ...integration, tokenExpiresAt: new Date(0).toISOString(), refreshTokenCiphertext: null }))
      .rejects.toThrow('linear_reauthorization_required')
  })

  it('refreshes and persists rotating and retained refresh tokens', async () => {
    vi.mocked(refreshLinearToken)
      .mockResolvedValueOnce({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: 'later', grantedScopes: 'read,write' })
      .mockResolvedValueOnce({ accessToken: 'newer-access', refreshToken: null, expiresAt: null, grantedScopes: null })

    await expect(getLinearAccessToken({ ...integration, tokenExpiresAt: new Date(0).toISOString() })).resolves.toBe('new-access')
    expect(updateProjectIntegrationTokens).toHaveBeenLastCalledWith({
      id: 'integration', accessTokenCiphertext: 'cipher:new-access', refreshTokenCiphertext: 'cipher:new-refresh', tokenExpiresAt: 'later', grantedScopes: 'read,write',
    })

    await expect(getLinearAccessToken({ ...integration, tokenExpiresAt: new Date(0).toISOString() })).resolves.toBe('newer-access')
    expect(updateProjectIntegrationTokens).toHaveBeenLastCalledWith({
      id: 'integration', accessTokenCiphertext: 'cipher:newer-access', refreshTokenCiphertext: 'refresh', tokenExpiresAt: null, grantedScopes: 'read,write',
    })
  })
})

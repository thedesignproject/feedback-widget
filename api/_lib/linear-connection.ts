import { decryptToken, encryptToken } from './tokens.js'
import { refreshLinearToken } from './linear.js'
import { updateProjectIntegrationTokens } from './store.js'

type StoredLinearIntegration = {
  id: string
  accessTokenCiphertext: string
  refreshTokenCiphertext: string | null
  tokenExpiresAt: string | null
  grantedScopes?: string | null
}

export async function getLinearAccessToken(integration: StoredLinearIntegration) {
  const expiresAt = integration.tokenExpiresAt ? Date.parse(integration.tokenExpiresAt) : Number.POSITIVE_INFINITY
  if (expiresAt > Date.now() + 60_000) return decryptToken(integration.accessTokenCiphertext)
  if (!integration.refreshTokenCiphertext) throw new Error('linear_reauthorization_required')
  const tokens = await refreshLinearToken(decryptToken(integration.refreshTokenCiphertext))
  await updateProjectIntegrationTokens({
    id: integration.id,
    accessTokenCiphertext: encryptToken(tokens.accessToken),
    refreshTokenCiphertext: tokens.refreshToken
      ? encryptToken(tokens.refreshToken)
      : integration.refreshTokenCiphertext,
    tokenExpiresAt: tokens.expiresAt,
    grantedScopes: tokens.grantedScopes ?? integration.grantedScopes,
  })
  return tokens.accessToken
}

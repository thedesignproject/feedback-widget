import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

function getSecretKey() {
  const secret = process.env.SHARE_TOKEN_SECRET || process.env.REVIEWER_API_TOKEN || 'development-share-token-secret'
  return createHash('sha256').update(secret).digest()
}

export function generateSlug() {
  return randomBytes(6).toString('base64url')
}

export function generateAccessToken() {
  return randomBytes(24).toString('base64url')
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function encryptToken(token: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getSecretKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.')
}

export function decryptToken(value: string) {
  const [ivPart, tagPart, ciphertextPart] = value.split('.')
  if (!ivPart || !tagPart || !ciphertextPart) {
    throw new Error('Invalid encrypted token payload')
  }

  const iv = Buffer.from(ivPart, 'base64url')
  const tag = Buffer.from(tagPart, 'base64url')
  const ciphertext = Buffer.from(ciphertextPart, 'base64url')
  const decipher = createDecipheriv('aes-256-gcm', getSecretKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}


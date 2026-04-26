// Frontend-only author identity. The widget has no auth, so the user's
// name lives in localStorage. We also remember which comment was authored
// by which name so newly-fetched comments can be hydrated on reload.

const AUTHOR_NAME_KEY = 'fw-author-name'
const AUTHOR_MAP_KEY = 'fw-author-map'

export function readAuthorName(): string | null {
  try { return localStorage.getItem(AUTHOR_NAME_KEY) } catch { return null }
}

export function writeAuthorName(name: string) {
  try { localStorage.setItem(AUTHOR_NAME_KEY, name) } catch {}
}

export function readAuthorMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(AUTHOR_MAP_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export function rememberCommentAuthor(commentId: string, name: string) {
  try {
    const map = readAuthorMap()
    map[commentId] = name
    localStorage.setItem(AUTHOR_MAP_KEY, JSON.stringify(map))
  } catch {}
}

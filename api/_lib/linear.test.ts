import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildLinearAuthorizeUrl,
  closeLinearIssue,
  createLinearIssue,
  createLinearOAuthState,
  exchangeLinearCode,
  getLinearWorkspace,
  hasLinearWriteScope,
  refreshLinearToken,
  verifyLinearOAuthState,
} from './linear.js'

const env = { ...process.env }

function signedState(value: unknown) {
  const body = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')
  return `${body}.${createHmac('sha256', 'state-secret').update(body).digest('base64url')}`
}

beforeEach(() => {
  process.env = { ...env }
  process.env.LINEAR_CLIENT_ID = 'linear-client'
  process.env.LINEAR_CLIENT_SECRET = 'linear-secret'
  process.env.WIDGET_AUTH_SECRET = 'state-secret'
})
afterEach(() => {
  process.env = { ...env }
  vi.unstubAllGlobals()
})

describe('Linear integration client', () => {
  it('signs expiring OAuth state and builds the least-privilege authorize URL', () => {
    const state = createLinearOAuthState({ projectKey: 'p', userId: 'u', origin: 'https://crrt.ai', redirectUri: 'https://crrt.ai/v1/integrations/linear/callback' }, 100)
    expect(verifyLinearOAuthState(state, 101)).toMatchObject({ projectKey: 'p', userId: 'u' })
    expect(verifyLinearOAuthState(state, 701)).toBeNull()
    expect(verifyLinearOAuthState(`${state}x`, 101)).toBeNull()
    const url = new URL(buildLinearAuthorizeUrl(state, 'https://crrt.ai/v1/integrations/linear/callback'))
    expect(url.origin + url.pathname).toBe('https://linear.app/oauth/authorize')
    expect(url.searchParams.get('scope')).toBe('read,write')
    expect(url.searchParams.get('actor')).toBe('user')
    expect(hasLinearWriteScope('read,write')).toBe(true)
    expect(hasLinearWriteScope('read issues:create')).toBe(false)
    expect(hasLinearWriteScope(null)).toBe(false)
  })

  it('rejects malformed signed state payloads and missing signing credentials', () => {
    expect(verifyLinearOAuthState('')).toBeNull()
    expect(verifyLinearOAuthState('a.b.extra')).toBeNull()
    expect(verifyLinearOAuthState(signedState('{'))).toBeNull()
    const valid = { type: 'linear-oauth', projectKey: 'p', userId: 'u', origin: 'https://crrt.ai', redirectUri: 'https://crrt.ai/callback', nonce: 'n', exp: 200 }
    for (const key of ['type', 'projectKey', 'userId', 'origin', 'redirectUri', 'nonce', 'exp'] as const) {
      const malformed: Record<string, unknown> = { ...valid }
      malformed[key] = key === 'type' ? 'wrong' : null
      expect(verifyLinearOAuthState(signedState(malformed), 100)).toBeNull()
    }
    delete process.env.WIDGET_AUTH_SECRET
    expect(() => createLinearOAuthState({ projectKey: 'p', userId: 'u', origin: 'https://crrt.ai', redirectUri: 'https://crrt.ai/callback' }))
      .toThrow('missing_widget_auth_secret')
  })

  it('requires complete OAuth client credentials', () => {
    delete process.env.LINEAR_CLIENT_ID
    expect(() => buildLinearAuthorizeUrl('state', 'https://crrt.ai/callback')).toThrow('missing_linear_oauth_credentials')
    process.env.LINEAR_CLIENT_ID = 'client'
    delete process.env.LINEAR_CLIENT_SECRET
    expect(() => refreshLinearToken('refresh')).toThrow('missing_linear_oauth_credentials')
  })

  it('exchanges codes using form encoding and parses rotating refresh tokens', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: 'read,write' }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await expect(exchangeLinearCode('code', 'https://crrt.ai/callback')).resolves.toMatchObject({ accessToken: 'access', refreshToken: 'refresh', grantedScopes: 'read,write' })
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    expect(String(fetch.mock.calls[0]?.[1]?.body)).toContain('grant_type=authorization_code')
  })

  it('refreshes tokens and validates token-exchange responses', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access', refresh_token: 1, expires_in: -1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid' }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await expect(refreshLinearToken('refresh')).resolves.toEqual({ accessToken: 'access', refreshToken: null, expiresAt: null, grantedScopes: null })
    await expect(refreshLinearToken('refresh')).resolves.toEqual({ accessToken: 'access', refreshToken: null, expiresAt: null, grantedScopes: null })
    await expect(refreshLinearToken('refresh')).rejects.toThrow('linear_token_exchange_failed')
    await expect(refreshLinearToken('refresh')).rejects.toThrow('linear_token_exchange_failed')
    expect(String(fetch.mock.calls[0]?.[1]?.body)).toContain('grant_type=refresh_token')
  })

  it('loads teams and creates issues while treating transport ambiguity as indeterminate', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { viewer: { organization: { id: 'w', name: 'Workspace' } }, teams: { nodes: [{ id: 't', key: 'WEB', name: 'Web' }] } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { issueCreate: { success: true, issue: { id: 'i', identifier: 'WEB-1', url: 'https://linear.app/issue/WEB-1' } } } }), { status: 200 }))
      .mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetch)
    await expect(getLinearWorkspace('token')).resolves.toEqual({ id: 'w', name: 'Workspace', teams: [{ id: 't', key: 'WEB', name: 'Web' }] })
    await expect(createLinearIssue('token', { teamId: 't', title: 'Title', description: 'Body' })).resolves.toEqual({ externalId: 'i', externalKey: 'WEB-1', externalUrl: 'https://linear.app/issue/WEB-1' })
    await expect(createLinearIssue('token', { teamId: 't', title: 'Title', description: 'Body' })).rejects.toThrow('linear_result_indeterminate')

    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: {
      issueCreate: { success: true, issue: { id: 'i', identifier: 'WEB-1', url: 'javascript:alert(1)' } },
    } }), { status: 200 }))
    await expect(createLinearIssue('token', { teamId: 't', title: 'Title', description: 'Body' }))
      .rejects.toThrow('linear_issue_create_failed')
  })

  it('rejects invalid GraphQL responses, workspaces, teams, and issue results', async () => {
    const validWorkspace = { viewer: { organization: { id: 'w', name: 'Workspace' } }, teams: { nodes: [
      { id: 't', key: 'WEB', name: 'Web' }, { id: '', key: 'BAD', name: 'Bad' }, { id: 'x', key: '', name: 'Bad' }, { id: 'y', key: 'BAD', name: '' },
    ] } }
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: validWorkspace, errors: [{}] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: validWorkspace }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: validWorkspace }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await expect(getLinearWorkspace('token')).rejects.toThrow('linear_result_indeterminate')
    await expect(getLinearWorkspace('token')).rejects.toThrow('linear_request_failed')
    await expect(getLinearWorkspace('token')).rejects.toThrow('linear_request_failed')
    await expect(getLinearWorkspace('token')).rejects.toThrow('linear_request_failed')
    await expect(getLinearWorkspace('token')).resolves.toMatchObject({ teams: [{ id: 't', key: 'WEB', name: 'Web' }] })

    for (const data of [
      { viewer: {}, teams: { nodes: [] } },
      { viewer: { organization: { id: 'w', name: '' } }, teams: { nodes: [] } },
      { viewer: { organization: { id: 'w', name: 'Workspace' } }, teams: {} },
    ]) {
      fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data }), { status: 200 }))
      await expect(getLinearWorkspace('token')).rejects.toThrow('linear_workspace_invalid')
    }

    for (const issueCreate of [
      undefined,
      { success: false, issue: null },
      { success: true, issue: { id: '', identifier: 'WEB-1', url: 'url' } },
      { success: true, issue: { id: 'i', identifier: '', url: 'url' } },
      { success: true, issue: { id: 'i', identifier: 'WEB-1', url: '' } },
    ]) {
      fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { issueCreate } }), { status: 200 }))
      await expect(createLinearIssue('token', { teamId: 't', title: 'Title', description: 'Body' }))
        .rejects.toThrow('linear_issue_create_failed')
    }
  })

  it('moves an issue to the first canceled state and adds one marked rejection comment', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { issue: {
        state: { type: 'started' },
        team: { states: { nodes: [{ id: 'later', name: 'Canceled', position: 2 }, { id: 'first', name: 'Won’t do', position: 1 }] } },
        comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
      } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { issueUpdate: { success: true } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { commentCreate: { success: true } } }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    await expect(closeLinearIssue('token', { issueId: 'issue', comment: 'Rejected', marker: '<!-- marker -->' })).resolves.toBeUndefined()
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({ variables: { issueId: 'issue', input: { stateId: 'first' } } })
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toMatchObject({ variables: { input: { issueId: 'issue', body: 'Rejected\n\n<!-- marker -->' } } })
  })

  it('leaves an already-canceled, already-commented issue unchanged', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { issue: {
      state: { type: 'canceled' }, team: { states: { nodes: [] } }, comments: { nodes: [{ body: 'seen marker' }], pageInfo: { hasNextPage: false, endCursor: null } },
    } } }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await closeLinearIssue('token', { issueId: 'issue', comment: 'Rejected', marker: 'marker' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reports missing issues, missing canceled states, and rejected mutations', async () => {
    const response = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 })
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ issue: null }))
      .mockResolvedValueOnce(response({ issue: { state: { type: 'started' }, team: { states: { nodes: [] } }, comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }))
      .mockResolvedValueOnce(response({ issue: { state: { type: 'started' }, team: { states: { nodes: [{ id: 'c', name: 'Canceled', position: 1 }] } }, comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }))
      .mockResolvedValueOnce(response({ issueUpdate: { success: false } }))
      .mockResolvedValueOnce(response({ issue: { state: { type: 'canceled' }, team: { states: { nodes: [] } }, comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }))
      .mockResolvedValueOnce(response({ commentCreate: { success: false } }))
    vi.stubGlobal('fetch', fetch)
    const input = { issueId: 'issue', comment: 'Rejected', marker: 'marker' }
    await expect(closeLinearIssue('token', input)).rejects.toThrow('linear_issue_not_found')
    await expect(closeLinearIssue('token', input)).rejects.toThrow('linear_canceled_state_unavailable')
    await expect(closeLinearIssue('token', input)).rejects.toThrow('linear_issue_close_failed')
    await expect(closeLinearIssue('token', input)).rejects.toThrow('linear_issue_comment_failed')
  })

  it('paginates rejection comments and stops when the marker is found', async () => {
    const firstPage = Array.from({ length: 100 }, () => ({ body: 'older comment' }))
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { issue: {
        state: { type: 'canceled' }, team: { states: { nodes: [] } },
        comments: { nodes: firstPage, pageInfo: { hasNextPage: true, endCursor: 'cursor-1' } },
      } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { issue: {
        comments: { nodes: [{ body: 'seen marker' }], pageInfo: { hasNextPage: false, endCursor: null } },
      } } }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await closeLinearIssue('token', { issueId: 'issue', comment: 'Rejected', marker: 'marker' })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({ variables: { after: 'cursor-1' } })
  })

  it('rejects malformed rejection comment pagination responses', async () => {
    const response = (issue: unknown) => new Response(JSON.stringify({ data: { issue } }), { status: 200 })
    const validIssue = {
      state: { type: 'canceled' }, team: { states: { nodes: [] } },
      comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    }
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ ...validIssue, comments: { nodes: null, pageInfo: { hasNextPage: false } } }))
      .mockResolvedValueOnce(response({ ...validIssue, comments: { nodes: [], pageInfo: { hasNextPage: null } } }))
      .mockResolvedValueOnce(response({ ...validIssue, comments: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } } }))
      .mockResolvedValueOnce(response({ ...validIssue, comments: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'cursor' } } }))
      .mockResolvedValueOnce(response(null))
    vi.stubGlobal('fetch', fetch)
    const input = { issueId: 'issue', comment: 'Rejected', marker: 'marker' }

    await expect(closeLinearIssue('token', input)).rejects.toThrow('linear_request_failed')
    await expect(closeLinearIssue('token', input)).rejects.toThrow('linear_request_failed')
    await expect(closeLinearIssue('token', input)).rejects.toThrow('linear_request_failed')
    await expect(closeLinearIssue('token', input)).rejects.toThrow('linear_issue_not_found')
  })

  it('checks the current rejection before each Linear mutation', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { issue: {
      state: { type: 'started' }, team: { states: { nodes: [{ id: 'c', name: 'Canceled', position: 1 }] } },
      comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    } } }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await expect(closeLinearIssue('token', {
      issueId: 'issue', comment: 'Rejected', marker: 'marker', beforeClose: async () => false,
    })).rejects.toThrow('external_work_sync_cancelled')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('checks a current rejection before adding the Linear explanation', async () => {
    const issue = {
      state: { type: 'canceled' }, team: { states: { nodes: [] } },
      comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    }
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { issue } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { issue } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { commentCreate: { success: true } } }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const input = { issueId: 'issue', comment: 'Rejected', marker: 'marker' }

    await expect(closeLinearIssue('token', { ...input, beforeClose: async () => false }))
      .rejects.toThrow('external_work_sync_cancelled')
    await expect(closeLinearIssue('token', { ...input, beforeClose: async () => true })).resolves.toBeUndefined()
  })
})

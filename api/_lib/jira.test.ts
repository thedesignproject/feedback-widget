import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildJiraAuthorizeUrl,
  closeJiraIssue,
  createJiraIssue,
  createJiraOAuthState,
  exchangeJiraCode,
  getJiraDestinations,
  refreshJiraToken,
  verifyJiraOAuthState,
} from './jira.js'

const env = { ...process.env }

function signedState(value: unknown) {
  const body = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')
  return `${body}.${createHmac('sha256', 'state-secret').update(body).digest('base64url')}`
}

beforeEach(() => {
  process.env = { ...env }
  process.env.JIRA_CLIENT_ID = 'jira-client'
  process.env.JIRA_CLIENT_SECRET = 'jira-secret'
  process.env.WIDGET_AUTH_SECRET = 'state-secret'
})
afterEach(() => {
  process.env = { ...env }
  vi.unstubAllGlobals()
})

describe('Jira integration client', () => {
  it('signs expiring OAuth state and builds the Atlassian 3LO URL', () => {
    const state = createJiraOAuthState({
      projectKey: 'p', userId: 'u', origin: 'https://crrt.ai',
      redirectUri: 'https://crrt.ai/v1/integrations/jira/callback',
    }, 100)
    expect(verifyJiraOAuthState(state, 101)).toMatchObject({ projectKey: 'p', userId: 'u' })
    expect(verifyJiraOAuthState(state, 701)).toBeNull()
    expect(verifyJiraOAuthState(`${state}.extra`, 101)).toBeNull()
    const url = new URL(buildJiraAuthorizeUrl(state, 'https://crrt.ai/v1/integrations/jira/callback'))
    expect(url.origin + url.pathname).toBe('https://auth.atlassian.com/authorize')
    expect(url.searchParams.get('audience')).toBe('api.atlassian.com')
    expect(url.searchParams.get('scope')).toBe('read:jira-work write:jira-work offline_access')
    expect(url.searchParams.get('prompt')).toBe('consent')
  })

  it('exchanges codes with JSON and retains rotating refresh tokens', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access', refresh_token: 'refresh', expires_in: 3600,
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await expect(exchangeJiraCode('code', 'https://crrt.ai/callback')).resolves.toMatchObject({
      accessToken: 'access', refreshToken: 'refresh',
    })
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    })
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      grant_type: 'authorization_code', code: 'code', client_id: 'jira-client',
    })
  })

  it('rejects malformed signed state payloads and missing signing credentials', () => {
    expect(verifyJiraOAuthState('')).toBeNull()
    expect(verifyJiraOAuthState('a.b.extra')).toBeNull()
    expect(verifyJiraOAuthState('a.b')).toBeNull()
    expect(verifyJiraOAuthState(signedState('{'))).toBeNull()
    const validToken = signedState({ type: 'jira-oauth', projectKey: 'p', userId: 'u', origin: 'https://crrt.ai', redirectUri: 'https://crrt.ai/callback', nonce: 'n', exp: 200 })
    const [validBody, validSignature] = validToken.split('.') as [string, string]
    const changedSignature = `${validSignature[0] === 'a' ? 'b' : 'a'}${validSignature.slice(1)}`
    expect(verifyJiraOAuthState(`${validBody}.${changedSignature}`, 100)).toBeNull()
    const valid = { type: 'jira-oauth', projectKey: 'p', userId: 'u', origin: 'https://crrt.ai', redirectUri: 'https://crrt.ai/callback', nonce: 'n', exp: 200 }
    for (const key of ['type', 'projectKey', 'userId', 'origin', 'redirectUri', 'nonce', 'exp'] as const) {
      const malformed: Record<string, unknown> = { ...valid }
      malformed[key] = key === 'type' ? 'wrong' : null
      expect(verifyJiraOAuthState(signedState(malformed), 100)).toBeNull()
    }
    delete process.env.WIDGET_AUTH_SECRET
    expect(() => createJiraOAuthState({ projectKey: 'p', userId: 'u', origin: 'https://crrt.ai', redirectUri: 'https://crrt.ai/callback' }))
      .toThrow('missing_widget_auth_secret')
  })

  it('requires complete OAuth credentials', () => {
    delete process.env.JIRA_CLIENT_ID
    expect(() => buildJiraAuthorizeUrl('state', 'https://crrt.ai/callback')).toThrow('missing_jira_oauth_credentials')
    process.env.JIRA_CLIENT_ID = 'client'
    delete process.env.JIRA_CLIENT_SECRET
    expect(() => refreshJiraToken('refresh')).toThrow('missing_jira_oauth_credentials')
  })

  it('refreshes tokens and validates token-exchange responses', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access', refresh_token: 1, expires_in: -1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid' }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetch)
    await expect(refreshJiraToken('refresh')).resolves.toEqual({ accessToken: 'access', refreshToken: null, expiresAt: null })
    await expect(refreshJiraToken('refresh')).resolves.toEqual({ accessToken: 'access', refreshToken: null, expiresAt: null })
    await expect(refreshJiraToken('refresh')).rejects.toThrow('jira_token_exchange_failed')
    await expect(refreshJiraToken('refresh')).rejects.toThrow('jira_token_exchange_failed')
    await expect(refreshJiraToken('refresh')).rejects.toThrow('jira_token_exchange_failed')
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({ grant_type: 'refresh_token' })
  })

  it('loads projects across authorized Jira sites', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { id: 'cloud', name: 'Acme Jira', url: 'https://acme.atlassian.net', scopes: ['read:jira-work'] },
        { id: 'confluence', name: 'Acme Confluence', url: 'https://acme.atlassian.net/wiki', scopes: ['read:confluence-content.all'] },
      ]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ values: [{ id: '100', key: 'WEB', name: 'Website' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await expect(getJiraDestinations('access')).resolves.toEqual([{
      id: 'cloud:100', cloudId: 'cloud', siteName: 'Acme Jira', siteUrl: 'https://acme.atlassian.net',
      projectId: '100', projectKey: 'WEB', projectName: 'Website',
    }])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('filters malformed sites and projects and supports missing scopes and values', async () => {
    const resources = [
      { id: 'cloud', name: 'Acme', url: 'https://acme.atlassian.net' },
      { id: '', name: 'Bad', url: 'https://bad.atlassian.net' },
      { id: 'bad-name', name: '', url: 'https://bad.atlassian.net' },
      { id: 'bad-url', name: 'Bad', url: '' },
    ]
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(resources), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ values: [
        { id: '100', key: 'WEB', name: 'Website' },
        { id: '', key: 'BAD', name: 'Bad' }, { id: '101', key: '', name: 'Bad' }, { id: '102', key: 'BAD', name: '' },
      ] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(resources), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await expect(getJiraDestinations('access')).resolves.toHaveLength(1)
    await expect(getJiraDestinations('access')).resolves.toEqual([])
  })

  it('rejects failed and malformed Jira API responses', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 500 }))
    vi.stubGlobal('fetch', fetch)
    await expect(getJiraDestinations('access')).rejects.toThrow('jira_request_failed')
    await expect(getJiraDestinations('access')).rejects.toThrow('jira_request_failed')
    await expect(getJiraDestinations('access')).rejects.toThrow('jira_request_failed')
  })

  it('classifies actionable Jira HTTP failures without leaking response details', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    for (const [status, code] of [
      [401, 'jira_reauthorization_required'],
      [403, 'jira_permission_denied'],
      [404, 'jira_resource_not_found'],
      [409, 'jira_conflict'],
      [429, 'jira_rate_limited'],
    ] as const) {
      fetch.mockResolvedValueOnce(new Response('private provider response', { status }))
      await expect(getJiraDestinations('access')).rejects.toThrow(code)
    }
  })

  it('creates a task with an ADF description and treats an ambiguous POST as indeterminate', async () => {
    const issueTypes = new Response(JSON.stringify({
      issueTypes: [{ id: 'bug', name: 'Bug' }, { id: 'task', name: 'Task' }],
    }), { status: 200 })
    const fetch = vi.fn()
      .mockResolvedValueOnce(issueTypes)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '200', key: 'WEB-7' }), { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    await expect(createJiraIssue('access', {
      cloudId: 'cloud', siteUrl: 'https://acme.atlassian.net/', projectId: '100',
      title: 'Improve checkout', description: 'First line\nSecond line',
    })).resolves.toEqual({
      externalId: '200', externalKey: 'WEB-7', externalUrl: 'https://acme.atlassian.net/browse/WEB-7',
    })
    const issueBody = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))
    expect(issueBody.fields).toMatchObject({
      project: { id: '100' }, issuetype: { id: 'task' }, summary: 'Improve checkout',
      description: { type: 'doc', version: 1 },
    })

    fetch.mockReset()
      .mockResolvedValueOnce(new Response(JSON.stringify({ issueTypes: [{ id: 'task', name: 'Task' }] }), { status: 200 }))
      .mockRejectedValueOnce(new Error('connection reset'))
    await expect(createJiraIssue('access', {
      cloudId: 'cloud', siteUrl: 'https://acme.atlassian.net', projectId: '100',
      title: 'Title', description: 'Body',
    })).rejects.toThrow('jira_result_indeterminate')
  })

  it('falls back to the first usable issue type and preserves blank ADF paragraphs', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ issueTypes: [
        { id: 'subtask', name: 'Subtask', subtask: true }, { id: 'custom', name: 'Request' }, { id: '', name: 'Task' },
      ] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '200', key: 'WEB/7' }), { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    await expect(createJiraIssue('access', {
      cloudId: 'cloud/id', siteUrl: 'https://acme.atlassian.net', projectId: '100/id', title: 'Title', description: 'First\n',
    })).resolves.toMatchObject({ externalKey: 'WEB/7', externalUrl: 'https://acme.atlassian.net/browse/WEB%2F7' })
    const issueBody = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))
    expect(issueBody.fields.issuetype).toEqual({ id: 'custom' })
    expect(issueBody.fields.description.content[1].content).toEqual([])
  })

  it('rejects unavailable issue types, bad creation results, and unsafe Jira site URLs', async () => {
    const input = { cloudId: 'cloud', siteUrl: 'https://acme.atlassian.net', projectId: '100', title: 'Title', description: 'Body' }
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ issueTypes: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ issueTypes: [{ id: 'task', name: 'Task' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '', key: 'WEB-1' }), { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    await expect(createJiraIssue('access', input)).rejects.toThrow('jira_issue_type_unavailable')
    await expect(createJiraIssue('access', input)).rejects.toThrow('jira_issue_type_unavailable')
    await expect(createJiraIssue('access', input)).rejects.toThrow('jira_issue_create_failed')

    fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ issueTypes: [{ id: 'task', name: 'Task' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }))
    await expect(createJiraIssue('access', input)).rejects.toThrow('jira_result_indeterminate')

    for (const siteUrl of ['not a url', 'http://acme.atlassian.net', 'https://attacker.test']) {
      fetch
        .mockResolvedValueOnce(new Response(JSON.stringify({ issueTypes: [{ id: 'task', name: 'Task' }] }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: '200', key: 'WEB-1' }), { status: 201 }))
      await expect(createJiraIssue('access', { ...input, siteUrl })).rejects.toThrow('jira_site_invalid')
    }
  })

  it('uses the preferred terminal transition and adds the rejection comment atomically', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ fields: { status: { statusCategory: { key: 'indeterminate' } } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ transitions: [
        { id: 'close', name: 'Close', to: { statusCategory: { key: 'done' } } },
        { id: 'reject', name: 'Reject feedback', to: { statusCategory: { key: 'done' } } },
        { id: 'progress', name: 'Start', to: { statusCategory: { key: 'indeterminate' } } },
      ] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    await closeJiraIssue('access', {
      cloudId: 'cloud/id', issueId: '100/1', comment: 'Rejected', marker: '<!-- marker -->',
      beforeClose: async () => true,
    })
    expect(fetch.mock.calls[0]?.[0]).toContain('/cloud%2Fid/')
    expect(fetch.mock.calls[0]?.[0]).toContain('/100%2F1?fields=status')
    const body = JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))
    expect(body.transition).toEqual({ id: 'reject' })
    expect(body.update.comment[0].add.body).toMatchObject({ type: 'doc', version: 1 })
    expect(JSON.stringify(body)).toContain('marker')
  })

  it('does not duplicate the marker on a completed Jira issue', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ fields: { status: { statusCategory: { key: 'done' } } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ comments: [{ body: { content: [{ text: 'existing marker' }] } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await closeJiraIssue('access', { cloudId: 'cloud', issueId: '100', comment: 'Rejected', marker: 'marker' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('adds a missing marker to an already completed Jira issue', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ fields: { status: { statusCategory: { key: 'done' } } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ comments: [{ body: { content: [{ text: 'older' }] } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'comment' }), { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    await closeJiraIssue('access', {
      cloudId: 'cloud', issueId: '100', comment: 'Rejected', marker: 'marker', beforeClose: async () => true,
    })
    expect(fetch.mock.calls[2]?.[0]).toContain('/issue/100/comment')
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({ method: 'POST' })
  })

  it('treats a missing completed-issue comment collection as empty', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ fields: { status: { statusCategory: { key: 'done' } } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'comment' }), { status: 201 }))
    vi.stubGlobal('fetch', fetch)

    await expect(closeJiraIssue('access', {
      cloudId: 'cloud', issueId: '100', comment: 'Rejected', marker: 'marker',
    })).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('falls back to a sole done transition but rejects ambiguous or invalid workflows', async () => {
    const active = { fields: { status: { statusCategory: { key: 'new' } } } }
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(active), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ transitions: [{ id: 'done', name: 'Ship', to: { statusCategory: { key: 'done' } } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(active), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ transitions: [
        { id: 'one', name: 'Ship', to: { statusCategory: { key: 'done' } } },
        { id: 'two', name: 'Archive', to: { statusCategory: { key: 'done' } } },
      ] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ fields: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(active), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const input = { cloudId: 'cloud', issueId: '100', comment: 'Rejected', marker: 'marker' }
    await expect(closeJiraIssue('access', input)).resolves.toBeUndefined()
    await expect(closeJiraIssue('access', input)).rejects.toThrow('jira_rejection_transition_unavailable')
    await expect(closeJiraIssue('access', input)).rejects.toThrow('jira_issue_status_invalid')
    await expect(closeJiraIssue('access', input)).rejects.toThrow('jira_rejection_transition_unavailable')
  })

  it('skips transitions that require unsupported fields and reports when none are safe', async () => {
    const active = { fields: { status: { statusCategory: { key: 'new' } } } }
    const required = { customfield_1: { required: true, hasDefaultValue: false } }
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(active), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ transitions: [
        { id: 'reject', name: 'Reject', to: { statusCategory: { key: 'done' } }, fields: required },
        { id: 'close', name: 'Close', to: { statusCategory: { key: 'done' } }, fields: {} },
      ] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(active), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ transitions: [
        { id: 'reject', name: 'Reject', to: { statusCategory: { key: 'done' } }, fields: required },
      ] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const input = { cloudId: 'cloud', issueId: '100', comment: 'Rejected', marker: 'marker' }
    await closeJiraIssue('access', input)
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body)).transition).toEqual({ id: 'close' })
    await expect(closeJiraIssue('access', input)).rejects.toThrow('jira_transition_fields_required')
  })

  it('paginates completed-issue comments and cancels stale mutations', async () => {
    const done = { fields: { status: { statusCategory: { key: 'done' } } } }
    const firstPage = Array.from({ length: 100 }, () => ({ body: { content: [{ text: 'old' }] } }))
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(done), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ comments: firstPage, startAt: 0, total: 101 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ comments: [{ body: { content: [{ text: 'marker' }] } }], startAt: 100, total: 101 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(done), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ comments: [], isLast: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const input = { cloudId: 'cloud', issueId: '100', comment: 'Rejected', marker: 'marker' }
    await closeJiraIssue('access', input)
    expect(fetch.mock.calls[2]?.[0]).toContain('startAt=100')
    await expect(closeJiraIssue('access', { ...input, beforeClose: async () => false }))
      .rejects.toThrow('external_work_sync_cancelled')
    expect(fetch).toHaveBeenCalledTimes(5)
  })

  it('cancels before applying a Jira transition when rejection is stale', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ fields: { status: { statusCategory: { key: 'new' } } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ transitions: [
        { id: 'cancel', name: 'Cancel', to: { statusCategory: { key: 'done' } } },
      ] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    await expect(closeJiraIssue('access', {
      cloudId: 'cloud', issueId: '100', comment: 'Rejected', marker: 'marker', beforeClose: async () => false,
    })).rejects.toThrow('external_work_sync_cancelled')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('treats ambiguous Jira mutation transport as indeterminate', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ fields: { status: { statusCategory: { key: 'new' } } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ transitions: [{ id: 'cancel', name: 'Cancel', to: { statusCategory: { key: 'done' } } }] }), { status: 200 }))
      .mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetch)
    await expect(closeJiraIssue('access', { cloudId: 'cloud', issueId: '100', comment: 'Rejected', marker: 'marker' }))
      .rejects.toThrow('jira_result_indeterminate')
  })
})

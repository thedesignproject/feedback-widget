import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeGithubIssue,
  createCommentIssueMarker,
  createCommentRejectionMarker,
  createGithubIssue,
  findGithubIssueByMarker,
  formatEditableGithubIssueBody,
  formatGithubIssueBody,
} from './github-issues.js'

const originalSecret = process.env.WIDGET_AUTH_SECRET
const fetchMock = vi.fn()

beforeEach(() => {
  process.env.WIDGET_AUTH_SECRET = 'test-secret'
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  process.env.WIDGET_AUTH_SECRET = originalSecret
  vi.unstubAllGlobals()
})

const comment = {
  id: 'comment-1',
  body: 'Increase contrast',
  authorName: 'Ada',
  pageUrl: 'https://example.com/page?mode=dark',
  imageUrl: 'https://cdn.example.com/screenshot.png',
  selector: '#hero',
  x: 10,
  y: 20,
  targetType: 'text_range' as const,
  anchor: {
    selectedText: 'Read more',
    prefix: 'Click ',
    suffix: ' today',
    containerSelector: '#hero p',
    startOffset: 6,
    endOffset: 15,
    rangeClientRects: [{ left: 1, top: 2, width: 3, height: 4 }],
    createdAtViewport: { width: 1200, height: 800, scrollX: 0, scrollY: 50 },
  },
}
const content = {
  title: 'Improve hero contrast',
  summary: 'The hero call to action needs stronger contrast.',
  implementationContext: 'Review foreground and background tokens in the hero.',
}

describe('GitHub issue formatting', () => {
  it('creates a stable signed marker and complete Markdown', () => {
    const marker = createCommentIssueMarker(comment.id)
    expect(createCommentIssueMarker(comment.id)).toBe(marker)
    const body = formatGithubIssueBody(comment, content, marker)
    for (const value of [
      '## Summary', content.summary, '## Feedback', '— Ada', '## Screenshot',
      '## Page', '## Selected element', 'Selector: `#hero`', 'Coordinates: 10, 20',
      'Selected text: Read more', 'Start offset: 6', 'Client rectangles:',
      '## Implementation context', marker,
    ]) expect(body).toContain(value)
  })

  it('creates a stable signed rejection marker', () => {
    expect(createCommentRejectionMarker(comment.id)).toBe(createCommentRejectionMarker(comment.id))
    expect(createCommentRejectionMarker(comment.id)).toContain(`crrt-rejection:${comment.id}:`)
  })

  it('omits unavailable optional context', () => {
    const body = formatGithubIssueBody({
      ...comment,
      authorName: null,
      pageUrl: null,
      imageUrl: 'file:///secret.png',
      selector: null,
      x: null,
      y: null,
      targetType: '' as never,
      anchor: null,
    }, content, '<!-- marker -->')
    expect(body).not.toContain('## Screenshot')
    expect(body).not.toContain('## Page')
    expect(body).not.toContain('## Selected element')
    expect(body).not.toContain('— ')
  })

  it('rejects malformed URLs and missing marker configuration', () => {
    const body = formatGithubIssueBody({
      ...comment,
      pageUrl: 'not a URL',
      imageUrl: 'not a URL',
      anchor: null,
    }, content, '<!-- marker -->')
    expect(body).not.toContain('## Page')
    expect(body).toContain('Target type: text_range')
    delete process.env.WIDGET_AUTH_SECRET
    expect(() => createCommentIssueMarker(comment.id)).toThrow('missing_widget_auth_secret')
  })

  it('formats only present anchor values', () => {
    const body = formatGithubIssueBody({
      ...comment,
      anchor: { selectedText: '', prefix: null, startOffset: 0 },
    }, content, '<!-- marker -->')
    expect(body).toContain('Start offset: 0')
    expect(body).not.toContain('Selected text:')
    expect(body).not.toContain('Prefix:')
    expect(body).not.toContain('Suffix:')
  })

  it('sanitizes embedded markers in an editable draft and appends the signed marker once', () => {
    const body = formatEditableGithubIssueBody('Custom body\n\n<!-- crrt-comment:copied:bad -->', '<!-- signed -->')
    expect(body).toBe('Custom body\n\n<!-- signed -->')
    expect(() => formatEditableGithubIssueBody('   ', '<!-- signed -->')).toThrow('github_issue_body_invalid')
    expect(() => formatEditableGithubIssueBody('x'.repeat(65_536), '<!-- signed -->'))
      .toThrow('github_issue_content_too_large')
  })
})

describe('GitHub issue requests', () => {
  it('closes an issue as not planned and posts one marked explanation', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('[]', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 201 }))
    await closeGithubIssue({
      accessToken: 'token', owner: 'acme', repo: 'site', issueNumber: 7,
      comment: 'Rejected in CRRT.', marker: '<!-- rejection -->',
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ state: 'closed', state_reason: 'not_planned' })
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).body).toContain('<!-- rejection -->')

    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ body: 'Already <!-- rejection -->' }]), { status: 200 }))
    await closeGithubIssue({
      accessToken: 'token', owner: 'acme', repo: 'site', issueNumber: 7,
      comment: 'Rejected in CRRT.', marker: '<!-- rejection -->',
    })
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('paginates comments and cancels before the provider mutation when rejection is stale', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(Array.from({ length: 100 }, () => ({ body: 'old' }))), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ body: 'Already <!-- rejection -->' }]), { status: 200 }))
    await closeGithubIssue({
      accessToken: 'token', owner: 'acme', repo: 'site', issueNumber: 7,
      comment: 'Rejected in CRRT.', marker: '<!-- rejection -->', beforeClose: async () => true,
    })
    expect(fetchMock.mock.calls[2][0]).toContain('page=2')

    fetchMock.mockClear()
    await expect(closeGithubIssue({
      accessToken: 'token', owner: 'acme', repo: 'site', issueNumber: 7,
      comment: 'Rejected in CRRT.', marker: '<!-- rejection -->', beforeClose: async () => false,
    })).rejects.toThrow('external_work_sync_cancelled')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps GitHub close and comment failures safely', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }))
    await expect(closeGithubIssue({
      accessToken: 'token', owner: 'acme', repo: 'site', issueNumber: 7, comment: 'x', marker: 'm',
    })).rejects.toThrow('github_issue_close_failed')

    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
    await expect(closeGithubIssue({
      accessToken: 'token', owner: 'acme', repo: 'site', issueNumber: 7, comment: 'x', marker: 'm',
    })).rejects.toThrow('github_issue_comments_failed')

    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('[]', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
    await expect(closeGithubIssue({
      accessToken: 'token', owner: 'acme', repo: 'site', issueNumber: 7, comment: 'x', marker: 'm',
    })).rejects.toThrow('github_issue_comment_failed')
  })
  it('recovers an exact marker match and returns null without one', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      items: [{
        number: 42,
        html_url: 'https://github.com/acme/site/issues/42',
        created_at: '2026-07-23T12:00:00Z',
        body: 'body <!-- marker -->',
      }],
    }), { status: 200 }))
    await expect(findGithubIssueByMarker({
      accessToken: 'token',
      owner: 'acme',
      repo: 'site',
      marker: '<!-- marker -->',
    })).resolves.toMatchObject({ issueNumber: 42 })
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer token')

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
    await expect(findGithubIssueByMarker({
      accessToken: 'token', owner: 'acme', repo: 'site', marker: '<!-- none -->',
    })).resolves.toBeNull()
  })

  it('rejects ambiguous copied recovery markers', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      items: [
        { body: '<!-- marker -->', number: 1 },
        { body: 'copied <!-- marker -->', number: 2 },
      ],
    }), { status: 200 }))
    await expect(findGithubIssueByMarker({
      accessToken: 'token', owner: 'acme', repo: 'site', marker: '<!-- marker -->',
    })).rejects.toThrow('github_issue_recovery_ambiguous')
  })

  it('creates an issue and validates GitHub responses', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      number: 7,
      html_url: 'https://github.com/acme/site/issues/7',
      created_at: '2026-07-23T12:00:00Z',
    }), { status: 201 }))
    await expect(createGithubIssue({
      accessToken: 'token', owner: 'acme', repo: 'site', title: ' Title   here ', body: 'Body',
    })).resolves.toMatchObject({ issueNumber: 7 })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ title: 'Title here', body: 'Body' })

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Validation Failed' }), {
      status: 422,
      headers: { 'x-github-request-id': 'request-123' },
    }))
    await expect(createGithubIssue({
      accessToken: 'secret', owner: 'acme', repo: 'site', title: 'Title', body: 'Body',
    })).rejects.toThrow('github_issue_create_failed')
    expect(consoleError).toHaveBeenLastCalledWith('GitHub issue creation failed', {
      status: 422,
      providerMessage: 'Validation Failed',
      requestId: 'request-123',
    })

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 422 }), { status: 422 }))
    await expect(createGithubIssue({
      accessToken: 'secret', owner: 'acme', repo: 'site', title: 'Title', body: 'Body',
    })).rejects.toThrow('github_issue_create_failed')
    expect(consoleError).toHaveBeenLastCalledWith('GitHub issue creation failed', {
      status: 422,
      providerMessage: null,
      requestId: null,
    })

    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 500 }))
    await expect(createGithubIssue({
      accessToken: 'secret', owner: 'acme', repo: 'site', title: 'Title', body: 'Body',
    })).rejects.toThrow('github_issue_create_failed')
    expect(consoleError).toHaveBeenLastCalledWith('GitHub issue creation failed', {
      status: 500,
      providerMessage: null,
      requestId: null,
    })

    await expect(createGithubIssue({
      accessToken: 'secret',
      owner: 'acme',
      repo: 'site',
      title: 'Title',
      body: 'x'.repeat(65_537),
    })).rejects.toThrow('github_issue_content_too_large')

    await expect(createGithubIssue({
      accessToken: 'secret', owner: 'acme', repo: 'site', title: '   ', body: 'Body',
    })).rejects.toThrow('github_issue_title_invalid')

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      number: 7,
      html_url: 'javascript:alert(1)',
      created_at: '2026-07-23T12:00:00Z',
    }), { status: 201 }))
    await expect(createGithubIssue({
      accessToken: 'token', owner: 'acme', repo: 'site', title: 'Title', body: 'Body',
    })).rejects.toThrow('github_issue_result_indeterminate')
    consoleError.mockRestore()
  })

  it('caps oversized titles without splitting Unicode characters', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      number: 8,
      html_url: 'https://github.com/acme/site/issues/8',
      created_at: '2026-07-23T12:00:00Z',
    }), { status: 201 }))
    await createGithubIssue({
      accessToken: 'token',
      owner: 'acme',
      repo: 'site',
      title: '🚀'.repeat(130),
      body: 'Body',
    })
    const title = JSON.parse(fetchMock.mock.calls[0][1].body).title as string
    expect(Array.from(title)).toHaveLength(120)
    expect(title).toBe(`${'🚀'.repeat(119)}…`)
  })

  it('maps search, indeterminate responses, and network failures safely', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }))
    await expect(findGithubIssueByMarker({
      accessToken: 'secret', owner: 'acme', repo: 'site', marker: 'marker',
    })).rejects.toThrow('github_issue_search_failed')

    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 200 }))
    await expect(createGithubIssue({
      accessToken: 'secret', owner: 'acme', repo: 'site', title: 'Title', body: 'Body',
    })).rejects.toThrow('github_issue_result_indeterminate')

    fetchMock.mockRejectedValueOnce(new Error('includes secret'))
    await expect(createGithubIssue({
      accessToken: 'secret', owner: 'acme', repo: 'site', title: 'Title', body: 'Body',
    })).rejects.toThrow('github_issue_result_indeterminate')

    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 201 }))
    await expect(createGithubIssue({
      accessToken: 'secret', owner: 'acme', repo: 'site', title: 'Title', body: 'Body',
    })).rejects.toThrow('github_issue_result_indeterminate')

    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 200 }))
    await expect(findGithubIssueByMarker({
      accessToken: 'secret', owner: 'acme', repo: 'site', marker: 'marker',
    })).rejects.toThrow('github_issue_request_failed')

    fetchMock.mockRejectedValueOnce(new Error('includes secret'))
    await expect(findGithubIssueByMarker({
      accessToken: 'secret', owner: 'acme', repo: 'site', marker: 'marker',
    })).rejects.toThrow('github_issue_request_failed')
  })

  it('rejects malformed recovered issues', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      items: [{ body: 'marker', number: 'bad' }],
    }), { status: 200 }))
    await expect(findGithubIssueByMarker({
      accessToken: 'token', owner: 'acme', repo: 'site', marker: 'marker',
    })).rejects.toThrow('github_issue_search_failed')

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      items: [{
        body: 'marker', number: 7, html_url: 'https://evil.example/issues/7',
        created_at: '2026-07-23T12:00:00Z',
      }],
    }), { status: 200 }))
    await expect(findGithubIssueByMarker({
      accessToken: 'token', owner: 'acme', repo: 'site', marker: 'marker',
    })).rejects.toThrow('github_issue_search_failed')

    for (const htmlUrl of [
      'not a URL',
      'https://github.com/other/site/issues/7',
      'https://github.com/acme/other/issues/7',
      'https://github.com/acme/site/issues/8',
    ]) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ body: 'marker', number: 7, html_url: htmlUrl, created_at: '2026-07-23T12:00:00Z' }],
      }), { status: 200 }))
      await expect(findGithubIssueByMarker({
        accessToken: 'token', owner: 'acme', repo: 'site', marker: 'marker',
      })).rejects.toThrow('github_issue_search_failed')
    }
  })
})

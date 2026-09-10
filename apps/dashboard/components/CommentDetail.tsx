import { type ReactNode, useEffect, useRef, useState } from 'react'
import { getExternalWorkDraft, retryExternalWorkSync, sendExternalWork, type ExternalWorkDraft, type ExternalWorkProvider, type ExternalWorkRecord } from '../api'
import { cn } from '../lib/utils'
import { getDisplayStatus } from '../lib/comment'
import { timeAgo, truncateUrl } from '../lib/format'
import { asset } from '../lib/routes'
import { DISPLAY_STATUS_LABELS, type Comment } from '../lib/types'
import {
  BotIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CursorIcon,
  DoneIcon,
  ExternalLinkIcon,
  ImageOffIcon,
  SelectorIcon,
  XIcon,
} from './icons'
import { ActionBtn, Kbd } from './primitives'
import { ProjectEmptyState } from './ProjectEmptyState'
import { ExternalWorkDialog } from './ExternalWorkDialog'
import { ExternalWorkProviderDialog } from './ExternalWorkProviderDialog'

const providerLabel = (provider: ExternalWorkProvider) =>
  provider === 'github' ? 'GitHub' : provider === 'linear' ? 'Linear' : 'Jira'

function externalWorkRecord(provider: ExternalWorkProvider, value: {
  issueNumber?: number
  issueUrl?: string
  externalId?: string
  externalKey?: string
  externalUrl?: string
  createdAt: string
}) {
  const externalUrl = value.externalUrl ?? value.issueUrl
  const externalId = value.externalId ?? (value.issueNumber ? String(value.issueNumber) : undefined)
  const externalKey = value.externalKey ?? (value.issueNumber ? `#${value.issueNumber}` : undefined)
  if (!externalUrl || !externalId || !externalKey) return null
  return {
    provider,
    externalId,
    externalKey,
    externalUrl,
    lifecycleStatus: 'active',
    closedAt: null,
    createdAt: value.createdAt,
    updatedAt: value.createdAt,
  } satisfies ExternalWorkRecord
}

function lifecycleLabel(status: ExternalWorkRecord['lifecycleStatus']) {
  if (status === 'closing') return ' · Closing…'
  if (status === 'closed') return ' · Closed'
  if (status === 'failed') return ' · Close failed'
  if (status === 'blocked') return ' · Needs attention'
  return ''
}

function safeExternalWorkUrl(work: ExternalWorkRecord) {
  try {
    const url = new URL(work.externalUrl)
    if (url.protocol !== 'https:') return null
    if (work.provider === 'github') {
      return url.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/issues\/\d+\/?$/.test(url.pathname) ? url.toString() : null
    }
    if (work.provider === 'linear') {
      return url.hostname === 'linear.app' ? url.toString() : null
    }
    return url.hostname.endsWith('.atlassian.net') && /^\/browse\/[^/]+\/?$/.test(url.pathname) ? url.toString() : null
  } catch {
    return null
  }
}

function preferRememberedWork(server: ExternalWorkRecord, remembered: ExternalWorkRecord) {
  const terminal = (status: ExternalWorkRecord['lifecycleStatus']) => (
    status === 'closed' || status === 'failed' || status === 'blocked'
  )
  if (terminal(server.lifecycleStatus) && !terminal(remembered.lifecycleStatus)) return false
  if (terminal(remembered.lifecycleStatus) && !terminal(server.lifecycleStatus)) return true
  const serverTime = Date.parse(server.updatedAt)
  const rememberedTime = Date.parse(remembered.updatedAt)
  if (Number.isFinite(serverTime) && Number.isFinite(rememberedTime)) return rememberedTime > serverTime
  return remembered.lifecycleStatus !== 'active' || server.lifecycleStatus === 'active'
}

function syncRemediation(work: ExternalWorkRecord) {
  const provider = providerLabel(work.provider)
  if (work.syncAction === 'reconnect') return `Reconnect ${provider} in Project Settings, then retry.`
  if (work.syncAction === 'check_permissions') return `Grant ${provider} permission to update this issue, then retry.`
  if (work.syncAction === 'check_issue') return `Check that the ${provider} issue still exists and matches this project.`
  if (work.syncAction === 'configure_workflow') return `Configure a usable rejected or canceled workflow state in ${provider}, then retry.`
  return `Resolve the ${provider} issue configuration, then retry.`
}

interface CommentDetailProps {
  selectedComment: Comment | null
  selectedProject: string
  commentsLoading: boolean
  commentsError: string | null
  projectComments: Comment[]
  filteredComments: Comment[]
  selectedIdx: number
  goPrev: () => void
  goNext: () => void
  toggleReview: (c: Comment, target: 'accepted' | 'rejected') => void
  handleToggleDone: (id: string) => void
  onVisibilityChange?: (id: string, visibility: 'shared' | 'internal') => void
  apiBase: string
  accessToken: string
  personal?: false
  readOnly?: boolean
  bodyEditor?: ReactNode
  personalActions?: ReactNode
}

type PersonalDetailProps = Omit<CommentDetailProps, 'personal' | 'toggleReview' | 'handleToggleDone'> & { personal: true; toggleReview?: never; handleToggleDone?: never }

export function CommentDetail({
  selectedComment,
  selectedProject,
  commentsLoading,
  commentsError,
  projectComments,
  filteredComments,
  selectedIdx,
  goPrev,
  goNext,
  toggleReview,
  handleToggleDone,
  onVisibilityChange,
  apiBase,
  accessToken,
  personal = false,
  readOnly = false,
  bodyEditor,
  personalActions,
}: CommentDetailProps | PersonalDetailProps) {
  const [issueBusy, setIssueBusy] = useState(false)
  const [issueError, setIssueError] = useState<string | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [createdExternalWork, setCreatedExternalWork] = useState<Record<string, ExternalWorkRecord[]>>({})
  const [externalWorkDraft, setExternalWorkDraft] = useState<ExternalWorkDraft | null>(null)
  const [providerPickerOpen, setProviderPickerOpen] = useState(false)
  const issueRequests = useRef(new Map<string, symbol>())
  const syncRequests = useRef(new Set<string>())
  const selectedId = selectedComment?.id ?? null
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const linkedExternalWork = selectedComment ? (() => {
    const byProvider = new Map((selectedComment.externalWork ?? []).map((work) => [work.provider, work]))
    if (selectedComment.githubIssue && !byProvider.has('github')) {
      byProvider.set('github', {
        provider: 'github',
        externalId: String(selectedComment.githubIssue.issueNumber),
        externalKey: `#${selectedComment.githubIssue.issueNumber}`,
        externalUrl: selectedComment.githubIssue.issueUrl,
        lifecycleStatus: 'active',
        closedAt: null,
        createdAt: selectedComment.githubIssue.createdAt,
        updatedAt: selectedComment.githubIssue.createdAt,
      })
    }
    for (const work of createdExternalWork[selectedComment.id] ?? []) {
      const server = byProvider.get(work.provider)
      if (!server || preferRememberedWork(server, work)) byProvider.set(work.provider, work)
    }
    return [...byProvider.values()]
  })() : []

  const rememberExternalWork = (commentId: string, work: ExternalWorkRecord) => {
    setCreatedExternalWork((current) => ({
      ...current,
      [commentId]: [...(current[commentId] ?? []).filter((candidate) => candidate.provider !== work.provider), work],
    }))
  }

  const openExternalWork = (work: ExternalWorkRecord) => {
    const url = safeExternalWorkUrl(work)
    if (!url) {
      setIssueError(`Could not open the ${providerLabel(work.provider)} issue because its link is invalid.`)
      return
    }
    const opened = window.open(url, '_blank', 'noopener,noreferrer')
    if (opened) opened.opener = null
  }

  useEffect(() => {
    setIssueBusy(selectedId !== null && issueRequests.current.has(selectedId))
    setIssueError(null)
    setSyncBusy(selectedId !== null && syncRequests.current.has(selectedId))
    setExternalWorkDraft(null)
    setProviderPickerOpen(false)
  }, [selectedId])

  const prepareExternalWork = async (comment: Comment, provider: ExternalWorkProvider) => {
    const linked = linkedExternalWork.find((work) => work.provider === provider)
    if (linked) {
      openExternalWork(linked)
      return
    }
    if (comment.reviewStatus === 'rejected' || issueRequests.current.has(comment.id)) return
    const commentId = comment.id
    const request = Symbol(commentId)
    issueRequests.current.set(commentId, request)
    setIssueBusy(true)
    setIssueError(null)
    try {
      const prepared = await getExternalWorkDraft(apiBase, accessToken, commentId, provider)
      if (!prepared.connected) throw new Error(`${provider}_not_connected`)
      if (prepared.existing) {
        const remembered = externalWorkRecord(provider, prepared.existing)
        if (!remembered) throw new Error('missing_external_work_identity')
        rememberExternalWork(commentId, remembered)
        openExternalWork(remembered)
      } else if (selectedIdRef.current === commentId) {
        setExternalWorkDraft(prepared)
      }
    } catch {
      if (selectedIdRef.current === commentId) setIssueError(`Could not prepare the ${providerLabel(provider)} issue. Check Project Settings and try again.`)
    } finally {
      issueRequests.current.delete(commentId)
      if (selectedIdRef.current === commentId) setIssueBusy(false)
    }
  }

  const handleExternalWorkSubmit = async (draft: { title: string; body: string }) => {
    if (!selectedComment || issueBusy || issueRequests.current.has(selectedComment.id)) return
    const commentId = selectedComment.id
    const request = Symbol(commentId)
    issueRequests.current.set(commentId, request)
    setIssueBusy(true)
    setIssueError(null)
    try {
      // This handler is only mounted while a draft exists; request fencing above
      // prevents a stale dialog from dispatching a second submission.
      const provider = externalWorkDraft!.provider
      const result = await sendExternalWork(apiBase, accessToken, commentId, provider, draft)
      const url = result.externalUrl ?? result.issueUrl
      if (!url) throw new Error('missing_external_work_url')
      const remembered = externalWorkRecord(provider, result)
      if (!remembered) throw new Error('missing_external_work_identity')
      rememberExternalWork(commentId, remembered)
      setExternalWorkDraft(null)
      if (provider !== 'github') openExternalWork(remembered)
    } catch {
      if (selectedIdRef.current === commentId) {
        setIssueError('Could not create the external issue. Try again.')
      }
    } finally {
      issueRequests.current.delete(commentId)
      if (selectedIdRef.current === commentId) setIssueBusy(false)
    }
  }

  const retryExternalWork = async (comment: Comment) => {
    const commentId = comment.id
    if (syncRequests.current.has(commentId)) return
    syncRequests.current.add(commentId)
    setSyncBusy(true)
    setIssueError(null)
    try {
      const result = await retryExternalWorkSync(apiBase, accessToken, commentId)
      if (selectedIdRef.current === commentId) {
        setCreatedExternalWork((current) => ({ ...current, [commentId]: result.externalWork }))
      }
    } catch {
      if (selectedIdRef.current === commentId) setIssueError('Could not retry closing the linked issues. Try again.')
    } finally {
      syncRequests.current.delete(commentId)
      if (selectedIdRef.current === commentId) setSyncBusy(false)
    }
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-background">
      {selectedComment ? (
        <>
          <div className="flex items-center justify-between px-6 h-[44px] shrink-0 border-b border-border bg-card">
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono font-medium">#{selectedComment.id}</span>
              {selectedComment.pageUrl ? (
                <>
                  <span>·</span>
                  <span className="font-mono truncate" title={selectedComment.pageUrl}>{truncateUrl(selectedComment.pageUrl)}</span>
                </>
              ) : null}
              {!personal && <span>·</span>}
              {!personal && (() => {
                const ds = getDisplayStatus(selectedComment)
                return (
                  <span className={cn(
                    'font-semibold',
                    ds === 'ready' && 'text-status-accepted',
                    ds === 'rejected' && 'text-status-rejected',
                    ds === 'done' && 'text-status-done',
                    ds === 'open' && 'text-muted-foreground',
                  )}>
                    {DISPLAY_STATUS_LABELS[ds]}
                  </span>
                )
              })()}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div key={selectedComment.id} className="max-w-2xl mx-auto px-4 sm:px-8 py-8 detail-enter">
              {selectedComment.screenshotUrl ? (
                <div className="rounded-xl border border-border overflow-hidden mb-6 bg-muted/40 flex items-center justify-center">
                  <a
                    href={selectedComment.screenshotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <img
                      src={selectedComment.screenshotUrl}
                      alt={selectedComment.pageUrl
                        ? `Screenshot of ${selectedComment.pageUrl}`
                        : 'Feedback screenshot'}
                      className="max-w-full max-h-[520px] w-auto h-auto object-contain"
                      draggable={false}
                    />
                  </a>
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-card p-5 mb-6">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                      <ImageOffIcon size={16} className="text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">No screenshot captured</p>
                      {Number.isFinite(selectedComment.x) && Number.isFinite(selectedComment.y) && (
                        <p className="text-[11px] text-muted-foreground">
                          Pin placed at ({selectedComment.x}, {selectedComment.y})
                        </p>
                      )}
                    </div>
                  </div>
                  {selectedComment.selector && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/60 border border-border">
                      <SelectorIcon size={12} />
                      <code className="text-[12px] font-mono text-foreground/70 break-all">{selectedComment.selector}</code>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-start gap-3 mb-8">
                <div
                  className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white"
                  style={{ background: selectedComment.authorColor }}
                >
                  {selectedComment.authorInitial}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-foreground">{selectedComment.author}</span>
                    <span className="text-xs text-muted-foreground">{timeAgo(selectedComment.createdAt)}</span>
                  </div>
                  {bodyEditor ?? <p className="text-[15px] leading-relaxed text-foreground whitespace-pre-wrap break-words">
                    {selectedComment.body}
                  </p>}
                  {personal && <p className="mt-2 text-xs text-muted-foreground">Pin {selectedComment.x}%, {selectedComment.y}%</p>}
                  {selectedComment.targetType === 'text_range' && selectedComment.anchor ? (
                    <div className="mt-3">
                      <p className="text-[13px] leading-relaxed border-l-2 border-primary bg-muted/60 px-3 py-2 rounded-md">
                        <span className="text-muted-foreground">{selectedComment.anchor.prefix}</span>
                        <span className="text-foreground font-medium">{selectedComment.anchor.selectedText}</span>
                        <span className="text-muted-foreground">{selectedComment.anchor.suffix}</span>
                      </p>
                      <div className="mt-2 text-xs font-mono text-muted-foreground">
                        {selectedComment.anchor.containerSelector} · chars {selectedComment.anchor.startOffset}–{selectedComment.anchor.endOffset}
                      </div>
                    </div>
                  ) : selectedComment.selector ? (
                    <div className="mt-2 text-xs font-mono text-muted-foreground">
                      {selectedComment.selector}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="shrink-0 border-t border-border bg-card px-6 py-3">
            <div className="flex flex-wrap items-center gap-2 max-w-2xl mx-auto">
              {personalActions}
              {!personal && (
                readOnly ? (
                  <span className="inline-flex h-8 items-center rounded-full border border-border px-3 text-[11px] font-semibold text-muted-foreground">
                    Shared with project
                  </span>
                ) : (
                  <label className="inline-flex h-8 items-center gap-2 rounded-full border border-border px-3 text-[11px] font-semibold text-muted-foreground">
                    Audience
                    <select
                      aria-label="Feedback audience"
                      value={selectedComment.visibility ?? 'shared'}
                      onChange={(event) => onVisibilityChange?.(selectedComment.id, event.target.value as 'shared' | 'internal')}
                      className="bg-transparent text-foreground outline-none"
                    >
                      <option value="shared">Shared</option>
                      <option value="internal">Internal</option>
                    </select>
                  </label>
                )
              )}
              {!personal && !readOnly && <><ActionBtn
                active={selectedComment.reviewStatus === 'accepted' && selectedComment.implementationStatus !== 'done'}
                variant="accept"
                onClick={() => toggleReview!(selectedComment, 'accepted')}
                shortcut="A"
              >
                <BotIcon size={14} /> Ready for Agent
              </ActionBtn>
              <ActionBtn
                active={selectedComment.implementationStatus === 'done'}
                variant="done"
                onClick={() => handleToggleDone!(selectedComment.id)}
                shortcut="M"
              >
                <DoneIcon size={14} /> {selectedComment.implementationStatus === 'done' ? 'Done' : 'Mark Done'}
              </ActionBtn>
              <ActionBtn
                active={selectedComment.reviewStatus === 'rejected'}
                variant="reject"
                onClick={() => toggleReview!(selectedComment, 'rejected')}
                shortcut="D"
              >
                <XIcon size={14} /> Reject
              </ActionBtn>

              <div className="w-px h-5 bg-border mx-1" />
              </>}

              {selectedComment.pageUrl && (
                <ActionBtn variant="neutral" onClick={() => {
                  window.open(selectedComment.pageUrl!, '_blank', 'noopener,noreferrer')
                }}>
                  <ExternalLinkIcon size={13} /> Open page
                </ActionBtn>
              )}

              {linkedExternalWork.map((work) => (
                <ActionBtn key={work.provider} variant="neutral" onClick={() => openExternalWork(work)}>
                  <ExternalLinkIcon size={13} /> Open {providerLabel(work.provider)} {work.externalKey}{lifecycleLabel(work.lifecycleStatus)}
                </ActionBtn>
              ))}

              {selectedComment.reviewStatus === 'rejected' && linkedExternalWork
                .filter((work) => work.lifecycleStatus === 'blocked')
                .map((work) => (
                  <span key={`${work.provider}-remediation`} className="text-xs text-status-rejected">
                    {syncRemediation(work)}
                  </span>
                ))}

              {selectedComment.reviewStatus === 'rejected' && linkedExternalWork.some((work) => work.lifecycleStatus === 'failed') && (
                <ActionBtn variant="neutral" disabled={syncBusy} onClick={() => { void retryExternalWork(selectedComment) }}>
                  {syncBusy ? 'Retrying close…' : 'Retry closing'}
                </ActionBtn>
              )}

              {selectedComment.reviewStatus === 'rejected' && linkedExternalWork.some((work) => work.lifecycleStatus === 'blocked') && (
                <ActionBtn variant="neutral" disabled={syncBusy} onClick={() => { void retryExternalWork(selectedComment) }}>
                  {syncBusy ? 'Retrying close…' : 'Retry after fixing'}
                </ActionBtn>
              )}

              {!personal && !readOnly && <span
                className="relative inline-flex group"
              >
                <ActionBtn
                  variant="neutral"
                  onClick={() => setProviderPickerOpen(true)}
                  disabled={!selectedProject || selectedComment.reviewStatus === 'rejected' || issueBusy}
                >
                  <ExternalLinkIcon size={13} />
                  {issueBusy
                    ? 'Preparing issue…'
                    : selectedComment.reviewStatus === 'rejected'
                      ? 'Reopen to send'
                      : 'Send to…'}
                </ActionBtn>
              </span>}

              {issueError && !externalWorkDraft && (
                <span role="alert" className="text-xs text-status-rejected">{issueError}</span>
              )}

              <div className="flex-1" />

              <button
                onClick={goPrev}
                aria-label="Previous comment"
                disabled={selectedIdx <= 0}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronLeftIcon size={16} />
              </button>
              <span className="text-xs font-mono text-muted-foreground tabular-nums">
                {selectedIdx + 1}/{filteredComments.length}
              </span>
              <button
                onClick={goNext}
                aria-label="Next comment"
                disabled={selectedIdx >= filteredComments.length - 1}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronRightIcon size={16} />
              </button>
            </div>
          </div>
        </>
      ) : personal && !commentsLoading && !commentsError && projectComments.length === 0 ? (
        <div className="flex-1 overflow-y-auto px-8 py-8">
          <div className="min-h-full flex flex-col items-center justify-center text-center">
            <img src={asset('crrt-isologo.png')} alt="" width={48} height={48} className="mb-4 shrink-0" style={{ imageRendering: 'pixelated' }} />
            <h2 className="text-base font-semibold text-foreground mb-2">Try the CRRT extension</h2>
            <p className="text-sm text-muted-foreground max-w-sm mb-6">
              Comments you leave with the CRRT browser extension will appear here.
            </p>
            <ActionBtn variant="neutral" disabled>Coming soon</ActionBtn>
          </div>
        </div>
      ) : selectedProject && !commentsLoading && !commentsError && projectComments.length === 0 ? (
        <ProjectEmptyState projectId={selectedProject} />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
          <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <CursorIcon className="text-muted-foreground" />
          </div>
          <p className="text-base font-semibold text-foreground mb-1">{personal ? 'Select an extension comment' : 'Select a comment'}</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            {personal
              ? 'Pick one of your extension comments from the list to see its page context and screenshot.'
              : 'Pick a feedback item from the list to see the full context, screenshot, and actions.'}
          </p>
          {!personal && <div className="flex gap-3 mt-6 text-xs text-muted-foreground font-mono">
            <Kbd>J</Kbd><Kbd>K</Kbd> navigate
            <span className="mx-1">·</span>
            <Kbd>A</Kbd> ready
            <span className="mx-1">·</span>
            <Kbd>D</Kbd> reject
          </div>}
        </div>
      )}
      {externalWorkDraft && <ExternalWorkDialog
        key={selectedId}
        provider={externalWorkDraft.provider}
        destination={externalWorkDraft.destination ?? 'GitHub'}
        initialDraft={externalWorkDraft.draft}
        busy={issueBusy}
        error={issueError}
        onCancel={() => { setExternalWorkDraft(null); setIssueError(null) }}
        onSubmit={handleExternalWorkSubmit}
      />}
      {providerPickerOpen && <ExternalWorkProviderDialog
        onCancel={() => setProviderPickerOpen(false)}
        onSelect={(provider) => {
          setProviderPickerOpen(false)
          // The picker is only mounted for a selected comment and is closed by
          // the selection-change effect before a replacement render can use it.
          void prepareExternalWork(selectedComment!, provider)
        }}
      />}
    </div>
  )
}

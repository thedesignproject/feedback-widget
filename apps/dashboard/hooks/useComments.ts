import { useCallback, useEffect, useRef, useState } from 'react'
import { listComments, type CommentRecord } from '../api'
import { getMockComments, mocksEnabled } from '../lib/mocks'

export interface UseCommentsResult {
  comments: CommentRecord[]
  commentsProjectId: string | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useComments(apiBase: string, accessToken: string, projectId: string | null): UseCommentsResult {
  const [comments, setComments] = useState<CommentRecord[]>([])
  const [commentsProjectId, setCommentsProjectId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeProjectRef = useRef<string | null>(null)
  const refreshSequence = useRef(0)

  const loadComments = useCallback(async (background = false) => {
    const sequence = ++refreshSequence.current
    activeProjectRef.current = projectId

    if (!projectId) {
      setComments([])
      setCommentsProjectId(null)
      setLoading(false)
      return
    }
    if (!background) setLoading(true)
    setError(null)
    if (mocksEnabled) {
      setComments(getMockComments(projectId))
      setCommentsProjectId(projectId)
      setLoading(false)
      return
    }
    try {
      const data = await listComments(apiBase, accessToken, projectId)
      // Race guard: drop response if user switched projects mid-flight.
      if (activeProjectRef.current !== projectId || refreshSequence.current !== sequence) return
      setComments(data)
      setCommentsProjectId(projectId)
    } catch (err) {
      if (activeProjectRef.current !== projectId || refreshSequence.current !== sequence) return
      setError(err instanceof Error ? err.message : 'Failed to load comments')
    } finally {
      if (activeProjectRef.current === projectId && refreshSequence.current === sequence) setLoading(false)
    }
  }, [apiBase, accessToken, projectId])

  const refresh = useCallback(() => loadComments(), [loadComments])

  // Clear previous project's data before the next fetch lands.
  useEffect(() => {
    setComments([])
    setCommentsProjectId(null)
    setLoading(!!projectId)
  }, [projectId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Provider closure runs in the background after feedback is rejected. Poll
  // only while a link is transitional so the buttons settle without a reload.
  // A one-shot timer avoids overlapping requests; the next response schedules
  // another poll only when it still contains a `closing` link.
  useEffect(() => {
    const closing = comments.some((comment) => comment.externalWork?.some((work) => work.lifecycleStatus === 'closing'))
    if (!closing) return
    const timer = window.setTimeout(() => { void loadComments(true) }, 1_000)
    return () => window.clearTimeout(timer)
  }, [comments, loadComments])

  return { comments, commentsProjectId, loading, error, refresh }
}

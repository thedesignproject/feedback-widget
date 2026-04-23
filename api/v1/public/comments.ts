import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { setCors } from '../../_cors.js'

const SELECT_COLS = 'id, project_id, url, x, y, element, comment, status, created_at'
type ReviewStatus = 'open' | 'accepted' | 'rejected'

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_KEY
  if (!url || !key) throw new Error('Server misconfigured: missing Supabase credentials')
  return createClient(url, key)
}

function reviewStatusFromDb(value: unknown): ReviewStatus {
  if (value === 'approved' || value === 'accepted') return 'accepted'
  if (value === 'rejected') return 'rejected'
  return 'open'
}

function dbStatusFromReview(value: unknown) {
  if (value === 'open' || value === 'pending') return 'pending'
  if (value === 'accepted' || value === 'approved') return 'approved'
  if (value === 'rejected') return 'rejected'
  return null
}

function mapRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    projectId: row.project_id,
    pageUrl: row.url,
    selector: row.element,
    x: row.x,
    y: row.y,
    body: row.comment,
    reviewStatus: reviewStatusFromDb(row.status),
    createdAt: row.created_at,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method === 'GET') return handleGet(req, res)
  if (req.method === 'POST') return handlePost(req, res)
  if (req.method === 'PATCH') return handlePatch(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function handleGet(req: VercelRequest, res: VercelResponse) {
  try {
    const projectKey = typeof req.query.projectKey === 'string' ? req.query.projectKey : undefined
    if (!projectKey) return res.status(400).json({ error: 'Missing projectKey' })

    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('comments')
      .select(SELECT_COLS)
      .eq('project_id', projectKey)
      .order('created_at', { ascending: false })

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json((data || []).map(mapRow))
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unexpected error' })
  }
}

async function handlePatch(req: VercelRequest, res: VercelResponse) {
  try {
    const { id, reviewStatus, status, body, comment } = req.body ?? {}
    if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'Missing id' })

    const update: { status?: string; comment?: string } = {}
    const nextStatus = dbStatusFromReview(reviewStatus ?? status)
    if (nextStatus) update.status = nextStatus
    if (typeof body === 'string') update.comment = body
    if (typeof comment === 'string') update.comment = comment

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'Missing fields to update' })
    }

    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('comments')
      .update(update as never)
      .eq('id', id)
      .select(SELECT_COLS)

    if (error) return res.status(500).json({ error: error.message })
    if (!data || data.length === 0) return res.status(404).json({ error: 'Comment not found' })

    return res.status(200).json(mapRow(data[0]))
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unexpected error' })
  }
}

async function handlePost(req: VercelRequest, res: VercelResponse) {
  try {
    const { projectKey, projectId, pageUrl, selector, x, y, body } = req.body ?? {}
    const resolvedProjectKey = typeof projectKey === 'string' ? projectKey : projectId

    if (!resolvedProjectKey || !pageUrl || !selector || !body) {
      return res.status(400).json({ error: 'Missing required fields: projectKey, pageUrl, selector, body' })
    }

    if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
      return res.status(400).json({ error: 'x and y must be finite numbers' })
    }

    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('comments')
      .insert([{ project_id: resolvedProjectKey, url: pageUrl, x, y, element: selector, comment: body }] as never)
      .select(SELECT_COLS)

    if (error) return res.status(500).json({ error: error.message })
    if (!data || data.length === 0) return res.status(500).json({ error: 'Insert returned no row' })

    return res.status(201).json(mapRow(data[0]))
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unexpected error' })
  }
}

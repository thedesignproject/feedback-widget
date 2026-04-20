import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SMOKE_CLEANUP_HEADER = 'x-smoke-cleanup-token'
const SMOKE_PROJECT_PREFIX = 'smoke-'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase credentials' })
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  if (req.method === 'GET') return handleGet(req, res, supabase)
  if (req.method === 'POST') return handlePost(req, res, supabase)
  if (req.method === 'PATCH') return handlePatch(req, res, supabase)
  if (req.method === 'DELETE') return handleDelete(req, res, supabase)

  return res.status(405).json({ error: 'Method not allowed' })
}

async function handleGet(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient) {
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined

  if (!projectId) {
    return res.status(400).json({ error: 'Missing required query param: projectId' })
  }

  const { data, error } = await supabase
    .from('comments')
    .select('id, project_id, url, x, y, element, comment, status, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  return res.status(200).json(data ?? [])
}

async function handlePost(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient) {
  const { projectId, url, x, y, element, comment } = req.body ?? {}

  if (!projectId || !url || !element || !comment) {
    return res.status(400).json({
      error: 'Missing required fields: projectId, url, element, comment',
    })
  }

  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
    return res.status(400).json({ error: 'x and y must be finite numbers' })
  }

  // .select() forces Prefer: return=representation so the server sends
  // back the inserted row — or a 4xx if RLS blocked the write. Without
  // it, insert() uses Prefer: return=minimal and silently reports
  // success even when no row was stored.
  const { data, error } = await supabase
    .from('comments')
    .insert([{ project_id: projectId, url, x, y, element, comment }] as never)
    .select()

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  if (!data || data.length === 0) {
    return res.status(500).json({ error: 'Insert returned no row' })
  }

  return res.status(200).json({ success: true })
}

async function handlePatch(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient) {
  const { id, status, comment } = req.body ?? {}

  if (!id) {
    return res.status(400).json({ error: 'Missing required field: id' })
  }

  const updates: Record<string, string> = {}

  if (status) {
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status must be pending, approved, or rejected' })
    }
    updates.status = status
  }

  if (comment) {
    updates.comment = comment
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nothing to update' })
  }

  const { error } = await supabase
    .from('comments')
    .update(updates)
    .eq('id', id)

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  return res.status(200).json({ success: true })
}

// Two DELETE surfaces with deliberately different trust: ?id= is the reviewer
// sidebar (unauthenticated in v0, single row per call); ?projectId= is the
// smoke-cleanup path (token + smoke-* prefix required). See README Security.
async function handleDelete(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient) {
  const id = typeof req.query.id === 'string' ? req.query.id : undefined
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined

  if (id) {
    const { error } = await supabase.from('comments').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (projectId) {
    const cleanupToken = process.env.SMOKE_CLEANUP_TOKEN
    if (!cleanupToken) {
      return res.status(501).json({ error: 'Bulk DELETE disabled: SMOKE_CLEANUP_TOKEN not configured' })
    }
    const presented = req.headers[SMOKE_CLEANUP_HEADER]
    if (typeof presented !== 'string' || presented !== cleanupToken) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    if (!projectId.startsWith(SMOKE_PROJECT_PREFIX)) {
      return res.status(400).json({ error: `Bulk DELETE is scoped to ${SMOKE_PROJECT_PREFIX}* projectIds only` })
    }
    const { error } = await supabase.from('comments').delete().eq('project_id', projectId)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  return res.status(400).json({ error: 'Missing required query param: id or projectId' })
}

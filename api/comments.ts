import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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

  return res.status(405).json({ error: 'Method not allowed' })
}

async function handleGet(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient) {
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined

  if (!projectId) {
    return res.status(400).json({ error: 'Missing required query param: projectId' })
  }

  const { data, error } = await supabase
    .from('comments')
    .select('id, project_id, url, x, y, element, comment, created_at')
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

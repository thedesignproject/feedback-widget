import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const METHODS = ['GET', 'POST', 'OPTIONS']
const SELECT_COLS = 'id, project_id, url, x, y, element, comment, created_at'

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_KEY
  if (!url || !key) throw new Error('Server misconfigured: missing Supabase credentials')
  return createClient(url, key)
}

function setCors(req: VercelRequest, res: VercelResponse) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', METHODS.join(', '))
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
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
    reviewStatus: row.status ?? 'open',
    createdAt: row.created_at,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method === 'GET') return handleGet(req, res)
  if (req.method === 'POST') return handlePost(req, res)
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


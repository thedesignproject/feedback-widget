import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(204).setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type')
      .end()
  }

  if (req.method !== 'GET') {
    return res.status(405).set(cors).json({ error: 'Method not allowed' })
  }

  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined

  if (!projectId) {
    return res.status(400).set(cors).json({
      error: 'Missing required query param: projectId',
    })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).set(cors).json({ error: 'Server misconfigured: missing Supabase credentials' })
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  const { data, error } = await supabase
    .from('comments')
    .select('id, project_id, url, x, y, element, comment, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) {
    return res.status(500).set(cors).json({ error: error.message })
  }

  return res.status(200).set(cors).json(data ?? [])
}

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(204).setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type')
      .end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { projectId, url, x, y, element, comment } = req.body ?? {}

  if (!projectId || !url || x == null || y == null || !element || !comment) {
    return res.status(400).set(cors).json({
      error: 'Missing required fields: projectId, url, x, y, element, comment',
    })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).set(cors).json({ error: 'Server misconfigured: missing Supabase credentials' })
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  const { error } = await supabase.from('comments').insert([
    {
      project_id: projectId,
      url,
      x,
      y,
      element,
      comment,
    },
  ] as never)

  if (error) {
    return res.status(500).set(cors).json({ error: error.message })
  }

  return res.status(200).set(cors).json({ success: true })
}

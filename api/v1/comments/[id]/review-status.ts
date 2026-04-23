import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const VALID_STATUSES: Record<string, string> = {
  open: 'pending',
  accepted: 'approved',
  rejected: 'rejected',
}

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_KEY
  if (!url || !key) throw new Error('Server misconfigured: missing Supabase credentials')
  return createClient(url, key)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const id = typeof req.query.id === 'string' ? req.query.id : undefined
    if (!id) return res.status(400).json({ error: 'Missing comment id' })

    const { reviewStatus } = req.body ?? {}
    if (typeof reviewStatus !== 'string' || !VALID_STATUSES[reviewStatus]) {
      return res.status(400).json({ error: `reviewStatus must be one of: ${Object.keys(VALID_STATUSES).join(', ')}` })
    }

    const supabase = getSupabase()
    const { error } = await supabase
      .from('comments')
      .update({ status: VALID_STATUSES[reviewStatus] })
      .eq('id', id)

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ success: true })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unexpected error' })
  }
}

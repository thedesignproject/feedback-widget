import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const hasClient = typeof createClient === 'function'
  res.status(200).json({ ok: true, step: 'imports-supabase-directly', hasClient })
}

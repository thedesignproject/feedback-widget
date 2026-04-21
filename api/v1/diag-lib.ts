import type { VercelRequest, VercelResponse } from '@vercel/node'
import { setCors } from '../_lib/http'

export default function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res, ['GET'])
  res.status(200).json({ ok: true, step: 'imports-from-_lib-http' })
}

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { setCors } from '../../lib/http'

export default function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res, ['GET'])
  res.status(200).json({ ok: true, step: 'imports-lib-http-new-location' })
}

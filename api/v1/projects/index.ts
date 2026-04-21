import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireReviewer } from '../../_lib/auth.js'
import { handleOptions, jsonError, methodNotAllowed, setCors } from '../../_lib/http.js'
import { listProjects } from '../../_lib/store.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, ['GET', 'OPTIONS'])) return
  if (req.method !== 'GET') return methodNotAllowed(req, res, ['GET', 'OPTIONS'])
  if (!requireReviewer(req, res)) return

  try {
    const projects = await listProjects()
    setCors(req, res, ['GET', 'OPTIONS'])
    return res.status(200).json(projects)
  } catch (error) {
    return jsonError(req, res, 500, error instanceof Error ? error.message : 'Unexpected error')
  }
}


import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getStringQuery, handleOptions, jsonError, methodNotAllowed, setCors } from '../../../../_lib/http.js'
import { getLatestShareRevision, getProject, getRepoConfig, listCommentsForShare, listLivePresence } from '../../../../_lib/store.js'
import { requireAgentShare } from '../../../../_lib/shares.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, ['GET', 'OPTIONS'])) return
  if (req.method !== 'GET') return methodNotAllowed(req, res, ['GET', 'OPTIONS'])

  try {
    const slug = getStringQuery(req.query.slug)
    if (!slug) return jsonError(req, res, 400, 'Missing slug')

    const authorized = await requireAgentShare(req, res, slug)
    if (!authorized) return

    const project = await getProject(authorized.share.projectId)
    if (!project) return jsonError(req, res, 404, 'Project not found')

    const repoConfig = await getRepoConfig(project.publicKey)
    const comments = await listCommentsForShare(authorized.share)
    const revision = await getLatestShareRevision(authorized.share.id)
    const cutoff = new Date(Date.now() - 90_000).toISOString()
    const presence = await listLivePresence(authorized.share.id, cutoff)

    setCors(req, res, ['GET', 'OPTIONS'])
    return res.status(200).json({
      share: {
        id: authorized.share.id,
        slug: authorized.share.slug,
        scopeType: authorized.share.scopeType,
        scopePageUrl: authorized.share.scopePageUrl,
        expiresAt: authorized.share.expiresAt,
        revision,
      },
      project: {
        publicKey: project.publicKey,
        slug: project.slug,
        name: project.name,
        repoUrl: repoConfig?.repoUrl || null,
        localPath: repoConfig?.localPath || null,
        defaultBranch: repoConfig?.defaultBranch || 'main',
        installCommand: repoConfig?.installCommand || 'Not configured',
        devCommand: repoConfig?.devCommand || null,
        testCommand: repoConfig?.testCommand || null,
        buildCommand: repoConfig?.buildCommand || null,
        agentInstructions: repoConfig?.agentInstructions || null,
      },
      comments,
      presence,
      capabilities: {
        presence: true,
        ops: true,
      },
    })
  } catch (error) {
    return jsonError(req, res, 500, error instanceof Error ? error.message : 'Unexpected error')
  }
}


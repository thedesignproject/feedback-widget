interface RepoConfig {
  repoUrl: string | null
  localPath: string | null
  defaultBranch: string | null
  installCommand: string | null
  devCommand: string | null
  testCommand: string | null
  buildCommand: string | null
  agentInstructions: string | null
}

interface PromptInput {
  appUrl: string
  slug: string
  token: string
  pageUrl: string | null
  projectKey: string
  projectName: string
  repoConfig: RepoConfig | null
}

function buildBody(input: PromptInput) {
  const base = input.appUrl.replace(/\/$/, '')
  const bridge = `${base}/api/v1/agent/shares/${input.slug}`
  const docUrl = `${base}/?fw_share=${encodeURIComponent(input.slug)}&token=${encodeURIComponent(input.token)}`
  const skillUrl = `${base}/skill.md`
  const docsUrl = `${base}/agent-docs`
  const bugUrl = `${base}/api/bridge/report_bug`

  const repoLines: string[] = []
  if (input.repoConfig?.repoUrl || input.repoConfig?.localPath || input.repoConfig?.installCommand) {
    repoLines.push('Project + repo:')
    repoLines.push(`- Project: ${input.projectName} (${input.projectKey})`)
    if (input.repoConfig?.localPath) repoLines.push(`- Local path: ${input.repoConfig.localPath}`)
    if (input.repoConfig?.repoUrl) repoLines.push(`- Repo URL: ${input.repoConfig.repoUrl}`)
    if (input.repoConfig?.defaultBranch) repoLines.push(`- Default branch: ${input.repoConfig.defaultBranch}`)
    if (input.repoConfig?.installCommand) repoLines.push(`- Install: ${input.repoConfig.installCommand}`)
    if (input.repoConfig?.devCommand) repoLines.push(`- Dev: ${input.repoConfig.devCommand}`)
    if (input.repoConfig?.testCommand) repoLines.push(`- Test: ${input.repoConfig.testCommand}`)
    if (input.repoConfig?.buildCommand) repoLines.push(`- Build: ${input.repoConfig.buildCommand}`)
    if (input.repoConfig?.agentInstructions) repoLines.push(`- Extra: ${input.repoConfig.agentInstructions}`)
    if (input.pageUrl) repoLines.push(`- Scoped page: ${input.pageUrl}`)
  } else {
    repoLines.push(`Project: ${input.projectName} (${input.projectKey})`)
    if (input.pageUrl) repoLines.push(`Scoped page: ${input.pageUrl}`)
  }

  return [
    'Feedback Widget is a visual feedback system: humans drop comments pinned to real pixels on live pages, and you implement the accepted ones.',
    '',
    'Join this session immediately so the human can see your presence:',
    docUrl,
    '',
    '1. Announce your presence. Read token from the URL above.',
    `   POST ${bridge}/presence`,
    '   Authorization: Bearer <token>   (or X-Share-Token: <token>, or ?token=<token>)',
    '   X-Agent-Id: <stable-agent-id>',
    '   Body: {"status":"reading","summary":"Connecting"}',
    '',
    '2. Read state and reply: Connected to Feedback Widget and ready.',
    `   GET ${bridge}/state`,
    '',
    '3. For deeper interaction, fetch:',
    `   Skill: ${skillUrl}`,
    `   Docs:  ${docsUrl}`,
    '',
    '4. If the API fails in a surprising way:',
    `   POST ${bugUrl}`,
    '   Include a short summary, raw request/response, and any request IDs.',
    '',
    'Working rules:',
    '- Only work on comments whose reviewStatus is "accepted".',
    '- Claim a comment before editing: POST /ops with op:"comment.claim" and Idempotency-Key.',
    '- Report comment.start / comment.complete / comment.block as you work.',
    '- Never change reviewStatus — humans own it; you own implementationStatus only.',
    '- Refresh /state before starting the next item.',
    '',
    repoLines.join('\n'),
  ].join('\n')
}

export function buildPrompt(target: string, input: PromptInput) {
  const body = buildBody(input)

  if (target === 'claude-code') {
    return `You are Claude Code working on a Feedback Widget session.\n\n${body}`
  }

  if (target === 'codex') {
    return `You are Codex working on a Feedback Widget session.\n\n${body}`
  }

  return `You are a coding agent working on a Feedback Widget session.\n\n${body}`
}

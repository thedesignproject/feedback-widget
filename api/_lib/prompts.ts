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

function buildCommonBlock(input: PromptInput) {
  const baseUrl = `${input.appUrl}/api/v1/agent/shares/${input.slug}`
  const repoUrl = input.repoConfig?.repoUrl || 'Not configured'
  const localPath = input.repoConfig?.localPath || 'Not configured'
  const defaultBranch = input.repoConfig?.defaultBranch || 'main'
  const installCommand = input.repoConfig?.installCommand || 'Not configured'
  const devCommand = input.repoConfig?.devCommand || 'Not configured'
  const testCommand = input.repoConfig?.testCommand || 'Not configured'
  const buildCommand = input.repoConfig?.buildCommand || 'Not configured'
  const extraInstructions = input.repoConfig?.agentInstructions || 'None'

  return [
    `Project: ${input.projectName} (${input.projectKey})`,
    '',
    'Repo:',
    `- Local path: ${localPath}`,
    `- Repo URL: ${repoUrl}`,
    `- Default branch: ${defaultBranch}`,
    '',
    'Commands:',
    `- Install: ${installCommand}`,
    `- Dev: ${devCommand}`,
    `- Test: ${testCommand}`,
    `- Build: ${buildCommand}`,
    '',
    'Feedback session:',
    `- Page URL: ${input.pageUrl || 'Selection-scoped share'}`,
    `- State URL: ${baseUrl}/state`,
    `- Events URL: ${baseUrl}/events`,
    `- Presence URL: ${baseUrl}/presence`,
    `- Ops URL: ${baseUrl}/ops`,
    `- Bearer token: ${input.token}`,
    '',
    'Workflow:',
    '1. Fetch state with the bearer token.',
    '2. Post presence immediately when connected.',
    '3. Only work on comments whose reviewStatus is accepted.',
    '4. Claim before editing.',
    '5. If blocked, send comment.block with a short note.',
    '6. When done, send comment.complete with a validation note.',
    '7. Never change reviewStatus.',
    '8. Refresh state before starting the next item.',
    '',
    `Extra project instructions: ${extraInstructions}`,
  ].join('\n')
}

export function buildPrompt(target: string, input: PromptInput) {
  const common = buildCommonBlock(input)

  if (target === 'claude-code') {
    return [
      'You are Claude Code working against a Feedback Widget agent share.',
      '',
      common,
      '',
      'Use the share endpoints as the source of truth while you work in the repo.',
    ].join('\n')
  }

  if (target === 'codex') {
    return [
      'You are Codex working against a Feedback Widget agent share.',
      '',
      common,
      '',
      'Use the share endpoints as the source of truth while you work in the repo.',
    ].join('\n')
  }

  return [
    'You are a coding agent working against a Feedback Widget agent share.',
    '',
    common,
  ].join('\n')
}


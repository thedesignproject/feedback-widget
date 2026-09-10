import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  pgView,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// Row Level Security: every table below has RLS enabled with NO permissive
// policy (migration 0004_enable_rls), i.e. deny-all for the `anon` /
// `authenticated` roles. This is required because the publishable (anon) key
// ships in the dashboard bundle — without RLS anyone could query these tables
// directly via the Supabase REST API. The API reaches them through the
// service-role client (`getServiceSupabase`), which bypasses RLS and does its
// own authorization. `notifications` is the exception: it has a
// `notifications_select_own` policy (migration 0002) so the dashboard can
// subscribe to its own rows over realtime with the authenticated key.

export const projects = pgTable('projects', {
  publicKey: text('public_key').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  allowedOrigins: text('allowed_origins').array().notNull().default(sql`'{}'`),
  claimable: boolean('claimable').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// userId / invitedBy reference auth.users(id). Drizzle can't model the auth
// schema, so the FK is added in the migration SQL by hand (see DRIZZLE-GUIDE.md).
export const projectMembers = pgTable(
  'project_members',
  {
    projectKey: text('project_key')
      .notNull()
      .references(() => projects.publicKey, { onDelete: 'cascade' }),
    // References auth.users(id) ON DELETE CASCADE. Drizzle cannot model the
    // auth schema, so the generated migration adds this cross-schema FK.
    userId: uuid('user_id').notNull(),
    role: text('role').notNull(),
    isOwner: boolean('is_owner').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectKey, t.userId] }),
    userIdx: index('project_members_user_id_idx').on(t.userId),
    oneOwnerIdx: uniqueIndex('project_members_one_owner_idx')
      .on(t.projectKey)
      .where(sql`${t.isOwner}`),
    roleCheck: check('project_members_role_check', sql`${t.role} in ('admin', 'member', 'guest')`),
    ownerRoleCheck: check('project_members_owner_role_check', sql`not ${t.isOwner} or ${t.role} = 'admin'`),
  }),
)

// A GitHub App installation may be reused across multiple CRRT projects, and
// organization installations may be accessible to multiple CRRT users. Keep
// the private GitHub installation id behind an opaque row id and scope every
// runtime lookup by user_id.
export const githubUserInstallations = pgTable(
  'github_user_installations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').notNull(),
    installationId: text('installation_id').notNull(),
    githubAccountId: text('github_account_id').notNull(),
    githubAccountLogin: text('github_account_login').notNull(),
    githubAccountType: text('github_account_type').notNull(),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('github_user_installations_user_id_idx').on(t.userId),
    userInstallationUnique: uniqueIndex('github_user_installations_user_installation_unique')
      .on(t.userId, t.installationId),
    accountTypeCheck: check(
      'github_user_installations_account_type_check',
      sql`${t.githubAccountType} in ('User', 'Organization')`,
    ),
  }),
).enableRLS()

// Global super-admin allowlist. Membership grants cross-tenant read access
// through the `/api/v1/admin/*` endpoints. `user_id` references auth.users(id);
// as with project_members, Drizzle can't model the auth schema so that FK is
// added by hand in the migration SQL. Grant by inserting a row.
export const superAdmins = pgTable('super_admins', {
  userId: uuid('user_id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const projectInvites = pgTable(
  'project_invites',
  {
    projectKey: text('project_key')
      .notNull()
      .references(() => projects.publicKey, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull().default('member'),
    invitedBy: uuid('invited_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectKey, t.email] }),
    emailIdx: index('project_invites_email_idx').on(t.email),
    roleCheck: check('project_invites_role_check', sql`${t.role} in ('admin', 'member', 'guest')`),
    emailLowerCheck: check('project_invites_email_lower_check', sql`${t.email} = lower(${t.email})`),
  }),
)

// Reference only: not exported, so Drizzle does not manage Supabase's auth table.
const authUsers = pgSchema('auth').table('users', { id: uuid('id').primaryKey() })

export const projectRepoConfigs = pgTable('project_repo_configs', {
  projectKey: text('project_key')
    .primaryKey()
    .references(() => projects.publicKey, { onDelete: 'cascade' }),
  repoUrl: text('repo_url'),
  githubOwner: text('github_owner'),
  githubRepo: text('github_repo'),
  githubInstallationId: text('github_installation_id'),
  githubConnectionVersion: integer('github_connection_version').notNull().default(0),
  localPath: text('local_path'),
  defaultBranch: text('default_branch').notNull().default('main'),
  installCommand: text('install_command'),
  devCommand: text('dev_command'),
  testCommand: text('test_command'),
  buildCommand: text('build_command'),
  agentInstructions: text('agent_instructions'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// OAuth credentials for native issue-tracker integrations. Tokens are always
// encrypted by the API before they reach this table; RLS keeps the rows hidden
// from the publishable Supabase client shipped in browser bundles.
export const projectIntegrations = pgTable(
  'project_integrations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectKey: text('project_key').notNull().references(() => projects.publicKey, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    accessTokenCiphertext: text('access_token_ciphertext').notNull(),
    refreshTokenCiphertext: text('refresh_token_ciphertext'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    grantedScopes: text('granted_scopes'),
    workspaceId: text('workspace_id').notNull(),
    workspaceName: text('workspace_name').notNull(),
    containerId: text('container_id'),
    containerName: text('container_name'),
    createdBy: uuid('created_by').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectProviderUnique: uniqueIndex('project_integrations_project_provider_unique').on(t.projectKey, t.provider),
    providerCheck: check('project_integrations_provider_check', sql`${t.provider} in ('linear', 'jira')`),
  }),
).enableRLS()

export const projectCommentEmailCooldowns = pgTable('project_comment_email_cooldowns', {
  projectKey: text('project_key')
    .primaryKey()
    .references(() => projects.publicKey, { onDelete: 'cascade' }),
  pendingCount: integer('pending_count').notNull().default(0),
  cooldownUntil: timestamp('cooldown_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// A bounded rolling-hour ledger, independent of comment deletion. Versioned
// compare-and-swap updates through Supabase serialize concurrent reservations.
export const extensionCommentLimits = pgTable('extension_comment_limits', {
  userId: uuid('user_id').primaryKey().references(() => authUsers.id, { onDelete: 'cascade' }),
  attempts: timestamp('attempts', { withTimezone: true }).array().notNull().default(sql`'{}'::timestamptz[]`),
  version: uuid('version').notNull().default(sql`gen_random_uuid()`),
}).enableRLS()

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectId: text('project_id'),
    source: text('source').notNull().default('widget'),
    visibility: text('visibility').notNull().default('shared'),
    createdByUserId: uuid('created_by_user_id').references(() => authUsers.id, { onDelete: 'cascade' }),
    url: text('url'),
    pageHostname: text('page_hostname'),
    x: doublePrecision('x'),
    y: doublePrecision('y'),
    element: text('element'),
    comment: text('comment'),
    status: text('status').default('pending'),
    implementationStatus: text('implementation_status').default('unassigned'),
    claimedByAgentId: text('claimed_by_agent_id'),
    createdBy: text('created_by').default('public'),
    imageUrl: text('image_url'),
    screenshotStoragePath: text('screenshot_storage_path'),
    authorName: text('author_name'),
    // 'element_point' (click-to-pin) or 'text_range' (anchored to selected text)
    targetType: text('target_type').default('element_point'),
    // TextRangeAnchor JSON for text_range comments; null means no anchor
    anchor: jsonb('anchor'),
    githubIssueNumber: integer('github_issue_number'),
    githubIssueUrl: text('github_issue_url'),
    githubIssueCreatedAt: timestamp('github_issue_created_at', { withTimezone: true }),
    githubIssueLeaseToken: uuid('github_issue_lease_token'),
    githubIssueLeaseExpiresAt: timestamp('github_issue_lease_expires_at', { withTimezone: true }),
    githubIssueUncertainAt: timestamp('github_issue_uncertain_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    projectCreatedIdx: index('comments_project_created_idx').on(t.projectId, t.createdAt.desc()),
    projectUrlIdx: index('comments_project_url_idx').on(t.projectId, t.url, t.createdAt.desc()),
    projectStatusIdx: index('comments_project_status_idx').on(
      t.projectId,
      t.status,
      t.implementationStatus,
    ),
    extensionAuthorCreatedIdx: index('comments_extension_author_created_idx').on(
      t.createdByUserId,
      t.createdAt.desc(),
    ),
    extensionAuthorUrlIdx: index('comments_extension_author_url_idx').on(
      t.createdByUserId,
      t.url,
      t.createdAt.desc(),
    ),
    sourceCheck: check('comments_source_check', sql`${t.source} in ('widget', 'extension')`),
    visibilityCheck: check('comments_visibility_check', sql`${t.visibility} in ('shared', 'internal')`),
    extensionOwnershipCheck: check(
      'comments_extension_ownership_check',
      sql`${t.source} <> 'extension' or (${t.createdByUserId} is not null and ${t.pageHostname} is not null)`,
    ),
    githubIssueFieldsCheck: check(
      'comments_github_issue_fields_check',
      sql`(
        (${t.githubIssueNumber} is null and ${t.githubIssueUrl} is null and ${t.githubIssueCreatedAt} is null)
        or
        (${t.githubIssueNumber} > 0 and ${t.githubIssueUrl} is not null and ${t.githubIssueCreatedAt} is not null)
      )`,
    ),
    githubIssueLeaseCheck: check(
      'comments_github_issue_lease_check',
      sql`(
        (${t.githubIssueLeaseToken} is null and ${t.githubIssueLeaseExpiresAt} is null)
        or
        (${t.githubIssueLeaseToken} is not null and ${t.githubIssueLeaseExpiresAt} is not null)
      )`,
    ),
    githubIssueStateCheck: check(
      'comments_github_issue_state_check',
      sql`(
        (${t.githubIssueNumber} is null)
        or
        (${t.githubIssueLeaseToken} is null and ${t.githubIssueUncertainAt} is null)
      )`,
    ),
  }),
)

export const feedbackShares = pgTable(
  'feedback_shares',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.publicKey, { onDelete: 'cascade' }),
    scopeType: text('scope_type').notNull(),
    scopePageUrl: text('scope_page_url'),
    slug: text('slug').notNull().unique(),
    accessTokenHash: text('access_token_hash').notNull(),
    accessTokenCiphertext: text('access_token_ciphertext').notNull(),
    createdBy: text('created_by').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeTypeCheck: check(
      'feedback_shares_scope_type_check',
      sql`${t.scopeType} in ('page', 'selection', 'project')`,
    ),
    oneProjectScopePerProject: uniqueIndex('feedback_shares_one_project_scope_per_project')
      .on(t.projectId)
      .where(sql`scope_type = 'project' and revoked_at is null`),
  }),
)

export const feedbackShareItems = pgTable(
  'feedback_share_items',
  {
    shareId: uuid('share_id')
      .notNull()
      .references(() => feedbackShares.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.shareId, t.commentId] }),
  }),
)

export const feedbackEvents = pgTable(
  'feedback_events',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    shareId: uuid('share_id')
      .notNull()
      .references(() => feedbackShares.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id').references(() => comments.id, { onDelete: 'set null' }),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    shareIdIdx: index('feedback_events_share_id_idx').on(t.shareId, t.id),
  }),
)

export const agentPresence = pgTable(
  'agent_presence',
  {
    shareId: uuid('share_id')
      .notNull()
      .references(() => feedbackShares.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    status: text('status').notNull(),
    summary: text('summary'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.shareId, t.agentId] }),
    shareSeenIdx: index('agent_presence_share_seen_idx').on(t.shareId, t.lastSeenAt.desc()),
  }),
)

// In-app notification feed. user_id references auth.users(id); the FK is
// added by hand in the migration SQL (same pattern as projectMembers).
// RLS + supabase_realtime publication also configured by hand in that
// migration so the dashboard can subscribe with the anon key.
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userCreatedIdx: index('notifications_user_created_idx').on(t.userId, t.createdAt.desc()),
    unreadCommentActivityProjectIdx: uniqueIndex('notifications_unread_comment_activity_project_idx')
      .on(t.userId, sql`((payload->>'projectKey'))`)
      .where(sql`${t.kind} = 'comment.activity' and ${t.readAt} is null`),
    kindCheck: check(
      'notifications_kind_check',
      sql`${t.kind} in ('invite.received', 'invite.accepted', 'invite.declined', 'comment.activity') and (${t.kind} <> 'comment.activity' or nullif(btrim(${t.payload}->>'projectKey'), '') is not null)`,
    ),
  }),
)

export const feedbackOperationKeys = pgTable(
  'feedback_operation_keys',
  {
    shareId: uuid('share_id')
      .notNull()
      .references(() => feedbackShares.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    feedbackEventId: bigint('feedback_event_id', { mode: 'bigint' }).references(
      () => feedbackEvents.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.shareId, t.agentId, t.idempotencyKey] }),
  }),
)

// Durable Product Audit state. Runtime access is service-role-only; API
// handlers authenticate project members or verify an anonymous capability
// before reading or mutating these deny-all-RLS tables.
export const auditRuns = pgTable(
  'audit_runs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectKey: text('project_key').references(() => projects.publicKey, { onDelete: 'cascade' }),
    creatorUserId: uuid('creator_user_id'),
    ownerKind: text('owner_kind').notNull(),
    startIdempotencyKey: text('start_idempotency_key').notNull(),
    capabilityTokenHash: text('capability_token_hash'),
    anonymousSessionHash: text('anonymous_session_hash'),
    anonymousIpHash: text('anonymous_ip_hash'),
    inputUrl: text('input_url').notNull(),
    normalizedUrl: text('normalized_url').notNull(),
    mode: text('mode').notNull().default('live'),
    status: text('status').notNull().default('queued'),
    currentStage: text('current_stage').notNull().default('queued'),
    workflowRunId: text('workflow_run_id').unique(),
    budgets: jsonb('budgets').notNull().default(sql`'{}'::jsonb`),
    coverage: jsonb('coverage').notNull().default(sql`'{}'::jsonb`),
    unavailableSources: text('unavailable_sources').array().notNull().default(sql`'{}'`),
    sourceSnapshot: jsonb('source_snapshot').notNull().default(sql`'{}'::jsonb`),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    stageLeaseToken: uuid('stage_lease_token'),
    stageLeaseExpiresAt: timestamp('stage_lease_expires_at', { withTimezone: true }),
    retryNotBefore: timestamp('retry_not_before', { withTimezone: true }),
    stageAttempt: integer('stage_attempt').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectCreatedIdx: index('audit_runs_project_created_idx').on(t.projectKey, t.createdAt.desc()),
    anonymousSessionCreatedIdx: index('audit_runs_anonymous_session_created_idx')
      .on(t.anonymousSessionHash, t.createdAt.desc()),
    anonymousIpCreatedIdx: index('audit_runs_anonymous_ip_created_idx')
      .on(t.anonymousIpHash, t.createdAt.desc()),
    statusUpdatedIdx: index('audit_runs_status_updated_idx').on(t.status, t.updatedAt),
    expiresIdx: index('audit_runs_expires_idx').on(t.expiresAt),
    projectStartUnique: uniqueIndex('audit_runs_project_start_unique')
      .on(t.creatorUserId, t.startIdempotencyKey)
      .where(sql`${t.ownerKind} = 'project'`),
    anonymousStartUnique: uniqueIndex('audit_runs_anonymous_start_unique')
      .on(t.anonymousSessionHash, t.startIdempotencyKey)
      .where(sql`${t.ownerKind} = 'anonymous'`),
    ownerKindCheck: check(
      'audit_runs_owner_kind_check',
      sql`${t.ownerKind} in ('anonymous', 'project')`,
    ),
    ownerShapeCheck: check(
      'audit_runs_owner_shape_check',
      sql`(
        (${t.ownerKind} = 'project' and ${t.projectKey} is not null and ${t.creatorUserId} is not null)
        or
        (${t.ownerKind} = 'anonymous' and ${t.projectKey} is null and ${t.creatorUserId} is null
          and ${t.capabilityTokenHash} is not null and ${t.anonymousSessionHash} is not null
          and ${t.anonymousIpHash} is not null and ${t.expiresAt} is not null)
      )`,
    ),
    modeCheck: check('audit_runs_mode_check', sql`${t.mode} in ('local-fixture', 'live')`),
    statusCheck: check(
      'audit_runs_status_check',
      sql`${t.status} in ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')`,
    ),
    stageCheck: check(
      'audit_runs_stage_check',
      sql`${t.currentStage} in ('queued', 'explorer', 'critic', 'verifier', 'completed', 'failed', 'cancelled')`,
    ),
    leaseShapeCheck: check(
      'audit_runs_lease_shape_check',
      sql`(${t.stageLeaseToken} is null) = (${t.stageLeaseExpiresAt} is null)`,
    ),
  }),
).enableRLS()

// One durable result per feedback item and provider prevents normal retries
// from creating duplicate work in external trackers.
export const commentExternalWork = pgTable(
  'comment_external_work',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectId: text('project_id').notNull().references(() => projects.publicKey, { onDelete: 'cascade' }),
    commentId: uuid('comment_id').notNull().references(() => comments.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    state: text('state').notNull().default('creating'),
    workspaceId: text('workspace_id'),
    containerId: text('container_id'),
    externalId: text('external_id'),
    externalKey: text('external_key'),
    externalUrl: text('external_url'),
    leaseToken: uuid('lease_token').notNull(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }).notNull(),
    uncertainAt: timestamp('uncertain_at', { withTimezone: true }),
    lifecycleStatus: text('lifecycle_status').notNull().default('active'),
    syncLeaseToken: uuid('sync_lease_token'),
    syncLeaseExpiresAt: timestamp('sync_lease_expires_at', { withTimezone: true }),
    lastSyncError: text('last_sync_error'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    commentProviderUnique: uniqueIndex('comment_external_work_comment_provider_unique').on(t.commentId, t.provider),
    projectCreatedIdx: index('comment_external_work_project_created_idx').on(t.projectId, t.createdAt.desc()),
    providerCheck: check('comment_external_work_provider_check', sql`${t.provider} in ('github', 'linear', 'jira')`),
    stateCheck: check('comment_external_work_state_check', sql`${t.state} in ('creating', 'created')`),
    lifecycleCheck: check(
      'comment_external_work_lifecycle_check',
      sql`${t.lifecycleStatus} in ('active', 'closing', 'closed', 'failed', 'blocked')`,
    ),
    lifecycleLeaseCheck: check(
      'comment_external_work_lifecycle_lease_check',
      sql`(
        (${t.lifecycleStatus} = 'closing' and ${t.syncLeaseToken} is not null and ${t.syncLeaseExpiresAt} is not null)
        or
        (${t.lifecycleStatus} <> 'closing' and ${t.syncLeaseToken} is null and ${t.syncLeaseExpiresAt} is null)
      )`,
    ),
    creationLifecycleCheck: check(
      'comment_external_work_creation_lifecycle_check',
      sql`${t.state} = 'created' or ${t.lifecycleStatus} = 'active'`,
    ),
    closedAtCheck: check(
      'comment_external_work_closed_at_check',
      sql`(${t.lifecycleStatus} = 'closed') = (${t.closedAt} is not null)`,
    ),
    resultCheck: check('comment_external_work_result_check', sql`(
      (${t.state} = 'creating' and ${t.externalId} is null and ${t.externalKey} is null and ${t.externalUrl} is null)
      or
      (${t.state} = 'created' and ${t.externalId} is not null and ${t.externalKey} is not null and ${t.externalUrl} is not null)
    )`),
  }),
).enableRLS()

export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    auditId: uuid('audit_id').notNull().references(() => auditRuns.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    stage: text('stage'),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    auditSequenceIdx: index('audit_events_audit_sequence_idx').on(t.auditId, t.id),
    idempotencyUnique: uniqueIndex('audit_events_idempotency_unique').on(t.auditId, t.idempotencyKey),
    eventTypeCheck: check(
      'audit_events_type_check',
      sql`${t.eventType} in (
        'audit.queued', 'audit.stage.started', 'audit.stage.rate_limited', 'audit.evidence.captured',
        'audit.stage.completed', 'audit.coverage.partial', 'audit.finding.verified',
        'audit.completed', 'audit.failed', 'audit.cancelled'
      )`,
    ),
    actorTypeCheck: check(
      'audit_events_actor_type_check',
      sql`${t.actorType} in ('system', 'explorer', 'critic', 'verifier', 'user')`,
    ),
  }),
).enableRLS()

export const auditEvidence = pgTable(
  'audit_evidence',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    auditId: uuid('audit_id').notNull().references(() => auditRuns.id, { onDelete: 'cascade' }),
    evidenceKey: text('evidence_key').notNull(),
    source: text('source').notNull(),
    signalKey: text('signal_key').notNull(),
    kind: text('kind').notNull(),
    route: text('route').notNull(),
    element: text('element'),
    observation: text('observation').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    direct: boolean('direct').notNull(),
    provenance: jsonb('provenance').notNull().default(sql`'{}'::jsonb`),
    artifact: jsonb('artifact'),
    capture: jsonb('capture').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    auditEvidenceUnique: uniqueIndex('audit_evidence_audit_key_unique').on(t.auditId, t.evidenceKey),
    auditCreatedIdx: index('audit_evidence_audit_created_idx').on(t.auditId, t.createdAt),
    sourceCheck: check(
      'audit_evidence_source_check',
      sql`${t.source} in ('customer-rule', 'design-system', 'repository', 'url', 'heuristic')`,
    ),
    confidenceCheck: check(
      'audit_evidence_confidence_check',
      sql`${t.confidence} >= 0 and ${t.confidence} <= 1`,
    ),
  }),
).enableRLS()

export const auditCandidates = pgTable(
  'audit_candidates',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    auditId: uuid('audit_id').notNull().references(() => auditRuns.id, { onDelete: 'cascade' }),
    candidateKey: text('candidate_key').notNull(),
    payload: jsonb('payload').notNull(),
    decision: text('decision').notNull().default('pending'),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    auditCandidateUnique: uniqueIndex('audit_candidates_audit_key_unique').on(t.auditId, t.candidateKey),
    auditCreatedIdx: index('audit_candidates_audit_created_idx').on(t.auditId, t.createdAt),
    decisionCheck: check(
      'audit_candidates_decision_check',
      sql`${t.decision} in ('pending', 'admitted', 'rejected', 'merged')`,
    ),
  }),
).enableRLS()

export const auditFindings = pgTable(
  'audit_findings',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    auditId: uuid('audit_id').notNull().references(() => auditRuns.id, { onDelete: 'cascade' }),
    findingKey: text('finding_key').notNull(),
    rank: integer('rank').notNull(),
    status: text('status').notNull().default('open'),
    admittedBy: text('admitted_by').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    auditFindingUnique: uniqueIndex('audit_findings_audit_key_unique').on(t.auditId, t.findingKey),
    auditRankUnique: uniqueIndex('audit_findings_audit_rank_unique').on(t.auditId, t.rank),
    rankCheck: check('audit_findings_rank_check', sql`${t.rank} between 1 and 5`),
    statusCheck: check('audit_findings_status_check', sql`${t.status} = 'open'`),
    admittedByCheck: check(
      'audit_findings_admitted_by_check',
      sql`${t.admittedBy} in ('direct-evidence', 'independent-signals')`,
    ),
  }),
).enableRLS()

export const auditRateLimitWindows = pgTable(
  'audit_rate_limit_windows',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    identityKind: text('identity_kind').notNull(),
    identityHash: text('identity_hash').notNull(),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull().defaultNow(),
    requestCount: integer('request_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    identityUnique: uniqueIndex('audit_rate_limit_windows_identity_unique')
      .on(t.identityKind, t.identityHash),
    windowIdx: index('audit_rate_limit_windows_window_idx').on(t.windowStartedAt),
    identityKindCheck: check(
      'audit_rate_limit_windows_identity_kind_check',
      sql`${t.identityKind} in ('session', 'ip')`,
    ),
    requestCountCheck: check(
      'audit_rate_limit_windows_request_count_check',
      sql`${t.requestCount} >= 0`,
    ),
  }),
).enableRLS()

// Service-role-only projections used by the super-admin API. securityInvoker
// preserves the underlying tables' deny-all RLS for browser-visible roles.
export const adminUserMetrics = pgView('admin_user_metrics', {
  userId: uuid('user_id'),
  adminProjectCount: bigint('admin_project_count', { mode: 'number' }),
  memberProjectCount: bigint('member_project_count', { mode: 'number' }),
  superAdmin: boolean('super_admin'),
})
  .with({ securityInvoker: true })
  .as(sql`
    with user_ids as (
      select user_id from ${projectMembers}
      union
      select user_id from ${superAdmins}
    )
    select u.user_id,
      count(pm.project_key) filter (where pm.role = 'admin')::bigint as admin_project_count,
      count(pm.project_key) filter (where pm.role = 'member')::bigint as member_project_count,
      (sa.user_id is not null) as super_admin
    from user_ids u
    left join ${projectMembers} pm on pm.user_id = u.user_id
    left join ${superAdmins} sa on sa.user_id = u.user_id
    group by u.user_id, sa.user_id
  `)

export const adminProjectMetrics = pgView('admin_project_metrics', {
  publicKey: text('public_key'),
  name: text('name'),
  claimable: boolean('claimable'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  commentCount: bigint('comment_count', { mode: 'number' }),
  pendingCommentCount: bigint('pending_comment_count', { mode: 'number' }),
  acceptedCommentCount: bigint('accepted_comment_count', { mode: 'number' }),
  rejectedCommentCount: bigint('rejected_comment_count', { mode: 'number' }),
  unassignedCommentCount: bigint('unassigned_comment_count', { mode: 'number' }),
  claimedCommentCount: bigint('claimed_comment_count', { mode: 'number' }),
  inProgressCommentCount: bigint('in_progress_comment_count', { mode: 'number' }),
  blockedCommentCount: bigint('blocked_comment_count', { mode: 'number' }),
  doneCommentCount: bigint('done_comment_count', { mode: 'number' }),
  feedbackShareCount: bigint('feedback_share_count', { mode: 'number' }),
  commentedUrlCount: bigint('commented_url_count', { mode: 'number' }),
  firstCommentAt: timestamp('first_comment_at', { withTimezone: true }),
  lastCommentAt: timestamp('last_comment_at', { withTimezone: true }),
})
  .with({ securityInvoker: true })
  .as(sql`
    with comment_metrics as (
      select project_id,
        count(*)::bigint as comment_count,
        count(*) filter (where status is null or status not in ('approved', 'accepted', 'rejected'))::bigint as pending_comment_count,
        count(*) filter (where status in ('approved', 'accepted'))::bigint as accepted_comment_count,
        count(*) filter (where status = 'rejected')::bigint as rejected_comment_count,
        count(*) filter (where implementation_status is null or implementation_status = 'unassigned')::bigint as unassigned_comment_count,
        count(*) filter (where implementation_status = 'claimed')::bigint as claimed_comment_count,
        count(*) filter (where implementation_status = 'in_progress')::bigint as in_progress_comment_count,
        count(*) filter (where implementation_status = 'blocked')::bigint as blocked_comment_count,
        count(*) filter (where implementation_status = 'done')::bigint as done_comment_count,
        count(distinct url)::bigint as commented_url_count,
        min(created_at) as first_comment_at,
        max(created_at) as last_comment_at
      from ${comments}
      group by project_id
    ), share_metrics as (
      select project_id, count(*)::bigint as feedback_share_count
      from ${feedbackShares}
      group by project_id
    )
    select p.public_key, p.name, p.claimable, p.created_at,
      cm.comment_count, cm.pending_comment_count, cm.accepted_comment_count,
      cm.rejected_comment_count, cm.unassigned_comment_count,
      cm.claimed_comment_count, cm.in_progress_comment_count,
      cm.blocked_comment_count, cm.done_comment_count,
      coalesce(sm.feedback_share_count, 0)::bigint as feedback_share_count,
      cm.commented_url_count, cm.first_comment_at, cm.last_comment_at
    from ${projects} p
    join comment_metrics cm on cm.project_id = p.public_key
    left join share_metrics sm on sm.project_id = p.public_key
  `)

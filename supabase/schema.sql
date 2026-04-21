create extension if not exists pgcrypto;

create table if not exists projects (
  public_key text primary key,
  slug text not null unique,
  name text not null,
  allowed_origins text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_repo_configs (
  project_key text primary key references projects(public_key) on delete cascade,
  repo_url text,
  local_path text,
  default_branch text not null default 'main',
  install_command text,
  dev_command text,
  test_command text,
  build_command text,
  agent_instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  project_id text,
  url text,
  x float,
  y float,
  element text,
  comment text,
  status text default 'pending',
  created_at timestamptz default now()
);

alter table comments
  add column if not exists implementation_status text default 'unassigned';

alter table comments
  add column if not exists claimed_by_agent_id text;

alter table comments
  add column if not exists created_by text default 'public';

alter table comments
  add column if not exists updated_at timestamptz default now();

alter table comments
  add column if not exists status text default 'pending';

create table if not exists feedback_shares (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references projects(public_key) on delete cascade,
  scope_type text not null check (scope_type in ('page', 'selection')),
  scope_page_url text,
  slug text not null unique,
  access_token_hash text not null,
  access_token_ciphertext text not null,
  created_by text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists feedback_share_items (
  share_id uuid not null references feedback_shares(id) on delete cascade,
  comment_id uuid not null references comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (share_id, comment_id)
);

create table if not exists feedback_events (
  id bigint generated always as identity primary key,
  share_id uuid not null references feedback_shares(id) on delete cascade,
  comment_id uuid references comments(id) on delete set null,
  actor_type text not null,
  actor_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists agent_presence (
  share_id uuid not null references feedback_shares(id) on delete cascade,
  agent_id text not null,
  status text not null,
  summary text,
  last_seen_at timestamptz not null default now(),
  primary key (share_id, agent_id)
);

create table if not exists feedback_operation_keys (
  share_id uuid not null references feedback_shares(id) on delete cascade,
  agent_id text not null,
  idempotency_key text not null,
  feedback_event_id bigint references feedback_events(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (share_id, agent_id, idempotency_key)
);

create index if not exists comments_project_created_idx on comments (project_id, created_at desc);
create index if not exists comments_project_url_idx on comments (project_id, url, created_at desc);
create index if not exists comments_project_status_idx on comments (project_id, status, implementation_status);
create index if not exists feedback_events_share_id_idx on feedback_events (share_id, id);
create index if not exists agent_presence_share_seen_idx on agent_presence (share_id, last_seen_at desc);

insert into projects (public_key, slug, name, allowed_origins)
values (
  'demo-project',
  'demo-project',
  'Feedback Widget Demo',
  array[
    'http://localhost:5173',
    'http://localhost:4173',
    'http://localhost:5174',
    'http://localhost:4174'
  ]
)
on conflict (public_key) do update set
  slug = excluded.slug,
  name = excluded.name,
  allowed_origins = excluded.allowed_origins,
  updated_at = now();

insert into project_repo_configs (
  project_key,
  repo_url,
  local_path,
  default_branch,
  install_command,
  dev_command,
  test_command,
  build_command,
  agent_instructions
)
values (
  'demo-project',
  'https://github.com/thedesignproject/feedback-widget',
  '/workspace/feedback-widget',
  'main',
  'bun install',
  'bun run dev',
  'bun run test',
  'bun run build',
  'Keep the public widget lightweight. Do not reintroduce reviewer-only logic into the embed.'
)
on conflict (project_key) do update set
  repo_url = excluded.repo_url,
  local_path = excluded.local_path,
  default_branch = excluded.default_branch,
  install_command = excluded.install_command,
  dev_command = excluded.dev_command,
  test_command = excluded.test_command,
  build_command = excluded.build_command,
  agent_instructions = excluded.agent_instructions,
  updated_at = now();


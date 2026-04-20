-- Proyectos
create table projects (
  id uuid primary key default gen_random_uuid(),
  name text,
  created_at timestamp default now()
);

-- Comentarios
-- project_id is text (not uuid) so callers can use readable string IDs like "demo-project"
-- status is the reviewer sidebar state: pending (default) | approved | rejected
create table comments (
  id uuid primary key default gen_random_uuid(),
  project_id text,
  url text,
  x float,
  y float,
  element text,
  comment text,
  status text default 'pending',
  created_at timestamp default now()
);

-- Migration for existing databases that predate the status column.
-- Safe to run repeatedly.
alter table comments
  add column if not exists status text default 'pending';

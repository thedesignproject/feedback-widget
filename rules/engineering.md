# Engineering Rules

## Schema Changes

Source: `AGENTS.md:5-9`; `db/DRIZZLE-GUIDE.md:3-11`, `db/DRIZZLE-GUIDE.md:27-43`.

- Route every schema change through `db/schema.ts`; do not hand-write schema SQL as the source of truth.
- Before editing schema, read `db/DRIZZLE-GUIDE.md`.
- Generate migrations with `bun run db:generate`, then read the generated SQL before committing it.
- Commit `db/schema.ts`, the generated migration SQL, `db/migrations/meta/_journal.json`, and the new snapshot together.
- Treat applied migrations as immutable; do not edit or delete applied migration files.
- Keep migrations backwards-compatible; for renames, replace drop-and-add SQL with `ALTER TABLE ... RENAME COLUMN ...`.
- Do not run `db:push` against production or shared development databases.
- Keep `@supabase/supabase-js` as the runtime query layer; do not migrate `api/` query call sites to Drizzle's query builder.

## Legacy SQL

Source: `AGENTS.md:11-13`; `db/DRIZZLE-GUIDE.md:41`.

- Treat `supabase/legacy/` as a frozen historical record.
- Do not add new files under `supabase/legacy/`.
- Do not run legacy SQL files against any environment.

## Dashboard Routing

Source: `AGENTS.md:15-17`.

- The dashboard ships under `/dashboard/`; make in-app routes, links, and public assets base-aware.
- Use `route()` and `asset()` from `apps/dashboard/lib/routes.ts`.
- Do not hardcode absolute `/foo` paths in dashboard routes, links, or asset references.

## Diff Coverage

Source: `AGENTS.md:19-21`; `.claude/skills/diff-coverage/SKILL.md:1-24`.

- After any code change, invoke the repo-local `$diff-coverage` skill before handing work back.
- Require 100% diff line coverage against the current PR base.
- Require 100% diff branch coverage against the current PR base.
- For stacked PRs, check each layer against the branch immediately below it so tests from higher layers cannot mask gaps in lower layers.

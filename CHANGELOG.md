# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.7] - 2026-04-24

### Added
- `api/comments.ts` handles both `GET` and `POST` on one route.
- Handler unit tests (vitest) covering method dispatch, validation, and the silent-RLS failure mode.
- Widget unit tests (@testing-library/react + happy-dom) covering mount, fetch URL encoding, offline resilience, projectId refetch, and the full comment-submit path (POST body shape, duplicate-Send guard, failure-does-not-ghost).
- `getSelector` unit tests guarding the `INVALID_IDENT_CHARS` rename.
- `DELETE /api/comments?projectId=smoke-...` handler gated by a `SMOKE_CLEANUP_TOKEN` secret and scoped to `smoke-*` projectIds only. Smoke workflow uses it to remove its probe row after every round-trip.
- `.github/dependabot.yml` groups weekly dev / prod / actions updates so advisory churn does not drown signal.
- `scripts/bootstrap-branch-protection.sh` + `scripts/branch-protection.json` codify the required-checks rule so the protection config is reproducible from disk rather than tribal `gh api` lore.
- `consumer-smoke` job in the publish pipeline: `npm pack` the tarball, install it into a throwaway React 18 and React 19 app, and typecheck the import. Catches `exports` / `peerDependencies` / types mistakes that in-repo tests cannot.
- `npm run typecheck` script that type-checks `src/`, `api/`, and `demo/` together.
- `npm run test:coverage` script + v8 coverage reporter.
- GitHub Actions CI workflow:
  - `check (react 18)` / `check (react 19)` — matrix job running typecheck, tests-with-coverage, build, and a hard 50 KB ceiling on `dist/feedback-widget.es.js`.
  - `audit` — `npm audit --omit=dev --audit-level=high` fails on high/critical advisories in **shipped runtime** deps. Dev-tool advisories are tracked via Dependabot rather than blocking merges on upstream churn the maintainers cannot fix.
  - `secrets` — gitleaks (pinned by `sha256`) scans the full history for committed credentials.
  - Concurrency cancellation on repeat pushes to the same ref.
  - Node version pinned via `.nvmrc`.
- Smoke workflow (`.github/workflows/smoke.yml`): on every successful Production deployment, probes `environment_url` with a unique `smoke-<ts>-<sha>` projectId, asserts the POSTed row round-trips through GET (matched by the unique probe id, not a shared string), and deletes the probe row on exit via the gated DELETE endpoint.
- Publish workflow (`.github/workflows/publish.yml`): on `v*` tags, verifies the tag matches `package.json`, runs the full check pipeline, and publishes to npm with provenance. Requires `NPM_TOKEN` secret.
- Branch protection requires `check (react 18)`, `check (react 19)`, `audit`, and `secrets` to pass before merging to `main`.
- Vercel build runs `npm run typecheck` before `vite build`, so type errors in `api/` block deploys.
- README section describing the library-vs-demo repo layout and the reference backend.

### Changed
- **BREAKING:** `apiBase` is now a required prop on `<FeedbackWidget>`. Previously the library fell back to a hardcoded URL pointing at the maintainer's Vercel deployment, silently funneling every consumer's data into one shared backend. Consumers must now point at their own deployment.
- `api/comments.ts` uses `.insert([...]).select()` so the server sends back the inserted row. Without `.select()`, Supabase responds `201` with no body even when RLS blocks the write, causing silent data loss.
- `INVALID_CLASS_CHARS` → `INVALID_IDENT_CHARS` in `src/lib/getSelector.ts`; the regex applies to both id and class selectors.
- `peerDependencies` widened to `react@^18 || ^19`.

### Removed
- `api/comment.ts` (singular). Collapsed into `api/comments.ts` (plural) with method dispatch.
- `src/lib/supabase.ts` — unused dead code.
- `sent` state and `fw-pop` keyframe — dead code.
- Hardcoded `API_BASE` constant in the widget.

### Fixed
- `res.set()` calls that crashed every non-`OPTIONS` response path with `FUNCTION_INVOCATION_FAILED` on Vercel. `res.set()` is an Express-style method not implemented on `VercelResponse`. Removed; CORS headers are set globally by `vercel.json`.
- `handleSend` now awaits the fetch with a synchronous `sendingRef` guard, preventing duplicate submissions from rapid Cmd+Enter. Optimistic sidebar update only runs on HTTP success, so failed requests no longer leave ghost comments in the UI.
- `x` / `y` fields are validated as finite numbers on the server; non-numeric values now return a clean 400 instead of leaking the underlying Postgres error.

### Security
- Leaked Supabase anon key (committed in the initial commit and accidentally pushed) has been rotated. `.gitleaksignore` carries the single fingerprint for that historical blob so the `secrets` gate still fails on any *new* leak without re-firing on the rotated one. The blob remains in git history for traceability; only the live credential matters and that one is gone.
- Row Level Security is enabled on the `comments` and `projects` tables; the deployed API uses the `service_role` key to bypass RLS legitimately. Anon-key traffic to the DB is denied by default.

## [0.3.4] - 2026-04-13

Initial published prototype. See git history before the `1.0.0-pre` window for early changes.

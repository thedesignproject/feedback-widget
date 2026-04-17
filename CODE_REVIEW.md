# Full Repo Code Review

Review scope: entire `feedback-widget` repository. Findings are grouped by severity. Each item includes file paths and line numbers where applicable.

## CRITICAL

### 1. Supabase credentials in git history
Commit `858fe0c` contains a `.env` file with real credentials (`VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY`). The file was deleted in a later commit but is permanently recoverable via `git show 858fe0c:.env`.

**Action:** Rotate the keys immediately in the Supabase dashboard and scrub them from history with `git filter-repo` or BFG Repo Cleaner.

### 2. No Row Level Security (RLS) on `comments` table
`supabase/schema.sql` — no `ENABLE ROW LEVEL SECURITY`, no policies. Anyone with the anon key can `SELECT`, `INSERT`, `UPDATE`, or `DELETE` all comments across all projects. Zero tenant isolation.

**Action:** Enable RLS and add policies scoped by `project_id`.

## HIGH

### 3. `GET /api/comments` endpoint does not exist
`src/components/FeedbackWidget.tsx:68` fetches `${API_BASE}/comments?projectId=...` on mount, but only `api/comment.ts` (POST) exists. The sidebar is always empty on page load — comments only appear if submitted in the current session. The error is silently swallowed.

**Action:** Create `api/comments.ts` to handle the GET.

### 4. README documents non-existent props
`README.md` shows `supabaseUrl` and `supabaseKey` as props, but `FeedbackWidget` only accepts `projectId`. Those props are silently ignored. Users following the README get a false sense of controlling their data destination.

**Action:** Either implement the props or update the README to match the actual API.

### 5. Hardcoded API URL in distributed package
`src/components/FeedbackWidget.tsx:4` — `const API_BASE = 'https://feedback-widget-sigma.vercel.app/api'` is baked into the npm package. Every consumer sends user feedback to the maintainer's Vercel deployment with no way to override it.

**Action:** Expose `API_BASE` as a configurable prop.

### 6. `setSending(false)` runs before fetch resolves — duplicate submissions
`src/components/FeedbackWidget.tsx:181-216` — the `fetch` is fire-and-forget, and `setSending(false)` runs synchronously after it. The "Send" button is re-enabled instantly, allowing users to spam-submit the same comment.

**Action:** Await the fetch and flip `sending` after the response (or on error).

### 7. No auth, rate limiting, or size limits on the API
`api/comment.ts` — anyone can POST arbitrarily large payloads to any `projectId` with no authentication. Combined with missing RLS, the database can be trivially spammed or exhausted.

**Action:** Add rate limiting, input size caps, and consider a shared secret or signed request scheme.

### 8. `x`/`y` not validated as numbers
`api/comment.ts:22-28` — only checks `x == null || y == null`, not that they are numeric. Non-numeric values will cause a Postgres type error, and the raw error message is leaked to the caller (`error.message` on line 51).

**Action:** Validate `typeof x === 'number' && Number.isFinite(x)` (and same for `y`) before inserting.

## MEDIUM

### 9. CORS headers missing on 405 and 500 early-return responses
`api/comment.ts:19` and `:34` — the `cors` headers are applied to 200/400/500 responses but not to the 405 (wrong method) or the misconfiguration 500. Browsers will block these error responses cross-origin, hiding real error messages.

### 10. `sent` state is dead code
`src/components/FeedbackWidget.tsx:51` — `setSent(true)` is never called. The `!sent` condition on line 428 is always true. Likely a leftover from an earlier submission-confirmation flow. Either wire it up or remove it.

### 11. Dead ternary inside `!sidebarOpen` guard
`src/components/FeedbackWidget.tsx:671-677` — the trigger button is only rendered when `!sidebarOpen`, but the style computes `right: sidebarOpen ? 344 : 24`. Since `sidebarOpen` is always `false` here, the ternary is dead code.

### 12. `src/lib/supabase.ts` is unused dead code
Never imported anywhere. The singleton also has a subtle bug: subsequent calls with different credentials silently return the first client. Remove the file, or use it and fix the cache key.

### 13. `@supabase/supabase-js` bundled into library output
`vite.config.ts:19` — React is externalized but Supabase is not, so the entire Supabase client is compiled into the dist bundle. Since the widget uses the Vercel API (not Supabase directly), this dependency is unused bloat.

**Action:** Add `@supabase/supabase-js` to `rollupOptions.external`, or remove the dependency entirely.

### 14. Supabase error messages forwarded to clients
`api/comment.ts:51` — `error.message` can contain schema details (table names, constraints). Return a generic error and log internally.

## LOW

### 15. Unused `fw-pop` keyframe
`src/components/FeedbackWidget.tsx:779` — defined but never referenced.

### 16. `peerDependencies` says React 18, dev uses React 19
`package.json` — should be `"^18.0.0 || ^19.0.0"` to avoid spurious peer dep warnings in React 19 projects.

### 17. `plan.md` schema does not match actual schema
`plan.md` still describes `project_id` as UUID with FK, but it was migrated to `text` (see `supabase/migrate-project-id-to-text.sql`).

### 18. Misleading comment
`src/components/FeedbackWidget.tsx:218` — says "Show eye button with blue ring" but the button actually shows a red X in selecting mode.

### 19. `INVALID_CLASS_CHARS` name/comment is misleading
`src/lib/getSelector.ts:1-2` — used for both ID and class validation, not just classes. Rename or adjust the comment.

## Recommended priority

1. Rotate the leaked Supabase keys immediately — they are permanently in git history.
2. Enable RLS on the `comments` table.
3. Create the `GET /api/comments` endpoint — the sidebar is non-functional without it.
4. Make `API_BASE` configurable via props and fix the README to match the actual API.
5. Await the fetch in `handleSend` so the sending state is meaningful and duplicates are prevented.
6. Add basic validation (numeric `x`/`y`, string length limits) to the API endpoint.

# @thedesignproject/feedback-widget

Visual feedback capture for React sites, plus a private reviewer console and a Proof-style agent bridge.

## What changed

This repo is no longer just "a widget that stores comments."

It now has three product surfaces:

- **Public widget** in `src/`
  - capture feedback on any page
  - submit comments to the public ingestion API
- **Reviewer dashboard** in `apps/dashboard/`
  - triage comments
  - accept or reject feedback
  - create agent shares
  - copy prompts for Codex or Claude Code
- **Agent bridge API** in `api/v1/`
  - expose page-scoped or selection-scoped feedback to coding agents
  - track presence, events, and implementation updates

The old `/api/comments` route still exists as a compatibility path and for the smoke workflow. The new product flow uses `/api/v1/...`.

## Repo layout

- `src/`
  - published widget package
- `apps/dashboard/`
  - private reviewer UI
- `demo/`
  - public demo site for the widget
- `api/`
  - Vercel serverless API routes
- `supabase/`
  - schema and migrations

## Public widget

Install:

```bash
bun add @thedesignproject/feedback-widget
```

Usage:

```tsx
import { FeedbackWidget } from '@thedesignproject/feedback-widget'

export default function App() {
  return (
    <FeedbackWidget
      apiBase="https://your-deployment.example.com/api"
      projectId="demo-project"
    />
  )
}
```

Props:

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `apiBase` | `string` | yes | Base URL of the backend that serves the widget API. For this repo's Vercel functions, use `https://<your-deployment>/api`. |
| `projectId` | `string` | yes | Project public key used for comment capture. |

## API surfaces

### Public comments

The current widget calls these HTTP endpoints at `apiBase`:

- `GET /v1/public/comments?projectKey=...` returns page comments for compatibility with the in-page sidebar.
- `POST /v1/public/comments` creates a public comment.
- `PATCH /v1/public/comments` updates review status for current widget compatibility.

Create comment request:

```json
{
  "projectKey": "demo-project",
  "pageUrl": "https://example.com/pricing",
  "selector": "main > section:nth-of-type(2) button",
  "x": 540,
  "y": 220,
  "body": "This CTA feels too weak"
}
```

Patch status request:

```json
{
  "id": "comment-id",
  "reviewStatus": "accepted"
}
```

### Reviewer API

Protected by `REVIEWER_API_TOKEN`.

```text
GET   /api/v1/projects
GET   /api/v1/projects/:projectId/comments
PATCH /api/v1/comments/:commentId/review-status
POST  /api/v1/feedback-shares
GET   /api/v1/feedback-shares/:shareId/prompt
```

### Agent bridge

Protected by per-share bearer token.

```text
GET  /api/v1/agent/shares/:slug/state
GET  /api/v1/agent/shares/:slug/events
POST /api/v1/agent/shares/:slug/presence
POST /api/v1/agent/shares/:slug/ops
```

## Supabase schema

Run `supabase/schema.sql`. It creates or updates:

- `projects`
- `project_repo_configs`
- `comments`
- `feedback_shares`
- `feedback_share_items`
- `feedback_events`
- `agent_presence`
- `feedback_operation_keys`

The schema also seeds a `demo-project` project and repo config for local development.

## Environment variables

Example values live in `.env.example`.

Required server variables:

- `SUPABASE_URL`
- `SUPABASE_KEY`
- `REVIEWER_API_TOKEN`
- `SHARE_TOKEN_SECRET`

Optional server variables:

- `APP_URL` - fallback for generated links when no request host is available

Useful client variables:

- `VITE_API_BASE`
- `VITE_PROJECT_ID`
- `VITE_REVIEWER_TOKEN`

## Requirements

- React 18 or 19 on the consuming app.
- A backend implementing the endpoints above.

## Development

Install:

```bash
bun install
```

Run the public demo:

```bash
bun run dev
```

Run the reviewer dashboard:

```bash
bun run dev:dashboard
```

Build the widget package:

```bash
bun run build
```

Build the dashboard:

```bash
bun run build:dashboard
```

Run tests:

```bash
bun run test
```

Typecheck everything:

```bash
bun run typecheck
```

## Compatibility

The legacy route remains available:

```text
GET    /api/comments?projectId=...
POST   /api/comments
PATCH  /api/comments
DELETE /api/comments
```

That path is kept for backward compatibility and smoke validation. New product work should target `/api/v1/...`.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).

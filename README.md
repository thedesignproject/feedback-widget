# @thedesignproject/feedback-widget

Visual feedback tool for React projects. Your client visits their deployed URL, clicks any element, and leaves a comment. You see everything instantly.

## Repo layout

This repository contains two separate things:

- **`src/`** — the React library published to npm as `@thedesignproject/feedback-widget`. This is the product.
- **`demo/` + `api/` + `supabase/`** — a live demo hosted on Vercel and a **reference implementation** of the backend the library expects. Copy these into your own project as a starting point; they are not part of the published library.

The library talks to *your* backend, not ours. Only `projectId` and `apiBase` cross the library's boundary.

## Installation

```bash
bun add @thedesignproject/feedback-widget
```

## Usage

```jsx
import { FeedbackWidget } from '@thedesignproject/feedback-widget'

export default function App() {
  return (
    <>
      {/* your app */}
      <FeedbackWidget
        projectId="your-project-name"
        apiBase="https://your-deployment.example.com/api"
      />
    </>
  )
}
```

### Props

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | `string` | yes | Namespace for comments. All comments are scoped by this value. |
| `apiBase` | `string` | yes | Base URL of the backend that serves the widget API. For this repo's Vercel functions, use `https://<your-deployment>/api`. |

## Backend setup (reference implementation)

The current widget calls these HTTP endpoints at `apiBase`:

- `GET /v1/public/comments?projectKey=…` → returns `Comment[]` ordered by newest first.
- `POST /v1/public/comments` with JSON body `{ projectKey, pageUrl, x, y, selector, body }` → inserts a row and returns the created comment.
- `PATCH /v1/public/comments` with JSON body `{ id, reviewStatus?, body? }` → updates a comment (used by the reviewer sidebar for resolve / edit).

The reference backend also keeps a legacy `/comments` proxy for older widget versions:

- `GET /comments?projectId=…`
- `POST /comments` with JSON body `{ projectId, url, x, y, element, comment }`
- `PATCH /comments` with JSON body `{ id, status?, comment? }`

`api/v1/public/comments.ts` implements the current endpoint, and `api/comments.ts` proxies the legacy shape into it. Both are backed by Supabase Postgres. To stand up a copy:

1. Create a Supabase project and run `supabase/schema.sql` to create the `comments` table.
2. Enable Row Level Security on the `comments` table. With no policies defined, anon keys are denied everything by default — the API uses the `service_role` key which bypasses RLS.
3. Deploy the `api/` functions (e.g. to Vercel). Set two environment variables on the deployment:
   - `SUPABASE_URL` — your Supabase project URL.
   - `SUPABASE_KEY` — the **service_role** key (Supabase Dashboard → Settings → API). This key bypasses RLS and must never ship to a browser. Do not prefix it with `VITE_`.
4. Point the widget's `apiBase` prop at `https://<your-deployment>/api`.

This is one working setup, not the only one. Anything that implements the endpoints above (Next.js route handlers, Cloudflare Workers, a plain Express server) will work.

## Security

In v0, reviewer operations (`PATCH /comments`) are **unauthenticated**. Anyone who can reach `apiBase` and knows a comment's UUID can edit that row.

Until proper reviewer auth lands, deploy reviewer UIs (the sidebar) behind your own authentication layer — do not expose them on public pages. Tracked in [issue #28](https://github.com/thedesignproject/feedback-widget/issues/28).

## Requirements

- React 18 or 19 on the consuming app.
- A backend implementing the endpoints above.

## Development

```bash
bun install
bun run dev        # run the demo against a backend of your choice (configure via .env)
bun run test       # run the handler unit tests (vitest)
bun run typecheck  # run tsc across src/, api/, demo/
bun run build      # produce the dist/ library artifacts
```

CI runs typecheck + tests + build on every PR.

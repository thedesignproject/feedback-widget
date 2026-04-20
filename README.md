# @tosses/feedback-widget

Visual feedback tool for React projects. Your client visits their deployed URL, clicks any element, and leaves a comment. You see everything instantly.

## Repo layout

This repository contains two separate things:

- **`src/`** — the React library published to npm as `@tosses/feedback-widget`. This is the product.
- **`demo/` + `api/` + `supabase/`** — a live demo hosted on Vercel and a **reference implementation** of the backend the library expects. Copy these into your own project as a starting point; they are not part of the published library.

The library talks to *your* backend, not ours. Only `projectId` and `apiBase` cross the library's boundary.

## Installation

```bash
npm install @tosses/feedback-widget
```

## Usage

```jsx
import { FeedbackWidget } from '@tosses/feedback-widget'

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
| `apiBase` | `string` | yes | Base URL of the backend that serves `GET /comments` and `POST /comments`. |

## Backend setup (reference implementation)

The widget expects two HTTP endpoints at `apiBase`:

- `GET /comments?projectId=…` → returns `Comment[]` ordered by newest first.
- `POST /comments` with JSON body `{ projectId, url, x, y, element, comment }` → inserts a row and returns `{ success: true }`.

`api/comments.ts` in this repo implements both on a single Vercel serverless function backed by Supabase Postgres. To stand up a copy:

1. Create a Supabase project and run `supabase/schema.sql` to create the `comments` table.
2. Enable Row Level Security on the `comments` table. With no policies defined, anon keys are denied everything by default — the API uses the `service_role` key which bypasses RLS.
3. Deploy the `api/` functions (e.g. to Vercel). Set two environment variables on the deployment:
   - `SUPABASE_URL` — your Supabase project URL.
   - `SUPABASE_KEY` — the **service_role** key (Supabase Dashboard → Settings → API). This key bypasses RLS and must never ship to a browser. Do not prefix it with `VITE_`.
4. Point the widget's `apiBase` prop at `https://<your-deployment>/api`.

This is one working setup, not the only one. Anything that implements the two endpoints above (Next.js route handlers, Cloudflare Workers, a plain Express server) will work.

## Requirements

- React 18 or 19 on the consuming app.
- A backend implementing the two endpoints above.

## Development

```bash
npm install
npm run dev        # run the demo against a backend of your choice (configure via .env)
npm test           # run the handler unit tests
npm run typecheck  # run tsc across src/, api/, demo/
npm run build      # produce the dist/ library artifacts
```

CI runs typecheck + tests + build on every PR.

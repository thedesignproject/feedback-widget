# @tosses/feedback-widget

Visual feedback tool for React projects. Your client visits their deployed URL, clicks any element, and leaves a comment. You see everything instantly.

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
| `apiBase` | `string` | yes | Base URL of the backend that serves `POST /comment` and `GET /comments`. |

## Backend setup

This widget does not ship with a hosted backend. You run your own. The repo includes everything you need:

- `api/comment.ts` — `POST` handler that writes a comment to Supabase.
- `api/comments.ts` — `GET` handler that lists comments for a `projectId`.
- `supabase/schema.sql` — database schema.
- `supabase/migrate-enable-rls.sql` — locks the tables down so only the server can read/write.

Steps:

1. Create a Supabase project and run `supabase/schema.sql` to create the tables.
2. Run `supabase/migrate-enable-rls.sql`. This enables Row Level Security with no policies, so the anon/public key is denied everything — all access must flow through the API.
3. Deploy the `api/` functions (e.g. to Vercel). Set these environment variables on the deployment:
   - `SUPABASE_URL` — your Supabase project URL.
   - `SUPABASE_SERVICE_ROLE_KEY` — the **service_role** key from your Supabase dashboard (Settings → API). This key bypasses RLS and must never be exposed to a browser. Do not put it in any `VITE_*` variable.
4. Point `apiBase` at your deployment's `/api` URL.

> **Security note.** The anon/publishable key is never used here. All access to Supabase goes through the API functions using the service_role key. If you ever leak the service_role key, rotate it immediately in the Supabase dashboard.

## Requirements

- React 18+
- A Supabase project (or any equivalent backend behind the two `api/` handlers)
- A deployment target for the `api/` functions (e.g. Vercel)

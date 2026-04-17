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

Steps:

1. Create a Supabase project and run `supabase/schema.sql` to create the `comments` table.
2. Deploy the `api/` functions (e.g. to Vercel). Set `SUPABASE_URL` and `SUPABASE_KEY` as environment variables on that deployment.
3. Point `apiBase` at your deployment's `/api` URL.

## Requirements

- React 18+
- A Supabase project (or any equivalent backend behind the two `api/` handlers)
- A deployment target for the `api/` functions (e.g. Vercel)

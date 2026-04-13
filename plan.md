# Feedback Widget — Product Plan

Visual feedback tool for React projects. The client visits their deployed URL, clicks any element, and leaves a comment. The developer sees everything in a dashboard.

## Problem

No easy way for clients to leave direct UI feedback on deployed projects (Vercel, Netlify, etc). Current workflow: confusing emails, screenshots, hour-long calls. Existing tools (Marker.io, BugHerd) are expensive, English-only, and built for large teams. Nothing exists for indie devs and freelancers in Latam.

## Product

Two parts:

1. **npm package** — a React component installed with one line that adds a floating feedback button to any site
2. **Dashboard** — a React app where the developer sees all client comments organized by project

No custom backend. Supabase handles everything.

## Stack

| Part | Technology |
|------|-----------|
| Widget | React component |
| Database | Supabase (free tier) |
| Dashboard | React + Supabase client |
| Distribution | npm package |

## How It Works

1. Install the widget in the client's project
2. Client visits their normal URL
3. Sees a floating button ("Feedback")
4. Clicks any element on the page
5. Types a comment in the popover
6. Developer sees it in the dashboard instantly

## Supabase Schema (MVP)

```sql
create table projects (
  id uuid primary key default gen_random_uuid(),
  name text,
  created_at timestamp default now()
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  url text,
  x float,
  y float,
  element text,
  comment text,
  created_at timestamp default now()
);
```

## Phases

### Phase 1 — MVP (1 weekend)

Goal: functional, not pretty.

- `<FeedbackWidget projectId="xxx" />` component that detects page clicks
- Simple popover with text input on click
- Saves to Supabase: clicked element, x/y position, comment, timestamp, URL
- Basic dashboard: comment list by project

### Phase 2 — Packaging

- Publish to npm as `@tuusuario/feedback`
- 5-line README with install and usage
- Unique `projectId` per client to separate comments

```jsx
npm install @tuusuario/feedback

import { FeedbackWidget } from '@tuusuario/feedback'

export default function App() {
  return (
    <>
      {/* your app */}
      <FeedbackWidget projectId="cliente-xyz" />
    </>
  )
}
```

### Phase 3 — Real Usage at TDP

- Install in the next TDP client project
- Test with a real client
- Collect feedback on the tool itself
- Iterate

### Phase 4 — Content

- Record the build process for TikTok
- Build in public — the product IS the content
- Posts about the problem, the solution, and the launch

## Out of Scope (for now)

- Auth
- Pricing / plans
- Landing page
- Multi-tenant / organizations
- Email notifications
- Chrome extension

These come later, if there's traction.

---

## Marketing Analysis

### Strengths

- **Jobs to Be Done**: the job is "stop confusing email feedback loops", not "leave a comment"
- **Low Activation Energy**: one npm install, one component, one prop — minimal friction
- **Endowment + IKEA Effect**: once a dev installs it and sees feedback flowing, they won't remove it
- **First Principles**: no backend, no auth, no pricing — stripped to the core truth

### Key Psychological Levers

- **Loss Aversion**: frame around pain ("How many hours did your last revision email cost you?") instead of features
- **Mimetic Desire**: show a real client using the widget on TikTok — not just code, actual usage
- **Contrast Effect**: compare directly against Marker.io ($39/mo) and BugHerd ($33/mo) — this is free
- **Social Proof**: track and display usage numbers early, even small ones ("Used in 3 client projects")

### Risks

- **Cobra Effect**: Supabase keys in client bundle — anyone could spam comments. Add RLS or rate limiting before Phase 3
- **Second-Order Thinking**: the code is easy to clone. The moat is content, brand, and being first in the Latam dev community
- **Curse of Knowledge**: dev audience understands `projectId` and Supabase, but TikTok audience won't. Two different messages needed

### North Star Metric

**Comments submitted per week across all projects.** Not installs, not downloads. If clients are leaving comments, the product works.

---

## Design Direction

### Widget

**Tone**: Industrial-utilitarian meets soft warmth. A developer tool that non-technical clients aren't afraid to use.

**Floating Button**: small pill shape, bottom-right, semi-transparent dark background with backdrop blur. Label: "Feedback" with chat icon. Not a generic FAB circle.

**Feedback Mode**: subtle full-page overlay, crosshair cursor, blue outline on hovered elements, pill changes to "Cancel".

**Popover**: rounded rectangle near the clicked element, auto-focused textarea, placeholder "What would you change?", single "Send" button. After submit: checkmark animation, popover disappears. No toast, no modal.

**Styling**: system fonts only (no custom fonts in widget), CSS variables for theming, Shadow DOM or CSS modules to avoid style leaking.

**Key CSS Variables (Widget)**:
```css
--fw-bg: rgba(15, 15, 15, 0.9);
--fw-text: #fafafa;
--fw-accent: #3b82f6;
--fw-success: #22c55e;
--fw-radius: 10px;
```

### Dashboard

**Aesthetic**: "Dev tool with soul" — Linear meets Notion. Clean grid, monospace accents, generous whitespace, warm touches.

**Layout**: dark sidebar (project list) + light main area (comment feed). Each comment card shows: comment text, element selector (monospace), page URL, relative timestamp. Warm orange accent color as brand signature.

**Typography**:
- Headings: Instrument Sans or General Sans
- Body: IBM Plex Sans
- Monospace (IDs, selectors, timestamps): IBM Plex Mono

**Color Palette**:
```css
--bg-primary: #FAFAF8;
--bg-sidebar: #111111;
--accent: #E85D2A;
--text-primary: #1a1a1a;
--text-secondary: #6b6b6b;
```

### Component Architecture

```
<FeedbackWidget projectId="xxx" supabaseUrl="..." supabaseKey="...">
  ├── FeedbackTrigger        // floating pill button
  ├── FeedbackOverlay        // full-page overlay when active
  │   └── ElementHighlighter // hover highlight logic
  └── FeedbackPopover        // comment input near click
      ├── Textarea
      └── SubmitButton
```

### Implementation Notes

- Shadow DOM or CSS module scoping to isolate from host app
- Portal the popover to `document.body` for z-index safety
- Event delegation: one click listener on `document`
- Store `element` as CSS selector path (e.g., `div.header > img.logo`)
- Store x/y as percentages (viewport-relative), not pixels

### UX Flow

```
Client visits site → sees "Feedback" pill → clicks it →
page enters feedback mode (overlay + crosshair + hover highlights) →
clicks element → popover appears (auto-focused) →
types comment → sends → checkmark → done
```

---

## Next Step

Build the widget. Create the React component that detects clicks, shows the popover, and saves to Supabase. Once that works, the rest is cosmetic.

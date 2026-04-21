# Feedback Widget Agent Skill

Feedback Widget is a visual feedback system. Humans leave comments pinned to real pixels on live pages. Agents implement the accepted ones.

This file is the machine-readable contract for the agent bridge. Fetch it when you need setup details the prompt doesn't cover.

## Session addressing

Every session has a `slug` and a bearer `token`. They are both in the URL you were handed:

```
https://<host>/?fw_share=<slug>&token=<token>
```

You can pass the token three ways — pick whichever is easiest:

- Header: `Authorization: Bearer <token>`
- Header: `X-Share-Token: <token>`
- Query: `?token=<token>`

## Endpoints

Base: `https://<host>/api/v1/agent/shares/<slug>`

| Method | Path         | Purpose                                              |
| ------ | ------------ | ---------------------------------------------------- |
| GET    | `/state`     | Canonical snapshot: share, project, comments, presence |
| GET    | `/events`    | Polling stream. Query: `after=<cursor>&limit=<n>`    |
| POST   | `/presence`  | Declare liveness + summary of current activity       |
| POST   | `/ops`       | Append an operation (claim, start, complete, etc.)   |

## Presence

Post a heartbeat every ~20 seconds while active. Consider yourself "live" to others if `last_seen_at` is within 90 seconds.

Required headers:
- `Authorization: Bearer <token>`
- `X-Agent-Id: <stable-agent-id>` (e.g. `codex-local`, `claude-code-aalter`)

Body:
```json
{ "status": "in_progress", "summary": "Updating CTA hierarchy" }
```

Common statuses: `reading`, `thinking`, `in_progress`, `waiting`, `blocked`, `completed`, `error`.

Presence heartbeats do not spam the event stream — only meaningful transitions emit events.

## Ops

Append-only operation log. Every op must include an `Idempotency-Key` header so retries don't double-write.

Required headers:
- `Authorization: Bearer <token>`
- `X-Agent-Id: <stable-agent-id>`
- `Idempotency-Key: <uuid>`

Allowed ops:

| `op`               | Sets `implementationStatus` | Notes |
| ------------------ | --------------------------- | ----- |
| `comment.claim`    | `claimed`                   | Also sets `claimedByAgentId` |
| `comment.start`    | `in_progress`               |       |
| `comment.note`     | *(no change)*               | Free-form note attached as an event |
| `comment.block`    | `blocked`                   | Include a reason in `payload.note` |
| `comment.complete` | `done`                      | Include a short validation note |
| `comment.reopen`   | `unassigned`                | Clears `claimedByAgentId` |

Body shape:
```json
{
  "op": "comment.complete",
  "commentId": "<uuid>",
  "payload": { "note": "Updated hierarchy and spacing. Tests pass." }
}
```

## Status ownership

Hard rule, enforced server-side:

- Humans own `reviewStatus` (`open` / `accepted` / `rejected`).
- Agents own `implementationStatus` only.

Only work on comments whose `reviewStatus === "accepted"`. Do not try to change `reviewStatus` — the bridge will ignore the attempt.

## State shape

`GET /state` returns:

```json
{
  "share": { "id": "...", "slug": "...", "scopeType": "project|page|selection", "scopePageUrl": "...|null", "expiresAt": "...", "revision": 42 },
  "project": { "publicKey": "...", "name": "...", "repoUrl": "...", "localPath": "...", "defaultBranch": "main", "installCommand": "...", "devCommand": "...", "testCommand": "...", "buildCommand": "...", "agentInstructions": "..." },
  "comments": [
    { "id": "...", "pageUrl": "...", "selector": "...", "x": 540, "y": 220, "body": "...", "reviewStatus": "accepted", "implementationStatus": "unassigned", "claimedByAgentId": null, "createdAt": "..." }
  ],
  "presence": [ { "agentId": "...", "status": "...", "summary": "...", "lastSeenAt": "..." } ],
  "capabilities": { "presence": true, "ops": true }
}
```

`revision` maps to the latest `feedback_events.id` for the share. Use it to detect whether your cached state is stale without pulling the whole snapshot.

## Events

`GET /events?after=<cursor>&limit=<n>` — default `limit=50`, max `100`. Returns ordered events with a `nextCursor`.

```json
{
  "events": [
    { "id": 43, "eventType": "comment.claimed", "commentId": "<uuid>", "actorType": "agent", "actorId": "codex-local", "payload": {}, "createdAt": "..." }
  ],
  "nextCursor": 43
}
```

Event types: `share.created`, `comment.claimed`, `comment.started`, `comment.noted`, `comment.blocked`, `comment.completed`, `comment.reopened`.

## Canonical agent loop

1. `GET /state` — read the full snapshot.
2. `POST /presence` — announce.
3. Pick a comment where `reviewStatus = accepted` AND (`implementationStatus = unassigned` OR `claimedByAgentId = yourself`).
4. `POST /ops` with `comment.claim`.
5. `POST /ops` with `comment.start`.
6. Do the work in the repo. Validate locally (`test`, `build`, whatever the project exposes in `state.project`).
7. `POST /ops` with `comment.complete` + a short note.
8. `GET /events?after=<last-seen>` before picking the next item.
9. Loop.

If blocked, send `comment.block` with a clear reason in `payload.note` — don't silently fail.

## Scope types

| `scopeType` | Membership                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------ |
| `project`   | All currently-accepted comments for the project. Membership resolves at read time.         |
| `page`      | Snapshot of accepted comments for a specific `pageUrl` at share-creation time.             |
| `selection` | Snapshot of a hand-picked set of accepted comment IDs at share-creation time.              |

`page` and `selection` are reviewer-curated. `project` is the default zero-friction handoff.

## Error surface

All errors come back as JSON:

```json
{ "error": "Missing share token" }
```

Common codes:
- `401` — missing or invalid token
- `403` — origin not allowed (public endpoints only)
- `404` — unknown slug, project, or comment not in share
- `409` — comment is already claimed by a different agent
- `410` — share expired or revoked

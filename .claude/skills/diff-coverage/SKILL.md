---
name: diff-coverage
description: Verify 100% diff line AND branch coverage against the current PR base after code changes. Runs vitest coverage, then the combined diff coverage gate. Use after any src/**/*.{ts,tsx} or api/**/*.ts edit before handing work back.
---

# Diff coverage workflow

**Hard rule:** after every code change on a branch, both line-diff and branch-diff coverage against that branch's PR base must be 100%. For a stacked PR, the base is the branch immediately below it, not `trunk`. Add or extend tests until clean before handing work back.

## Steps

1. `bun run test:coverage` — runs vitest with v8 coverage and writes `coverage/lcov.info` (configured in `vitest.config.ts`).
2. `bun run test:diff-coverage -- <base>` — runs both the changed-line and changed-branch gates and fails unless each is 100%.
   - For an ordinary PR, `<base>` is normally `trunk`.
   - For each layer of a stack, `<base>` is the branch immediately below that layer. When the current branch belongs to a locally tracked native GitHub stack, omitting `<base>` resolves the current layer's base automatically.
   - The command finds `diff-cover` on `PATH` or in `/tmp/dc-venv`. If missing, create it with `python3 -m venv /tmp/dc-venv && /tmp/dc-venv/bin/pip install diff-cover==10.0.0`.
3. For every missing or partial line reported by either gate, add a test exercising it and rerun both commands until the combined gate succeeds.

## Notes

- Coverage scope set in `vitest.config.ts` (`include: src/**/*.{ts,tsx}`, `api/**/*.ts`). Files outside scope don't count even if changed.
- Heavy browser-only deps (e.g. `html2canvas`) should be mocked with `vi.mock(...)` not skipped — see `src/__tests__/screenshotCapture.test.ts` for the pattern.
- CI passes the pull request's exact base SHA to the same combined gate. Native stacked PRs therefore validate each layer independently against its immediate parent.

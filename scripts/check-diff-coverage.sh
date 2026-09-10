#!/usr/bin/env bash

set -euo pipefail

coverage_file="${DIFF_COVERAGE_FILE:-coverage/lcov.info}"
base_ref="${1:-${DIFF_COVERAGE_BASE:-}}"

if [[ -z "$base_ref" && -n "${GITHUB_BASE_REF:-}" ]]; then
  if git rev-parse --verify --quiet "origin/${GITHUB_BASE_REF}^{commit}" >/dev/null; then
    base_ref="origin/${GITHUB_BASE_REF}"
  else
    base_ref="$GITHUB_BASE_REF"
  fi
fi

if [[ -z "$base_ref" ]] && command -v gh >/dev/null 2>&1; then
  stack_json="$(gh stack view --json 2>/dev/null || true)"
  if [[ -n "$stack_json" ]]; then
    base_ref="$(STACK_JSON="$stack_json" python3 -c '
import json
import os

stack = json.loads(os.environ["STACK_JSON"])
current = stack.get("currentBranch")
for branch in stack.get("branches", []):
    if branch.get("name") == current:
        print(branch.get("base", ""))
        break
')"
  fi
fi

base_ref="${base_ref:-trunk}"

if ! git rev-parse --verify --quiet "${base_ref}^{commit}" >/dev/null; then
  echo "error: diff coverage base '$base_ref' is not available locally" >&2
  exit 2
fi

if [[ ! -f "$coverage_file" ]]; then
  echo "error: $coverage_file not found; run 'bun run test:coverage' first" >&2
  exit 2
fi

if command -v diff-cover >/dev/null 2>&1; then
  diff_cover="$(command -v diff-cover)"
elif [[ -x /tmp/dc-venv/bin/diff-cover ]]; then
  diff_cover="/tmp/dc-venv/bin/diff-cover"
else
  echo "error: diff-cover is not installed" >&2
  echo "install it with: python3 -m venv /tmp/dc-venv && /tmp/dc-venv/bin/pip install diff-cover==10.0.0" >&2
  exit 2
fi

echo "Checking 100% line and branch diff coverage against $base_ref"
status=0

if ! "$diff_cover" "$coverage_file" --compare-branch="$base_ref" --fail-under=100; then
  status=1
fi

if ! python3 scripts/diff-branch-cov.py "$base_ref" "$coverage_file"; then
  status=1
fi

if [[ "$status" -eq 0 ]]; then
  echo "Diff line and branch coverage: 100%"
fi

exit "$status"

#!/usr/bin/env bash
#
# Applies the branch-protection rule on `main` from the committed JSON spec.
# Re-running is safe — GitHub treats this as an upsert.
#
# Prereqs:
#   - `gh` CLI authenticated (`gh auth status`)
#   - Your account has `admin` on the repo
#
# Usage:
#   scripts/bootstrap-branch-protection.sh [owner/repo]
#
# If the argument is omitted, the script uses the `origin` remote of the
# current clone, so running it from a fresh checkout Just Works.

set -euo pipefail

REPO="${1:-}"
if [ -z "$REPO" ]; then
  REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
fi

SPEC="$(dirname "$0")/branch-protection.json"

if [ ! -f "$SPEC" ]; then
  echo "error: spec not found at $SPEC" >&2
  exit 1
fi

echo "Applying branch protection on $REPO:main from $SPEC"
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  "/repos/$REPO/branches/main/protection" \
  --input "$SPEC"

echo "Done. Current required checks:"
gh api "/repos/$REPO/branches/main/protection/required_status_checks" \
  --jq '.contexts[]'

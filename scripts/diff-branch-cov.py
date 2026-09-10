#!/usr/bin/env python3
"""Branch coverage on changed lines vs a base branch.

diff-cover only reports line coverage. lcov BRDA records also encode branch
coverage; Codecov uses them to flag partial branches that line coverage hides.
This script reproduces that locally: parse `git diff --unified=0 BASE...HEAD`,
intersect changed lines with BRDA records in coverage/lcov.info, print partial
or fully-untaken branches per file. Exits non-zero if any are found.

Usage: python3 scripts/diff-branch-cov.py [base-branch] [lcov-file]
Defaults: base branch `trunk`, LCOV file `coverage/lcov.info`.
Run `bun run test:coverage` first to refresh coverage/lcov.info.
"""
import re
import os
import sys
import subprocess
from collections import defaultdict

base = sys.argv[1] if len(sys.argv) > 1 else "trunk"
coverage_file = sys.argv[2] if len(sys.argv) > 2 else "coverage/lcov.info"

diff = subprocess.check_output(
    [
        "git", "diff", "--unified=0", f"{base}...HEAD", "--",
        "src/**/*.ts", "src/**/*.tsx", "api/**/*.ts",
        "apps/dashboard/**/*.ts", "apps/dashboard/**/*.tsx",
        "apps/extension/**/*.ts", "apps/extension/**/*.tsx",
    ],
    text=True,
)

changed = defaultdict(set)
cur = None
for line in diff.split("\n"):
    if line.startswith("+++ b/"):
        cur = line[6:]
    elif line.startswith("@@") and cur:
        m = re.search(r"\+(\d+)(?:,(\d+))?", line)
        if m:
            s = int(m.group(1))
            n = int(m.group(2) or 1)
            for i in range(s, s + n):
                changed[cur].add(i)

with open(coverage_file) as f:
    lcov = f.read()

fail = False
for rec in lcov.split("end_of_record"):
    sf = re.search(r"SF:(.+)", rec)
    if not sf:
        continue
    path = os.path.relpath(sf.group(1).strip())
    if path not in changed:
        continue
    by_line = defaultdict(list)
    for m in re.finditer(r"BRDA:(\d+),\d+,\d+,(-|\d+)", rec):
        ln = int(m.group(1))
        if ln in changed[path]:
            by_line[ln].append(m.group(2))
    partial, untaken = [], []
    for ln, takens in by_line.items():
        hit = sum(1 for t in takens if t != "-" and int(t) > 0)
        miss = sum(1 for t in takens if t == "-" or int(t) == 0)
        if hit and miss:
            partial.append((ln, hit, hit + miss))
        elif not hit:
            untaken.append((ln, len(takens)))
    if partial or untaken:
        fail = True
        print(f"\n{path}")
        for ln, h, t in sorted(partial):
            print(f"  L{ln}: {h}/{t} taken")
        for ln, n in sorted(untaken):
            print(f"  L{ln}: 0/{n} taken")

sys.exit(1 if fail else 0)

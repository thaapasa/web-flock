#!/usr/bin/env bash
#
# Rebuilds the prebuilt site that lives in the repo.
#
# The server does not build anything: it checks this repo out and serves
# site/ as-is. So the build output is committed, and this script is what
# refreshes it. Assets are referenced relatively, so the same tree works
# whether it is served from a domain root or a subdirectory.
#
# Usage: yarn site   (or ./scripts/update-site.sh)

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

out="site"
base="${SITE_BASE:-./}"

echo "==> Type-checking"
yarn typecheck

echo "==> Building into $out/ (base $base)"
# --emptyOutDir so files dropped from a build do not linger in the commit.
yarn vite build --outDir "$out" --emptyOutDir --base "$base"

echo
echo "==> Done. Changes to $out/:"
if git diff --quiet --ignore-submodules -- "$out" && [ -z "$(git ls-files --others --exclude-standard -- "$out")" ]; then
  echo "    none — the built site is unchanged."
else
  git status --short -- "$out"
  echo
  echo "    Commit with:  git add $out && git commit -m 'Update prebuilt site'"
fi

#!/usr/bin/env bash
# Deploy the current build (dist/) to the Beta Pages project. Pages reads only a file named wrangler.toml from the working directory, so the
# Beta config is staged beside a copy of functions/ in a temporary directory. Run `npm run build` first.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
stage="$root/.beta-stage"; rm -rf "$stage"; mkdir -p "$stage"
trap 'rm -rf "$stage"' EXIT
cp -r "$root/functions" "$stage/functions"; mkdir -p "$stage/workers"; cp -r "$root/workers/data" "$stage/workers/data"
cp "$root/wrangler.beta.toml" "$stage/wrangler.toml"
[ -f "$root/tsconfig.functions.json" ] && cp "$root/tsconfig.functions.json" "$stage/" || true
cd "$stage"
"$root/node_modules/.bin/wrangler" pages deploy "$root/dist" --project-name singlet-beta --branch beta --commit-dirty=true "$@"

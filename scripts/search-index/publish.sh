#!/usr/bin/env bash
# Rebuilds the bit index from production D1 and publishes it to the data bucket (docs/COHORT-QUERY.md section 1).
# Needs wrangler authenticated for the account (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID) and Node >= 22.18.
# Order matters: the binary goes up first, then index.json, so a reader never sees a dictionary without its binary.
#
#   scripts/search-index/publish.sh [workdir]        # default dist/search-index-build
set -euo pipefail
W="${1:-dist/search-index-build}"
mkdir -p "$W"
node scripts/search-index/d1-export.mjs scripts/search-index/export-samples.sql "$W/samples.json"
FACTS=()
if node scripts/search-index/d1-export.mjs scripts/search-index/export-facts.sql "$W/facts.json"; then
  FACTS=(--facts "$W/facts.json")
else
  echo "sample_attr not readable; building without extracted facts" >&2
fi
node scripts/search-index/build-index.ts --samples "$W/samples.json" ${FACTS[@]+"${FACTS[@]}"} --out "$W/out"
BIN=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).bin)' "$W/out/index.json")
npx wrangler r2 object put "singlet-data/search-index/v1/$BIN" --file="$W/out/$BIN" --content-type=application/octet-stream --remote
npx wrangler r2 object put "singlet-data/search-index/v1/index.json" --file="$W/out/index.json" --content-type=application/json --cache-control="public, max-age=300" --remote
echo "published $BIN"

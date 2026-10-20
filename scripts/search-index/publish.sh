#!/usr/bin/env bash
# Rebuilds the bit index and publishes it (docs/COHORT-QUERY.md section 1), through the site's ingest API only:
#   GET  /api/ingest/export          pages of samples, studies and sample_attr (read-only)
#   POST /api/ingest/search-index    the binary first, then index.json, so a reader never sees a dictionary without its binary
# Needs SINGLET_INGEST_TOKEN (the ingest token, never printed) and Node >= 22.18. SITE_URL defaults to https://singlet.bio.
# No wrangler and no Cloudflare credentials.
#
#   SINGLET_INGEST_TOKEN=... scripts/search-index/publish.sh [workdir]        # default dist/search-index-build
set -euo pipefail
: "${SINGLET_INGEST_TOKEN:?SINGLET_INGEST_TOKEN is not set}"
W="${1:-dist/search-index-build}"
mkdir -p "$W"
node scripts/search-index/fetch-export.mjs "$W"
node scripts/search-index/build-index.ts --samples "$W/samples.json" --facts "$W/facts.json" --out "$W/out"
node scripts/search-index/upload.mjs "$W/out"

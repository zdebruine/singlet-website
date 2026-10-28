#!/usr/bin/env bash
# HTTP smoke test for a singlet.bio deployment.
# usage: bash scripts/smoke.sh [BASE_URL]   (default https://singlet.bio)
# Exits non-zero if any check fails. Needs bash, curl, grep, tr and wc
# (present on ubuntu-latest and in Git Bash). Run by .github/workflows/smoke.yml.
set -u
BASE="${1:-https://singlet.bio}"
BASE="${BASE%/}"
fail=0
pass=0

ok()  { echo "ok    $1"; pass=$((pass+1)); }
bad() { echo "FAIL  $1"; fail=$((fail+1)); }

# GET a URL; sets $code (000 when the request itself failed), $ctype and $body.
fetch() {
  local out
  out=$(curl -s -m 30 -w '\n__TYPE__%{content_type}__HTTP__%{http_code}' "$1")
  code="${out##*__HTTP__}"
  out="${out%__HTTP__*}"
  ctype="${out##*__TYPE__}"
  body="${out%__TYPE__*}"
}

check() { # name, expected-status, url, [body-pattern], [content-type-pattern]
  local name="$1" want="$2" url="$3" pat="${4:-}" tpat="${5:-}"
  fetch "$url"
  if [ "$code" != "$want" ]; then
    bad "$name  ($code, want $want)  $url"; return
  fi
  if [ -n "$tpat" ] && ! printf '%s' "$ctype" | grep -q -i -E "$tpat"; then
    bad "$name  (content-type '$ctype', want /$tpat/)  $url"; return
  fi
  if [ -n "$pat" ] && ! printf '%s' "$body" | grep -q -E "$pat"; then
    bad "$name  (body missing /$pat/)  $url"; return
  fi
  ok "$name"
}

check "home"                 200 "$BASE/"                                   "<div id=\"root\""
check "study page (SPA)"     200 "$BASE/study/GSE138867"                    "<div id=\"root\""     "text/html"
check "study api"            200 "$BASE/api/gse/GSE138867"                  "GSE138867"
check "study completeness"   200 "$BASE/api/gse/GSE138867"                  "\"completeness\": *{"
check "library api deployed" 405 "$BASE/api/library"                       "method_not_allowed"
check "feedback api deployed" 405 "$BASE/api/feedback"                       "method_not_allowed"
check "hero demo gif"        200 "$BASE/demo/singlet-demo.gif"              ""                     "image/gif"
check "layer stats"          200 "$BASE/api/stats/layers"                   "\"splicing\""
check "related"              200 "$BASE/api/gse/GSE138867/related"          "\\["
check "search"               200 "$BASE/api/search?q=pbmc&limit=3"          "\"data\""
check "facets"               200 "$BASE/api/facets"                         "organism"
check "fts star no 500"      200 "$BASE/api/gse?q=x*"                       ""
check "fts quote no 500"     200 "$BASE/api/gse?q=foo%22"                   ""
check "fts OR no 500"        200 "$BASE/api/gse?q=a%20OR"                   ""
check "gsm fts no 500"       200 "$BASE/api/gsm?q=x*"                       ""
check "nl-search"            200 "$BASE/api/nl-search?q=microglia%20in%20the%20aging%20mouse%20brain&limit=3" "\"interpreted\""
check "nl-search organism"   200 "$BASE/api/nl-search?q=microglia%20in%20the%20aging%20mouse%20brain&limit=3" "Mus musculus"
check "cohort resolve"       200 "$BASE/api/cohort/resolve?organism=Homo%20sapiens&tissue_group=Brain&facets=0" "\"totals\""
check "cohort manifest"      200 "$BASE/api/cohort/manifest?organism=Mus%20musculus&max_cells=10000&limit=2" "\"downsample\""
check "bundle index"         200 "$BASE/api/bundle/GSE138867/index"         "exon_counts"
# The file listing never shows members held back from the public product (functions/_shared/restricted.ts).
if printf '%s' "$body" | grep -q -E 'snp_(ad|dp)|\.vcf|ase_counts|mt_events|_coverage'; then bad "bundle index lists a restricted member"; else ok "bundle index lists no restricted member"; fi

# The cached member index must describe the file as it is now. A bundle overwritten in place (a repack, the 2026-10
# restricted-sidecar migration) leaves its cached offsets pointing into other bytes. For one study that was rewritten
# in place (GSE111113) and one original upload (GSE138867): the index lists the size HEAD reports, and the first four
# bytes of a sample's exon matrix, read by Range from where the API says they start, are the .1pz magic "TP1Z".
# Update the accessions when those studies are re-packed into the per-sample layout and the legacy bundles are retired.
smoke_bundle_offsets() { # gse
  local gse="$1" idx idxbytes path tmp ct start range url live magic
  fetch "$BASE/api/bundle/$gse/index"
  idx=$(printf '%s' "$body" | tr -d ' \r\n')
  # A study served from the per-sample layout has no legacy bundle to compare: its index lists sample objects.
  if [ "$code" = 200 ] && printf '%s' "$idx" | grep -q '"format":"singlet-s1"'; then ok "bundle offsets $gse skipped (served from s1)"; return; fi
  idxbytes=$(printf '%s' "$idx" | grep -o '"bytes":[0-9]*' | head -n 1 | grep -o '[0-9]*$')
  path=$(printf '%s' "$idx" | grep -o 'samples/GSM[0-9]*/exon_counts\.1pz' | head -n 1)
  if [ "$code" != 200 ] || [ -z "$idxbytes" ] || [ -z "$path" ]; then bad "bundle offsets $gse (index $code, bytes '${idxbytes:-?}', matrix '${path:-none}')"; return; fi
  url="https://data.singlet.bio/data/$gse/$gse.singlet"
  # The legacy file is gone (retired after the study moved to s1): nothing to compare.
  if [ "$(curl -s -o /dev/null -m 30 -I -w '%{http_code}' "$url")" = 404 ]; then ok "bundle offsets $gse skipped (legacy file retired)"; return; fi
  live=$(curl -sI -m 30 "$url" | tr -d '\r' | grep -i '^content-length:' | head -n 1 | grep -o '[0-9]*$')
  if [ "$live" = "$idxbytes" ]; then ok "bundle size $gse matches the object ($live)"; else bad "bundle size $gse (index $idxbytes, object ${live:-?})"; fi
  tmp=$(mktemp)
  ct=$(curl -s -m 60 -o "$tmp" -w '%{content_type}' "$BASE/api/bundle/$gse/entry?path=$path")
  if printf '%s' "$ct" | grep -q -i json; then
    # larger than the edge inflates: a range recipe
    range=$(tr -d ' \r\n' < "$tmp" | grep -o '"range":"bytes=[0-9]*-[0-9]*"' | head -n 1 | grep -o '[0-9]*-' | head -n 1 | tr -d '-')
    url=$(tr -d ' \r\n' < "$tmp" | grep -o '"url":"[^"]*"' | head -n 1 | sed 's/"url":"//; s/"$//')
    start="$range"
    if [ -n "$start" ] && [ -n "$url" ]; then magic=$(curl -s -m 30 -r "$start-$((start+3))" "$url" | head -c 4); else magic=""; fi
  else
    # small enough to be served inflated: the body itself starts with the magic
    magic=$(head -c 4 "$tmp")
  fi
  rm -f "$tmp"
  if [ "$magic" = "TP1Z" ]; then ok "bundle offsets $gse (exon matrix starts with TP1Z)"; else bad "bundle offsets $gse (read '${magic:-nothing}' at the matrix start, want TP1Z)"; fi
}
smoke_bundle_offsets GSE111113
smoke_bundle_offsets GSE138867

# A retired study is one whose single .singlet file is deleted (s1_migration.status = 'retired'). It must answer from s1 and name no legacy URL:
# the study detail has no bundle URL and says the legacy file is gone, the bundle index lists sample objects, the search row and the manifest name
# the s1 manifest, the manifest object is there, and the old file is not served (404, or 410 from the data guard while the switch is on). Name the studies in SMOKE_RETIRED (space separated, e.g.
# SMOKE_RETIRED="GSE145370" once that study is retired); with it empty nothing is checked. src/test/retired-study.test.ts runs the same
# assertions on fixtures for every endpoint and tool.
smoke_retired() { # gse
  local gse="$1" flat murl legacy
  fetch "$BASE/api/gse/$gse"
  flat=$(printf '%s' "$body" | tr -d ' \r\n')
  if [ "$code" != 200 ]; then bad "retired $gse detail ($code)"; return; fi
  if printf '%s' "$flat" | grep -q '"legacy_available":false' && printf '%s' "$flat" | grep -q '"bundle_url":null'; then ok "retired $gse: detail has no bundle URL, s1 block says the legacy file is gone"; else bad "retired $gse: detail still offers the legacy file (is its migration status retired?)"; fi
  if printf '%s' "$flat" | grep -q -E "/data/$gse/|$gse\\.singlet"; then bad "retired $gse: detail names the legacy file"; else ok "retired $gse: detail names no legacy file"; fi
  murl=$(printf '%s' "$flat" | grep -o '"manifest_url":"[^"]*"' | head -n 1 | sed 's/"manifest_url":"//; s/"$//')
  if [ -n "$murl" ] && [ "$(curl -s -o /dev/null -m 30 -I -w '%{http_code}' "$murl")" = 200 ]; then ok "retired $gse: manifest answers ($murl)"; else bad "retired $gse: manifest missing (${murl:-no manifest_url})"; fi
  legacy="https://data.singlet.bio/data/$gse/$gse.singlet"
  # 404 once the bytes are archived and deleted, 410 from the data-guard Worker while s1_flags.legacy_bundles = 'retired'
  case "$(curl -s -o /dev/null -m 30 -I -w '%{http_code}' "$legacy")" in 404|410) ok "retired $gse: legacy object is not served" ;; *) bad "retired $gse: legacy object still answers" ;; esac
  fetch "$BASE/api/bundle/$gse/index"
  flat=$(printf '%s' "$body" | tr -d ' \r\n')
  if [ "$code" = 200 ] && printf '%s' "$flat" | grep -q '"format":"singlet-s1"' && ! printf '%s' "$flat" | grep -q -E "/data/$gse/|$gse\\.singlet"; then ok "retired $gse: bundle index lists sample objects"; else bad "retired $gse: bundle index ($code)"; fi
  fetch "$BASE/api/search?level=gse&q=$gse&limit=5"
  flat=$(printf '%s' "$body" | tr -d ' \r\n')
  if [ "$code" = 200 ] && printf '%s' "$flat" | grep -q "\"gse_id\":\"$gse\"" && ! printf '%s' "$flat" | grep -q -E "\"bundle_key\":\"data/$gse/|/data/$gse/"; then ok "retired $gse: search row has no legacy key"; else bad "retired $gse: search row ($code)"; fi
  fetch "$BASE/api/manifest?q=$gse&format=tsv"
  if [ "$code" = 200 ] && printf '%s' "$body" | grep -q "s1/m/$gse.json" && ! printf '%s' "$body" | grep -q -E "/data/$gse/|$gse\\.singlet"; then ok "retired $gse: manifest export names the s1 manifest"; else bad "retired $gse: manifest export ($code)"; fi
}
for g in ${SMOKE_RETIRED:-}; do smoke_retired "$g"; done

# .s1 serving (workers/data on data.singlet.bio/s1/*): for the studies in SMOKE_S1 (space separated, e.g. SMOKE_S1="GSE138867"), the manifest
# answers from the Worker, its first sample object answers a ranged read with 206, and the API names that manifest. Empty: nothing is checked.
smoke_s1() { # gse
  local gse="$1" m key hdr
  m="https://data.singlet.bio/s1/m/$gse.json"
  hdr=$(curl -s -I -m 30 "$m" | tr -d '\r')
  if printf '%s' "$hdr" | grep -qi '^x-served-by: singlet-data'; then ok "s1 $gse: manifest served by the data Worker"; else bad "s1 $gse: manifest not served by singlet-data"; fi
  key=$(curl -s -m 30 "$m" | grep -o '"key": *"s1/s/[^"]*"' | head -n 1 | sed 's/"key": *"//; s/"$//')
  if [ -n "$key" ] && [ "$(curl -s -o /dev/null -m 30 -H 'Range: bytes=0-63' -w '%{http_code}' "https://data.singlet.bio/$key")" = 206 ]; then ok "s1 $gse: sample object answers a range ($key)"; else bad "s1 $gse: sample object range (${key:-no key in the manifest})"; fi
  fetch "$BASE/api/gse/$gse"
  if [ "$code" = 200 ] && printf '%s' "$body" | tr -d ' \r\n' | grep -q "\"manifest_url\":\"$m\""; then ok "s1 $gse: API names the s1 manifest"; else bad "s1 $gse: API does not name $m ($code)"; fi
}
for g in ${SMOKE_S1:-}; do smoke_s1 "$g"; done

check "manifest tsv"         200 "$BASE/api/manifest?gse=GSE138867&format=tsv" "GSE138867"
check "auth me (signed out)" 200 "$BASE/api/auth/me"                        "\"user\": *null|\"user\":null"
check "unknown api is JSON 404" 404 "$BASE/api/definitely-not-a-route"      "\"error\": *\"not_found\"" "json"
check "hpc latest.json (api)" 200 "$BASE/api/hpc/latest.json"               "\"generated_at\""     "json"
code=$(curl -s -m 30 -o /dev/null -w "%{http_code}" -X POST -H "content-type: application/json" -H "Origin: $BASE" -d "{\"action\":\"list\"}" "$BASE/api/keys"); if [ "$code" = 401 ]; then ok "keys need sign-in"; else bad "keys need sign-in ($code)"; fi

# /api/stats: samples_in_files must be a positive number.
fetch "$BASE/api/stats"
n=$(printf '%s' "$body" | grep -o '"samples_in_files": *[0-9][0-9]*' | head -n 1 | grep -o '[0-9][0-9]*$')
if [ "$code" = 200 ] && [ -n "$n" ] && [ "$n" -gt 0 ]; then
  ok "stats samples_in_files > 0 ($n)"
else
  bad "stats samples_in_files ($code, '${n:-missing}')"
fi

# AI search must not read "melanoma" as a skin tissue: the interpreted
# tissue_group for this question must not contain "Skin".
fetch "$BASE/api/nl-search?q=tumor-infiltrating%20T%20cells%20in%20melanoma&limit=3"
interp=$(printf '%s' "$body" | tr -d '\r\n' | grep -o '"interpreted": *{[^}]*}' | head -n 1)
tissue=$(printf '%s' "$interp" | grep -o '"tissue_group": *\[[^]]*]' | head -n 1)
if [ "$code" != 200 ]; then
  bad "nl-search melanoma not Skin ($code)"
elif [ -z "$interp" ]; then
  bad "nl-search melanoma not Skin (no interpreted object; AI off or over quota?)"
elif printf '%s' "$tissue" | grep -q 'Skin'; then
  bad "nl-search melanoma not Skin (got $tissue)"
else
  ok "nl-search melanoma not Skin"
fi

# Clickjacking guard from public/_headers.
xfo=$(curl -s -m 30 -o /dev/null -D - "$BASE/" | tr -d '\r' | grep -i '^x-frame-options:' | head -n 1)
if printf '%s' "$xfo" | grep -q -i -E '^x-frame-options: *DENY$'; then ok "x-frame-options on /"; else bad "x-frame-options on / (got '${xfo:-none}')"; fi

# MCP: tools/list returns the original 14 tools, or 19 once a study is served from s1 (find_cells, slice_cells, resolve_features,
# search_cells and get_cells_page are listed only then).
mcp=$(curl -s -m 30 -X POST "$BASE/mcp" -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
n=$(printf '%s' "$mcp" | grep -o '"name":"[a-z_]*","title"' | wc -l | tr -d ' ')
if [ "$n" = "14" ] || [ "$n" = "20" ]; then ok "mcp tools/list ($n)"; else bad "mcp tools/list ($n tools, want 14 or 20)"; fi

# MCP tool calls need an account: without a credential a call is HTTP 401 whose WWW-Authenticate points at the
# OAuth metadata (that 401 is what makes Claude's connectors start sign-in; a 200 tool error never does).
mcpcall=$(curl -s -m 30 -o /dev/null -D - -X POST "$BASE/mcp" -H 'content-type: application/json'   -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_atlas_stats","arguments":{}}}' | tr -d '\r')
if printf '%s' "$mcpcall" | grep -q '^HTTP/[0-9.]* 401' && printf '%s' "$mcpcall" | grep -qi '^www-authenticate: Bearer .*resource_metadata="'"$BASE"'/.well-known/oauth-protected-resource"'; then
  ok "mcp tool call without a credential is 401 + resource_metadata"
else
  bad "mcp tool call without a credential (got: $(printf '%s' "$mcpcall" | head -c 200))"
fi

# OAuth discovery for MCP clients (functions/_shared/mcp-oauth.ts), on this deployment's own origin.
check "oauth protected resource" 200 "$BASE/.well-known/oauth-protected-resource" "\"resource\": *\"$BASE/mcp\"" "json"
check "oauth resource (mcp path)" 200 "$BASE/.well-known/oauth-protected-resource/mcp" "\"authorization_servers\"" "json"
check "oauth server metadata"   200 "$BASE/.well-known/oauth-authorization-server" "\"registration_endpoint\": *\"$BASE/oauth/register\"" "json"
code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST "$BASE/oauth/token" -H 'content-type: application/x-www-form-urlencoded' -d 'grant_type=authorization_code&code=sac_nope&client_id=scl_nope')
if [ "$code" = 401 ]; then ok "oauth token rejects an unknown client"; else bad "oauth token unknown client ($code, want 401)"; fi

# An invalid key is HTTP 401, whatever the method.
code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST "$BASE/mcp" -H 'content-type: application/json'   -H 'authorization: Bearer sk_live_not-a-real-key-for-the-smoke-test' -d '{"jsonrpc":"2.0","id":3,"method":"tools/list"}')
if [ "$code" = 401 ]; then ok "mcp invalid key is 401"; else bad "mcp invalid key ($code, want 401)"; fi

# The crank endpoints write production D1: no token, no entry.
for r in refresh-next index-next; do
  code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$BASE/api/ingest/$r")
  if [ "$code" = 401 ]; then ok "$r needs the ingest token"; else bad "$r without a token ($code, want 401)"; fi
done

# Security headers on the page, the API and the sitemap.
hdr() { curl -s -m 30 -o /dev/null -D - "$1" | tr -d '\r'; }
for u in "/" "/api/stats" "/sitemap.xml"; do
  h=$(hdr "$BASE$u")
  for want in "x-content-type-options: *nosniff" "strict-transport-security:" "referrer-policy:"; do
    if printf '%s' "$h" | grep -q -i -E "^$want"; then ok "header $want on $u"; else bad "header $want missing on $u"; fi
  done
done

# QC: the stats report what was removed and flagged, and the opt-in only ever adds studies.
fetch "$BASE/api/stats"
qc_removed=$(printf '%s' "$body" | tr -d ' \r\n' | grep -o '"removed_samples":[0-9]*' | head -n 1 | grep -o '[0-9]*$')
qc_low=$(printf '%s' "$body" | tr -d ' \r\n' | grep -o '"low_qc_samples":[0-9]*' | head -n 1 | grep -o '[0-9]*$')
if [ -n "$qc_removed" ] && [ -n "$qc_low" ]; then ok "stats report QC (removed $qc_removed, low QC $qc_low)"; else bad "stats carry no qc block"; fi
fetch "$BASE/api/search?limit=1"
qc_def=$(printf '%s' "$body" | tr -d ' \r\n' | grep -o '"totals":{"studies":[0-9]*' | grep -o '[0-9]*$')
fetch "$BASE/api/search?limit=1&include_low_qc=1"
qc_inc=$(printf '%s' "$body" | tr -d ' \r\n' | grep -o '"totals":{"studies":[0-9]*' | grep -o '[0-9]*$')
if [ -n "$qc_def" ] && [ -n "$qc_inc" ] && [ "$qc_inc" -ge "$qc_def" ]; then ok "include_low_qc never shrinks results ($qc_def -> $qc_inc studies)"; else bad "include_low_qc search ($qc_def -> ${qc_inc:-?})"; fi

# The numbers on the home page and in search count the same thing.
fetch "$BASE/api/stats"
st_studies=$(printf '%s' "$body" | grep -o '"studies_with_files": *[0-9]*' | head -n 1 | grep -o '[0-9]*$')
st_samples=$(printf '%s' "$body" | grep -o '"samples_in_files": *[0-9]*' | head -n 1 | grep -o '[0-9]*$')
fetch "$BASE/api/search?limit=1"
se_totals=$(printf '%s' "$body" | tr -d ' \r\n' | grep -o '"totals":{[^}]*')
se_studies=$(printf '%s' "$se_totals" | grep -o '"studies":[0-9]*' | grep -o '[0-9]*$')
se_samples=$(printf '%s' "$se_totals" | grep -o '"samples":[0-9]*' | grep -o '[0-9]*$')
if [ -n "$st_studies" ] && [ "$st_studies" = "$se_studies" ] && [ "$st_samples" = "$se_samples" ]; then
  ok "stats and search agree ($st_studies studies, $st_samples samples)"
else
  bad "stats and search disagree (stats $st_studies/$st_samples, search ${se_studies:-?}/${se_samples:-?})"
fi

# Sitemap and robots.
check "sitemap"              200 "$BASE/sitemap.xml"                        "<loc>https://singlet.bio/"  "xml"
check "robots"               200 "$BASE/robots.txt"                         "User-agent"

echo "---- $pass passed, $fail failed ($BASE)"
[ "$fail" = 0 ]

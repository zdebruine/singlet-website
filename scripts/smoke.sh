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
check "related"              200 "$BASE/api/gse/GSE138867/related"          "\\["
check "search"               200 "$BASE/api/search?q=pbmc&limit=3"          "\"data\""
check "facets"               200 "$BASE/api/facets"                         "organism"
check "fts star no 500"      200 "$BASE/api/gse?q=x*"                       ""
check "fts quote no 500"     200 "$BASE/api/gse?q=foo%22"                   ""
check "fts OR no 500"        200 "$BASE/api/gse?q=a%20OR"                   ""
check "gsm fts no 500"       200 "$BASE/api/gsm?q=x*"                       ""
check "nl-search"            200 "$BASE/api/nl-search?q=microglia%20in%20the%20aging%20mouse%20brain&limit=3" "\"interpreted\""
check "nl-search organism"   200 "$BASE/api/nl-search?q=microglia%20in%20the%20aging%20mouse%20brain&limit=3" "Mus musculus"
check "bundle index"         200 "$BASE/api/bundle/GSE138867/index"         "exon_counts"
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

# MCP: tools/list must return 14 tools.
mcp=$(curl -s -m 30 -X POST "$BASE/mcp" -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
n=$(printf '%s' "$mcp" | grep -o '"name":"[a-z_]*","title"' | wc -l | tr -d ' ')
if [ "$n" = "14" ]; then ok "mcp tools/list (14)"; else bad "mcp tools/list ($n tools)"; fi

# MCP tool calls need a key: without one a call is a tool error that says so (not an answer, not a 500).
mcpcall=$(curl -s -m 30 -X POST "$BASE/mcp" -H 'content-type: application/json'   -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_atlas_stats","arguments":{}}}')
if printf '%s' "$mcpcall" | grep -q 'key_required'; then ok "mcp tool call without a key is refused"; else bad "mcp tool call without a key (got: $(printf '%s' "$mcpcall" | head -c 120))"; fi

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

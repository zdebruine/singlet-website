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

echo "---- $pass passed, $fail failed ($BASE)"
[ "$fail" = 0 ]

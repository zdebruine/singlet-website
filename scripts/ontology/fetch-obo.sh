#!/usr/bin/env bash
# Download the OBO releases scripts/ontology/build.ts reads into <dir> (default ontology-obo/).
#   scripts/ontology/fetch-obo.sh [dir]
set -euo pipefail
dir="${1:-ontology-obo}"
mkdir -p "$dir"
get() { curl -fsSL --retry 3 -o "$dir/$1" "$2"; echo "$1: $(grep -m1 '^data-version:' "$dir/$1" || echo 'no data-version')"; }
get cl.obo        http://purl.obolibrary.org/obo/cl/cl-basic.obo
get uberon.obo    http://purl.obolibrary.org/obo/uberon/uberon-basic.obo
get mondo.obo     http://purl.obolibrary.org/obo/mondo.obo
get pato.obo      http://purl.obolibrary.org/obo/pato.obo
get hsapdv.obo    http://purl.obolibrary.org/obo/hsapdv.obo
get mmusdv.obo    http://purl.obolibrary.org/obo/mmusdv.obo
# The HANCESTRO PURL serves no OBO file; the repository has one.
get hancestro.obo https://raw.githubusercontent.com/EBISPOT/hancestro/main/hancestro.obo

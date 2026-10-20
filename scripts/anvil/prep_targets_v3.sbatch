#!/bin/bash
#SBATCH -A bio260157
#SBATCH -p shared
#SBATCH -N 1 -n 1 -c 1
#SBATCH --mem=2G
#SBATCH -t 04:00:00
#SBATCH -o /anvil/projects/x-bio260157/singlet_campaign/logs/v3/prep_%j.out
# Build state_v3/targets/tier<T>.tsv from GEO SOFT + ENA (compute node, outbound internet). usage: sbatch prep_targets_v3.sbatch A|C [limit]
set -uo pipefail
T=${1:?tier}; LIM=${2:-0}
R=/anvil/projects/x-bio260157/singlet_campaign; S=$R/smoke_v3; mkdir -p "$R/state_v3/targets"
O=$R/state_v3/targets
/apps/anvil/external/apps/conda/2024.02/bin/python3 "$S/make_targets_v3.py" --studies "$S/new_studies.tsv" --tier "$T" \
  --out "$O/tier$T.tsv.tmp" --pending "$O/tier${T}_pending.tsv" --limit "$LIM" && mv "$O/tier$T.tsv.tmp" "$O/tier$T.tsv"
wc -l "$O/tier$T.tsv" "$O/tier${T}_pending.tsv"

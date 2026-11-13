#!/bin/bash
#SBATCH -A bio260157
#SBATCH -p shared
#SBATCH -N 1 -n 1 -c 4
#SBATCH --mem=7G
#SBATCH -t 03:00:00
#SBATCH -o /anvil/projects/x-bio260157/singlet_campaign/logs/v3/publish_%j.out
# Publish stage on compute: pack, R2 upload, D1 upsert, verify, clean (publish_study_v3.py). Submitted by the controller
# for each batch of finished studies. usage: sbatch publish_v3.sbatch <targets_tier.tsv> GSE [GSE ...]
#   PUBLISH_DRY=1 sbatch --export=ALL ...   -> pack + layer check only, nothing uploaded or written to D1.
set -uo pipefail
R=/anvil/projects/x-bio260157/singlet_campaign; source "$R/anvil_env_v3.sh"
set -a; source ~/.singlet/cloudflare.env; [ -f ~/.singlet/ingest.env ] && source ~/.singlet/ingest.env; set +a
mkdir -p "$R/state_v3/study" "$R/state_v3/pub"
bash "$R/smoke_v3/cf_pack_v3_prepare.sh" "$V3_BIN_DIR" || exit 6
exec "$V3_PY" "$R/smoke_v3/publish_study_v3.py" --targets "${1:?targets}" "${@:2}"

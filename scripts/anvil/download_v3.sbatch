#!/bin/bash
#SBATCH -A bio260157
#SBATCH -p shared
#SBATCH -N 1 -n 1 -c 2
#SBATCH --mem=4G
#SBATCH -t 00:45:00
#SBATCH -o /anvil/projects/x-bio260157/singlet_campaign/logs/v3/dl_%A_%a.out
# Download stage on compute (never the login node). One array task = one batch file of <= 6 rows from targets_v3.tsv
# (gsm primary_srr protocol_tag species gse gse_pdat n_runs all_srrs). Submit through submit_campaign_v3.sh.
set -uo pipefail
R=/anvil/projects/x-bio260157/singlet_campaign
source "$R/anvil_env_v3.sh"
LIST=${DL_BATCH_LIST:?DL_BATCH_LIST}                      # file with one batch path per line
BATCH=$(sed -n "$((SLURM_ARRAY_TASK_ID+1))p" "$LIST")
MAXREADS=${MAXREADS:-30000000}
T0=$(date +%s); LIMIT=${DL_LIMIT_S:-$((35*60))}
echo "=== dl $BATCH host=$(hostname) $(date -Is) ==="
ok=0; fail=0; skip=0
while IFS=$'\t' read -r GSM SRR TAG SP GSE PDAT NRUNS ALL; do
  if [ -z "${GSM:-}" ] || [[ $GSM == \#* ]] || [ "$GSM" = gsm ]; then continue; fi
  if [ $(( $(date +%s)-T0 )) -ge $LIMIT ]; then echo "time budget hit before $GSM"; break; fi
  D=$SINGLET_RESULTS_DIR/$GSM
  if [ -f "$D/.rejected" ] || [ -f "$D/out/pileup_stats.json" ]; then skip=$((skip+1)); continue; fi
  if [ -f "$D/$SRR.1fq" ] && [ -f "$D/.staged" ]; then skip=$((skip+1)); continue; fi
  mkdir -p "$D"
  if timeout 1200 "$SINGLET_BIN" download "$SRR" -o "$D/$SRR.1fq" --max-reads "$MAXREADS" > "$D/download.log" 2>&1 && [ -s "$D/$SRR.1fq" ]; then
    date -Is > "$D/.staged"; ok=$((ok+1)); echo "ok $GSM $SRR"
  else
    rm -f "$D/$SRR.1fq"
    A=$D/.dl_attempts; n=$(( $(cat "$A" 2>/dev/null || echo 0) + 1 )); echo $n > "$A"
    if [ "$n" -ge 3 ]; then echo "download_fail attempts=$n $(date -Is)" > "$D/.rejected"; fi
    fail=$((fail+1)); echo "FAIL $GSM $SRR (attempt $n)"
  fi
done < "$BATCH"
echo "dl done ok=$ok fail=$fail skip=$skip seconds=$(( $(date +%s)-T0 ))"

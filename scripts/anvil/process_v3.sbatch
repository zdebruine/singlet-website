#!/bin/bash
#SBATCH -A bio260157
#SBATCH -p shared
#SBATCH -N 1 -n 1 -c 26
#SBATCH --mem=48G
#SBATCH -t 01:10:00
#SBATCH -o /anvil/projects/x-bio260157/singlet_campaign/logs/v3/proc_%A_%a.out
# Process stage: align + full pipeline on pre-staged .1fq. Semantics of run_process_v2.sbatch, new binary, results_v3.
# One species-homogeneous batch file per array task (<= 30 rows). OOM policy: no 128G/70-core tier. A sample OOM-killed
# at 54G is marked state/oom_v3/<GSM> and skipped; resubmit those once with RETRY=1 --mem=72G -c 30 -t 02:00:00
# (a batch of <= 4); OOM again -> rejected oom_fail.
set -uo pipefail
R=/anvil/projects/x-bio260157/singlet_campaign
source "$R/anvil_env_v3.sh"
LIST=${PROC_BATCH_LIST:?PROC_BATCH_LIST}; RETRY=${RETRY:-0}
BATCH=$(sed -n "$((SLURM_ARRAY_TASK_ID+1))p" "$LIST")
mkdir -p "$R/state/oom_v3" "$R/state/attempts_v3"
JOB_START=$(date +%s); LIMIT=${PROC_LIMIT_S:-$((66*60))}
echo "=== proc $BATCH retry=$RETRY host=$(hostname) bin=$SINGLET_BIN sha=$SINGLET_GIT_SHA $(date -Is) ==="
proc=0; rej=0; oom=0; skip=0
while IFS=$'\t' read -r GSM SRR TAG SP GSE PDAT NRUNS ALL; do
  if [ -z "${GSM:-}" ] || [[ $GSM == \#* ]] || [ "$GSM" = gsm ]; then continue; fi
  if [ $(( $(date +%s)-JOB_START )) -ge "$LIMIT" ]; then echo "time budget hit"; break; fi
  case "$SP" in
    human) GD=$SINGLET_GENOME_DIR_HUMAN; GTF=$SINGLET_EXONS_GTF_HUMAN; VCF=$SINGLET_SNP_VCF_HUMAN ;;
    mouse) GD=$SINGLET_GENOME_DIR_MOUSE; GTF=$SINGLET_EXONS_GTF_MOUSE; VCF=$SINGLET_SNP_VCF_MOUSE ;;
    *) echo "SKIP $GSM species=$SP"; skip=$((skip+1)); continue ;;
  esac
  [ -f "$VCF" ] || { echo "no SNP vcf for $SP: refusing (the publisher gate needs snp_vcf)"; exit 9; }
  D=$SINGLET_RESULTS_DIR/$GSM
  if [ -f "$D/out/pileup_stats.json" ] || [ -f "$D/.rejected" ]; then skip=$((skip+1)); continue; fi
  if [ "$RETRY" = 0 ] && [ -f "$R/state/oom_v3/$GSM" ]; then skip=$((skip+1)); continue; fi
  if [ ! -f "$D/$SRR.1fq" ]; then skip=$((skip+1)); continue; fi
  cd "$D" || continue
  echo "=== PROC $GSM/$SRR $SP ($(date -Is)) ==="
  "$SINGLET_BIN" "$SRR.1fq" --ref-base "$SINGLET_REF_BASE" --genome-dir "$GD" --exons "$GTF" --out-prefix out/ \
    --threads "${SLURM_CPUS_PER_TASK:-26}" --output-format 1pz --pipeline --snps "$VCF" \
    --no-viral-screen --no-microbial-screen --genome-shared off 2>&1 | tee run.log | tail -5
  EX=${PIPESTATUS[0]}
  clean() { rm -f "$SRR.1fq" .staged out/star_Unmapped.out.mate1 out/star_Unmapped.out.mate2 out/nonhost_reads.fq "$R/state/oom_v3/$GSM"; }
  if [ "$EX" -eq 0 ] && [ -f out/pileup_stats.json ]; then
    clean; proc=$((proc+1))
  elif [ "$EX" -eq 0 ]; then
    why=$(grep -oE 'status=[a-z_]+' run.log | tail -1 | cut -d= -f2)
    echo "${why:-process_no_output} $(date -Is)" > .rejected; clean; rej=$((rej+1))
  elif [ "$EX" -eq 137 ]; then
    if [ "$RETRY" = 1 ]; then echo "oom_fail_72G $(date -Is)" > .rejected; clean; rej=$((rej+1))
    else touch "$R/state/oom_v3/$GSM"; oom=$((oom+1)); fi
  else
    AF=$R/state/attempts_v3/$GSM; n=$(( $(cat "$AF" 2>/dev/null || echo 0) + 1 )); echo $n > "$AF"
    if [ "$n" -ge 3 ]; then echo "runtime_fail attempts=$n $(date -Is)" > .rejected; clean; rej=$((rej+1)); fi
  fi
done < "$BATCH"
echo "proc done processed=$proc rejected=$rej oom=$oom skipped=$skip seconds=$(( $(date +%s)-JOB_START ))"

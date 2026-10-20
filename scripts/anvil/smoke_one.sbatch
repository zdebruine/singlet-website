#!/bin/bash
#SBATCH -A bio260157
#SBATCH -p shared
#SBATCH -N 1 -n 1 -c 16
#SBATCH --mem=44G
#SBATCH -t 00:25:00
#SBATCH -o /anvil/projects/x-bio260157/singlet_campaign/logs/smoke_v3_%x_%j.out
# End-to-end smoke test for ONE sample on the v3 binary: download (compute-node internet), align, pack, verify.
# Nothing is uploaded to R2 or written to D1.
# Sized from the first smoke run (30 cores/54G: 37.8 GB peak RSS, 165 s wall for 10 M reads); override with sbatch -p debug -c .. --mem=.. -t ..
# usage: sbatch -J smoke_human smoke_one.sbatch <GSM> <SRR> <human|mouse> <GSE> [max_reads=10000000]
set -uo pipefail
GSM=${1:?GSM}; SRR=${2:?SRR}; SP=${3:?species}; GSE=${4:?GSE}; MAXR=${5:-10000000}
R=/anvil/projects/x-bio260157/singlet_campaign; V3=$R/smoke_v3
source "$R/anvil_env_v3.sh"
export SINGLET_RESULTS_DIR=/anvil/scratch/x-zdebruine/results_v3_smoke
case $SP in
  human) GD=$SINGLET_GENOME_DIR_HUMAN; GTF=$SINGLET_EXONS_GTF_HUMAN; VCF=$SINGLET_SNP_VCF_HUMAN ;;
  mouse) GD=$SINGLET_GENOME_DIR_MOUSE; GTF=$SINGLET_EXONS_GTF_MOUSE; VCF=$SINGLET_SNP_VCF_MOUSE ;;
  *) echo "bad species"; exit 2 ;;
esac
echo "=== smoke $GSM/$SRR $SP $GSE host=$(hostname) bin=$SINGLET_BIN sha=$SINGLET_GIT_SHA $(date -Is) ==="
D=$SINGLET_RESULTS_DIR/$GSM; rm -rf "$D" "$V3/bundles/$GSE"; mkdir -p "$D"; cd "$D"   # smoke dirs are always rebuilt from scratch
t0=$(date +%s)
echo "--- outbound: NCBI/ENA/SRA ---"
for u in https://www.ncbi.nlm.nih.gov/geo/ https://www.ebi.ac.uk/ena/browser/api/xml/$SRR https://trace.ncbi.nlm.nih.gov/Traces/sra-reads-be/fastq?acc=$SRR; do
  curl -sS -m 25 -o /dev/null -w "%{http_code} $u\n" -L "$u" || echo "FAIL $u"; done
echo "--- 1. download (max_reads=$MAXR) ---"
"$SINGLET_BIN" download "$SRR" -o "$D/$SRR.1fq" --max-reads "$MAXR" 2>&1 | tail -15
DL=$?; t1=$(date +%s); ls -la "$D/$SRR.1fq" || { echo "DOWNLOAD FAILED"; exit 3; }
echo "download_seconds=$((t1-t0))"
echo "--- 2. align + pipeline ---"
"$SINGLET_BIN" "$SRR.1fq" --ref-base "$SINGLET_REF_BASE" --genome-dir "$GD" --exons "$GTF" --out-prefix out/ \
  --threads "${SLURM_CPUS_PER_TASK:-16}" --output-format 1pz --pipeline --snps "$VCF" \
  --no-viral-screen --no-microbial-screen --genome-shared off 2>&1 | tee run.log | tail -40
EX=${PIPESTATUS[0]}; t2=$(date +%s); echo "pipeline_exit=$EX align_seconds=$((t2-t1))"
echo "--- out/ listing ---"; ls -laR out | grep -v "star_Solo\|Unmapped" | head -120
[ -f out/pileup_stats.json ] || { echo "NO pileup_stats.json"; exit 4; }
echo "--- 3. catalog + pack ---"
CAT=$V3/catalog_$GSM.parquet
"$V3_PY" "$R/smoke_v3/build_catalog_v3.py" "$CAT" "$GSE" --only-gsm "$GSM" --status done || exit 5
bash "$R/smoke_v3/cf_pack_v3_prepare.sh" "$V3_BIN_DIR" || exit 6
"$V3_PY" "$R/smoke_v3/cf_bundle_v3.py" --catalog "$CAT" --results "$SINGLET_RESULTS_DIR" --out-dir "$V3/bundles" --gse "$GSE" --jobs 1
ls -la "$V3/bundles/$GSE/"
echo "--- 4. verify ---"
"$V3_PY" "$R/smoke_v3/verify_bundle_v3.py" "$V3/bundles/$GSE/$GSE.singlet"; echo "verify_exit=$?"
echo "total_seconds=$(( $(date +%s)-t0 ))  === done $(date -Is) ==="

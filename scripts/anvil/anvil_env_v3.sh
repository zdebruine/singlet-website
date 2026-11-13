# Singlet pipeline environment, Purdue Anvil, campaign v3 (new GEO studies). Source before any v3 job.
# Same reference/SNP layout as anvil_env_v2.sh; new binary (versioned dir, never overwrites bin/) and a fresh results tree.
R=/anvil/projects/x-bio260157/singlet_campaign
export SINGLET_CAMPAIGN_ROOT="$R"
# V3_BIN_DIR: pick the build explicitly; default is the one recorded in $R/BIN_V3_CURRENT (written after a good smoke test).
export V3_BIN_DIR="${V3_BIN_DIR:-$(cat "$R/BIN_V3_CURRENT" 2>/dev/null)}"
export SINGLET_BIN="$V3_BIN_DIR/bin/singlet"
export SINGLET_GIT_SHA="$(cat "$V3_BIN_DIR/GIT_SHA" 2>/dev/null)"
export SINGLET_REF_BASE="$R/reference"
export SINGLET_GENOME_DIR_MOUSE="$SINGLET_REF_BASE/GRCm39-2024-A/star_2.7.11b"
export SINGLET_EXONS_GTF_MOUSE="$SINGLET_REF_BASE/GRCm39-2024-A/genes/genes.gtf"
export SINGLET_SNP_VCF_MOUSE="$SINGLET_REF_BASE/pileup_indices/mus_musculus.vcf.gz"
export SINGLET_GENOME_DIR_HUMAN="$SINGLET_REF_BASE/GRCh38-2024-A/star_2.7.11b"
export SINGLET_EXONS_GTF_HUMAN="$SINGLET_REF_BASE/GRCh38-2024-A/genes/genes.gtf"
export SINGLET_SNP_VCF_HUMAN="$SINGLET_REF_BASE/pileup_indices/homo_sapiens.vcf.gz"
export SINGLET_RESULTS_DIR="${SINGLET_RESULTS_DIR:-/anvil/scratch/x-zdebruine/results_v3}"
export SINGLET_REFERENCE_BUILD_MOUSE="GRCm39-2024-A"
export SINGLET_REFERENCE_BUILD_HUMAN="GRCh38-2024-A"
export V3_PY=/apps/anvil/external/apps/conda/2024.02/bin/python3
export SU_RESERVE="${SU_RESERVE:-20000}"

#!/bin/bash
# GEO text re-fetch for served samples with none stored (scripts/metadata-gaps/geo_refetch.py). One process: NCBI rate limit, not CPU.
#SBATCH --job-name=georefetch
#SBATCH --account=debruinz
#SBATCH --partition=short-cpu,cpu
#SBATCH --cpus-per-task=1
#SBATCH --mem=4G
#SBATCH --time=03:59:00
#SBATCH --output=/mnt/projects/debruinz_project/debruinz/singlet/logs/%x-%j.out
set -euo pipefail
W=/mnt/projects/debruinz_project/debruinz/singlet
J=$W/jobs/georefetch
apptainer exec --bind $W $W/images/python-3.12-bookworm.sif python3 -I $J/geo_refetch.py $J/wanted.tsv $J/geo_text.jsonl

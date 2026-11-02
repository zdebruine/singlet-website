#!/bin/bash
#SBATCH -A bio260157
#SBATCH -p shared
#SBATCH -N 1 -n 1 -c 1
#SBATCH --mem=2G
#SBATCH -t 00:20:00
#SBATCH -J v3_controller
#SBATCH -o /anvil/projects/x-bio260157/singlet_campaign/logs/v3/controller_%j.out
# Self-resubmitting campaign controller (see controller_v3.py). Resubmits itself with --begin; STOP/ABORT/DONE in state_v3/ end the chain.
# One controller at a time: exits if another v3_controller job is already running.
set -uo pipefail
R=/anvil/projects/x-bio260157/singlet_campaign; source "$R/anvil_env_v3.sh"
n=$(squeue -u "$USER" -h -n v3_controller -t RUNNING -o %i | grep -vc "^${SLURM_JOB_ID}$")
[ "$n" -gt 0 ] && { echo "another controller is running, exiting"; exit 0; }
exec "$V3_PY" "$R/smoke_v3/controller_v3.py"

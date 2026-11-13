#!/bin/bash
# Launch the self-orchestrating campaign. Run once, from the Anvil login node (or via ssh); afterwards nothing depends on the laptop.
#   bash launch_campaign_v3.sh            -> prepare tier A targets (compute job), then start the controller after it
#   bash launch_campaign_v3.sh --dry      -> controller dry run only (no submissions) against the existing targets
# Needs: state_v3/targets/ prepared by prep_targets_v3.sbatch (done here), BIN_V3_CURRENT set after a passing smoke test.
set -euo pipefail
R=/anvil/projects/x-bio260157/singlet_campaign; S=$R/smoke_v3; mkdir -p "$R/state_v3/targets" "$R/logs/v3"
mybalance
if [ "${1:-}" = "--dry" ]; then
  sbatch -J v3_controller_dry --export=ALL,CONTROLLER_DRY=1 "$S/controller_v3.sbatch"; exit 0
fi
[ -e "$R/state_v3/STOP" ] && { echo "state_v3/STOP exists: remove it deliberately first"; exit 1; }
[ -e "$R/state_v3/ABORT" ] && { echo "state_v3/ABORT exists: read it, then remove"; exit 1; }
prep=$(sbatch --parsable "$S/prep_targets_v3.sbatch" A)
ctl=$(sbatch --parsable --dependency=afterok:$prep "$S/controller_v3.sbatch")
echo "prep $prep -> controller $ctl (then it resubmits itself every 30 min). Stop with: touch $R/state_v3/STOP ; pause new waves: touch $R/state_v3/PAUSE"

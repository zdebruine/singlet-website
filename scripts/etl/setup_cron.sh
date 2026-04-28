#!/usr/bin/env bash
set -euo pipefail

# Setup script for the ETL cron job on Clipper login node.
# Installs dependencies and configures a crontab entry.
#
# Usage: ./scripts/etl/setup_cron.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ETL_DIR="$SCRIPT_DIR"
VENV_DIR="$ETL_DIR/.venv"

echo "==> Setting up ETL virtual environment at $VENV_DIR"
python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"

echo "==> Installing dependencies"
pip install --quiet --upgrade pip
pip install --quiet supabase python-dotenv

echo "==> Checking .env file"
if [[ ! -f "$ETL_DIR/.env" ]]; then
  cat > "$ETL_DIR/.env" <<'EOF'
SUPABASE_URL=https://vbswbitfyallghbgxkuw.supabase.co
SUPABASE_SERVICE_KEY=<your-service-role-key-here>
EOF
  echo "    Created $ETL_DIR/.env — please fill in SUPABASE_SERVICE_KEY"
fi

# Cron entry: run every 15 minutes
CRON_CMD="*/15 * * * * cd $ETL_DIR && $VENV_DIR/bin/python etl_sync.py >> $ETL_DIR/etl.log 2>&1"
CRON_AGENT="*/30 * * * * cd $ETL_DIR && $VENV_DIR/bin/python agent_sync.py >> $ETL_DIR/agent.log 2>&1"

echo ""
echo "==> Add these lines to your crontab (crontab -e):"
echo ""
echo "$CRON_CMD"
echo "$CRON_AGENT"
echo ""
echo "Or run automatically:"
echo "  (crontab -l 2>/dev/null; echo \"$CRON_CMD\"; echo \"$CRON_AGENT\") | crontab -"

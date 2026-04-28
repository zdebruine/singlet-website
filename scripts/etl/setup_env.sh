#!/bin/bash
# Setup Supabase credentials for ETL and MCP server.
# Run once: source scripts/etl/setup_env.sh
#
# Get your keys from: https://supabase.com/dashboard/project/vbswbitfyallghbgxkuw/settings/api

echo "Singlet ETL/MCP Environment Setup"
echo "=================================="
echo ""
echo "Get your keys from the Supabase Dashboard:"
echo "  https://supabase.com/dashboard/project/vbswbitfyallghbgxkuw/settings/api"
echo ""

export SUPABASE_URL="https://vbswbitfyallghbgxkuw.supabase.co"

read -p "Paste your anon/public key: " SUPABASE_ANON_KEY
export SUPABASE_ANON_KEY

read -p "Paste your service_role key (for ETL writes): " SUPABASE_SERVICE_KEY
export SUPABASE_SERVICE_KEY

echo ""
echo "Environment variables set:"
echo "  SUPABASE_URL=$SUPABASE_URL"
echo "  SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY:0:20}..."
echo "  SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY:0:20}..."
echo ""
echo "Now run:"
echo "  python scripts/etl/etl_sync.py    # Populate database"
echo "  python -m singlet.mcp.smoke_test   # Test MCP tools"
echo "  python -m singlet.mcp.server       # Start MCP server"

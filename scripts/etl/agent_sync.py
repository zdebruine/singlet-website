#!/usr/bin/env python3
"""
ETL: Sync E2E validation results to Supabase.

Parses singlify/state/e2e_results.md and upserts to the e2e_results table.
Also syncs singlet-gpu/state/pareto-frontier.md to the gpu_frontier table.

Run after each agent cycle or via cron:
    0 * * * * python3 /mnt/home/debruinz/Singlet-AI/scripts/etl/agent_sync.py

Required env vars:
    SUPABASE_URL        - Supabase project URL
    SUPABASE_SERVICE_KEY - Service role key
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    from supabase import create_client, Client
except ImportError:
    sys.exit("Install: pip install supabase")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

E2E_FILE = Path("/mnt/home/debruinz/Singlet-AI/singlify/state/e2e_results.md")
FRONTIER_FILE = Path("/mnt/home/debruinz/Singlet-AI/singlet-gpu/state/pareto-frontier.md")


def get_client() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# ─── E2E Results Parser ──────────────────────────────────────────────────────

def parse_e2e_results() -> list[dict]:
    """Parse the E2E results markdown into structured records."""
    if not E2E_FILE.exists():
        return []

    content = E2E_FILE.read_text()
    records = []

    # Pattern: ## E2E-{PANEL}-{SAMPLE} — {DATE}
    section_pattern = re.compile(
        r"## E2E-(\w+)-(\S+)\s*[—–-]\s*(\d{4}-\d{2}-\d{2})"
    )
    commit_pattern = re.compile(r"\*\*singlet commit\*\*:\s*`?(\w+)`?", re.IGNORECASE)
    tool_pattern = re.compile(r"\*\*External tool\*\*:\s*(.+)", re.IGNORECASE)
    metric_pattern = re.compile(
        r"\*\*Metric\*\*:\s*(\S+)\s*=\s*([\d.]+)\s*\(threshold:\s*([\d.]+)\)",
        re.IGNORECASE,
    )
    status_pattern = re.compile(r"\*\*Status\*\*:\s*(?:✅|⚠️|❌)\s*(\w+)", re.IGNORECASE)

    # Split into sections
    sections = re.split(r"(?=## E2E-)", content)

    for section in sections:
        header = section_pattern.search(section)
        if not header:
            continue

        panel = header.group(1)
        sample = header.group(2)
        date_str = header.group(3)

        commit_m = commit_pattern.search(section)
        tool_m = tool_pattern.search(section)
        metric_m = metric_pattern.search(section)
        status_m = status_pattern.search(section)

        if not all([commit_m, tool_m, metric_m, status_m]):
            continue

        records.append({
            "panel": panel,
            "sample_srr": sample,
            "singlet_commit": commit_m.group(1),
            "external_tool": tool_m.group(1).strip(),
            "metric_name": metric_m.group(1),
            "metric_value": float(metric_m.group(2)),
            "threshold": float(metric_m.group(3)),
            "status": status_m.group(1).upper(),
            "run_date": f"{date_str}T00:00:00Z",
        })

    return records


# ─── GPU Frontier Parser ─────────────────────────────────────────────────────

def parse_frontier() -> list[dict]:
    """Parse the Pareto frontier markdown into structured records."""
    if not FRONTIER_FILE.exists():
        return []

    content = FRONTIER_FILE.read_text()
    records = []

    # Look for table rows: | feature | scale | wall | mem | sota | ratio | ... |
    # Or structured sections with benchmark data
    # Pattern for table rows (markdown tables)
    table_row = re.compile(
        r"\|\s*(\S+)\s*\|\s*(\S+)\s*\|\s*([\d.]+)\s*(?:ms)?\s*\|\s*([\d.]+)\s*(?:MB)?\s*\|"
        r"\s*(\S+)\s*\|\s*([\d.]+)\s*(?:ms)?\s*\|\s*([\d.]+)x?\s*\|"
    )

    # Also parse section-based format
    feature_section = re.compile(r"##\s+(\S+)")
    speedup_pattern = re.compile(r"(\d+(?:\.\d+)?)x\s+(?:faster|wall|speedup)", re.IGNORECASE)
    memory_pattern = re.compile(r"(\d+(?:\.\d+)?)x\s+memory", re.IGNORECASE)
    correctness_pattern = re.compile(r"r\s*[=≥]\s*([\d.]+)", re.IGNORECASE)

    for row in table_row.finditer(content):
        records.append({
            "feature": row.group(1),
            "scale": row.group(2),
            "wall_ms": float(row.group(3)),
            "memory_mb": float(row.group(4)),
            "sota_tool": row.group(5),
            "sota_wall_ms": float(row.group(6)),
            "speedup": float(row.group(7)),
            "measured_date": datetime.now(timezone.utc).isoformat(),
        })

    return records


def sync_e2e(client: Client):
    """Sync E2E results to Supabase."""
    records = parse_e2e_results()
    if not records:
        print("  No E2E records to sync")
        return 0

    try:
        client.table("e2e_results").upsert(
            records,
            on_conflict="panel,sample_srr,singlet_commit,metric_name",
        ).execute()
        print(f"  Synced {len(records)} E2E results")
        return len(records)
    except Exception as e:
        print(f"  [ERROR] E2E sync failed: {e}", file=sys.stderr)
        return 0


def sync_frontier(client: Client):
    """Sync GPU frontier to Supabase."""
    records = parse_frontier()
    if not records:
        print("  No frontier records to sync")
        return 0

    try:
        client.table("gpu_frontier").upsert(
            records,
            on_conflict="feature,scale,cycle_number",
        ).execute()
        print(f"  Synced {len(records)} frontier entries")
        return len(records)
    except Exception as e:
        print(f"  [ERROR] Frontier sync failed: {e}", file=sys.stderr)
        return 0


def main():
    print(f"[{datetime.now(timezone.utc).isoformat()}] Agent sync starting...")
    client = get_client()

    e2e_count = sync_e2e(client)
    frontier_count = sync_frontier(client)

    print(f"  Done. E2E: {e2e_count}, Frontier: {frontier_count}")


if __name__ == "__main__":
    main()

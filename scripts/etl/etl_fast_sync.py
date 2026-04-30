#!/usr/bin/env python3
"""Fast ETL: Sync pipeline result JSONs to Supabase without NFS-intensive lookups.

Unlike the full etl_sync.py, this skips pz_path resolution and QC metric enrichment
(which require walking the NFS quant directory). Those can be backfilled later.

Usage:
    python3 scripts/etl/etl_fast_sync.py [--dry-run] [--limit N]
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

RESULTS_ROOT = Path("/mnt/projects/debruinz_project/singlify_pipeline/results")
BATCH_SIZE = 50


def get_supabase_client():
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        sys.exit("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    from supabase import create_client
    return create_client(url, key)


def result_to_row(data: dict) -> dict[str, Any] | None:
    """Convert a result JSON to a Supabase row (minimal fields, no NFS)."""
    gsm_id = data.get("gsm_id")
    if not gsm_id:
        return None

    row: dict[str, Any] = {
        "gsm_id": gsm_id,
        "gse_id": data.get("gse_id", ""),
        "srr_ids": "{" + data["srr_id"] + "}" if data.get("srr_id") else None,
        "organism": data.get("organism", "unknown"),
        "protocol": data.get("autodetect_protocol"),
        "modality": data.get("modality", "scrna"),
        "status": data.get("status", "UNKNOWN"),
        "failure_category": data.get("failure_category") or None,
        "mapping_rate": data.get("mapping_rate"),
        "cells_called": data.get("cells_called"),
        "wall_time_s": data.get("wall_time_s"),
        "download_path": data.get("download_path_used"),
        "singlet_version": data.get("singlify_version") or data.get("singlet_version"),
        "singlet_commit": data.get("singlify_commit") or data.get("singlet_commit"),
        "pipeline_date": datetime.now(timezone.utc).isoformat(),
    }

    # Remove None values to avoid overwriting existing data
    # Keep "unknown" organism to satisfy NOT NULL constraint
    return {k: v for k, v in row.items() if v is not None}


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Don't write to Supabase")
    parser.add_argument("--limit", type=int, default=0, help="Max results to sync (0=all)")
    parser.add_argument("--month", default="2026-04", help="Month directory to scan")
    args = parser.parse_args()

    month_dir = RESULTS_ROOT / args.month
    if not month_dir.exists():
        sys.exit(f"Results directory not found: {month_dir}")

    # Use os.scandir for performance (much faster than glob on NFS)
    print(f"Scanning {month_dir}...")
    t0 = time.time()
    result_files = []
    with os.scandir(month_dir) as it:
        for entry in it:
            if entry.name.endswith(".json") and entry.name.startswith("GSM"):
                result_files.append(entry.path)
                if args.limit and len(result_files) >= args.limit:
                    break
    scan_time = time.time() - t0
    print(f"Found {len(result_files)} result JSONs in {scan_time:.1f}s")

    # Read and convert
    rows = []
    errors = 0
    for path in result_files:
        try:
            data = json.loads(Path(path).read_text())
            row = result_to_row(data)
            if row:
                rows.append(row)
        except Exception as e:
            errors += 1

    print(f"Converted {len(rows)} rows ({errors} errors)")

    # Status breakdown
    from collections import Counter
    statuses = Counter(r.get("status", "?") for r in rows)
    for status, count in statuses.most_common():
        print(f"  {status}: {count}")

    if args.dry_run:
        print("\n[DRY RUN] Would upsert to Supabase samples table")
        if rows:
            print(f"\nSample row: {json.dumps(rows[0], indent=2)}")
        return

    # Upsert to Supabase
    client = get_supabase_client()
    success = 0
    batch_errors = 0

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        try:
            client.table("samples").upsert(batch, on_conflict="gsm_id").execute()
            success += len(batch)
            print(f"  Upserted batch {i//BATCH_SIZE + 1}: {len(batch)} rows (total: {success})")
        except Exception as e:
            batch_errors += 1
            print(f"  ERROR batch {i//BATCH_SIZE + 1}: {e}")

    print(f"\nDone: {success} upserted, {batch_errors} batch errors")

    # Refresh materialized views
    if success > 0:
        try:
            client.rpc("refresh_corpus_stats").execute()
            print("Materialized views refreshed")
        except Exception as e:
            print(f"Warning: could not refresh views: {e}")


if __name__ == "__main__":
    main()

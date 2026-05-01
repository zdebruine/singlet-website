#!/usr/bin/env python3
"""
ETL: Sync singlet pipeline results to Supabase.

Scans /mnt/projects/debruinz_project/singlify_pipeline/results/ for new result JSONs,
enriches them with batch metadata (organism, protocol), QC metrics from quant dirs,
and upserts to Supabase `samples` table.

Run via cron every 15 minutes:
    */15 * * * * /mnt/home/debruinz/.conda/envs/cellarium/bin/python /mnt/home/debruinz/Singlet-AI/singletai-website/scripts/etl/etl_sync.py >> /mnt/projects/debruinz_project/singlify_pipeline/logs/etl_sync.log 2>&1

Required env vars:
    SUPABASE_URL        - Supabase project URL
    SUPABASE_SERVICE_KEY - Service role key (for writes)
"""

from __future__ import annotations

import glob
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from supabase import create_client, Client
except ImportError:
    sys.exit("Install: pip install supabase")

# ─── Configuration ───────────────────────────────────────────────────────────

RESULTS_ROOT = Path("/mnt/projects/debruinz_project/singlify_pipeline/results")
QUANT_ROOT = Path("/mnt/projects/debruinz_project/singlify_pipeline/quant")
PIPELINE_ROOT = Path("/mnt/projects/debruinz_project/singlify_pipeline")
STATE_FILE = Path("/mnt/home/debruinz/Singlet-AI/singletai-website/scripts/etl/.etl-state.json")
BATCH_SIZE = 50  # upsert in batches (smaller to avoid single-row failures killing whole batch)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def get_supabase_client() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def load_state() -> dict:
    """Load last sync state (timestamp of last successful sync)."""
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {"last_sync": "2020-01-01T00:00:00Z", "total_synced": 0}


def save_state(state: dict):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))


def build_batch_metadata_index() -> dict[str, dict]:
    """Build GSM → metadata dict from all batch JSONs (organism, protocol, taxon_id)."""
    index: dict[str, dict] = {}
    for batch_file in sorted(PIPELINE_ROOT.glob("c*_batch.json")):
        try:
            entries = json.loads(batch_file.read_text())
            for entry in entries:
                gsm = entry.get("gsm_id")
                if gsm:
                    index[gsm] = {
                        "organism": entry.get("organism", "unknown"),
                        "protocol": entry.get("protocol", ""),
                        "taxon_id": entry.get("taxon_id"),
                    }
        except (json.JSONDecodeError, OSError):
            continue
    return index


def get_existing_gsm_ids(client: Client) -> set[str]:
    """Get all GSM IDs already in Supabase."""
    existing = set()
    offset = 0
    while True:
        r = client.table("samples").select("gsm_id").range(offset, offset + 999).execute()
        existing.update(row["gsm_id"] for row in r.data)
        if len(r.data) < 1000:
            break
        offset += 1000
    return existing


def find_new_results(existing_gsms: set[str]) -> list[Path]:
    """Find result JSONs not yet in Supabase."""
    results = []
    for month_dir in sorted(RESULTS_ROOT.iterdir()):
        if not month_dir.is_dir():
            continue
        for f in month_dir.glob("GSM*.json"):
            gsm_id = f.stem
            if gsm_id not in existing_gsms:
                results.append(f)
    return results


def read_summary_json(gsm_id: str) -> dict[str, Any]:
    """Read QC metrics from quant summary.json if available."""
    pattern = f"{QUANT_ROOT}/scrna/*/*/{gsm_id}/summary.json"
    matches = glob.glob(pattern)
    if not matches:
        return {}
    try:
        data = json.loads(Path(matches[0]).read_text())
        metrics = {}
        if data.get("median_genes_per_cell"):
            metrics["median_genes"] = int(data["median_genes_per_cell"])
        if data.get("median_umis_per_cell"):
            metrics["median_umis"] = int(data["median_umis_per_cell"])
        if data.get("mt_pct") is not None:
            metrics["mt_pct"] = round(float(data["mt_pct"]), 4)
        if data.get("doublet_rate") is not None:
            metrics["doublet_rate"] = round(float(data["doublet_rate"]), 4)
        if data.get("cells_called"):
            metrics["cells_called"] = int(data["cells_called"])
        return metrics
    except (json.JSONDecodeError, OSError, ValueError):
        return {}


def enrich_result(result_path: Path, batch_index: dict[str, dict]) -> dict[str, Any] | None:
    """Read a result JSON and enrich with batch metadata + QC."""
    try:
        data = json.loads(result_path.read_text())
    except (json.JSONDecodeError, OSError):
        return None

    gsm_id = data.get("gsm_id")
    if not gsm_id:
        return None

    # Get organism from batch metadata (result JSONs often lack it)
    batch_meta = batch_index.get(gsm_id, {})
    organism = data.get("organism") or batch_meta.get("organism", "unknown")

    # Get protocol (try multiple field names used across batch versions)
    protocol = (
        data.get("autodetect_protocol")
        or data.get("detected_protocol")
        or data.get("catalog_protocol")
        or batch_meta.get("protocol", "")
    )

    # Read QC metrics from summary.json
    qc = read_summary_json(gsm_id) if data.get("status") == "SUCCESS" else {}

    # Build the row for Supabase
    row: dict[str, Any] = {
        "gsm_id": gsm_id,
        "gse_id": data.get("gse_id", ""),
        "organism": organism,
        "status": data.get("status", "UNKNOWN"),
        "protocol": protocol,
        "mapping_rate": data.get("mapping_rate"),
        "cells_called": data.get("cells_called"),
        "wall_time_s": int(data["wall_time_s"]) if data.get("wall_time_s") else None,
        "failure_category": data.get("failure_category") or None,
    }

    # Add QC metrics (from summary.json or result JSON)
    if qc:
        row.update(qc)

    # Remove None values and empty strings for optional fields
    return {k: v for k, v in row.items() if v is not None and v != ""}


def sync_results(client: Client, results: list[Path], batch_index: dict[str, dict]) -> tuple[int, int]:
    """Upsert results to Supabase in batches. Returns (success, errors)."""
    success = 0
    errors = 0

    batch: list[dict] = []
    for path in results:
        row = enrich_result(path, batch_index)
        if row:
            batch.append(row)

        if len(batch) >= BATCH_SIZE:
            ok, err = upsert_batch(client, batch)
            success += ok
            errors += err
            batch = []

    # Flush remaining
    if batch:
        ok, err = upsert_batch(client, batch)
        success += ok
        errors += err

    return success, errors


def upsert_batch(client: Client, batch: list[dict]) -> tuple[int, int]:
    """Upsert a batch of rows. Falls back to row-by-row on failure."""
    try:
        client.table("samples").upsert(batch, on_conflict="gsm_id").execute()
        return len(batch), 0
    except Exception as e:
        # Fall back to row-by-row to isolate bad rows
        ok = 0
        bad = 0
        for row in batch:
            try:
                client.table("samples").upsert(row, on_conflict="gsm_id").execute()
                ok += 1
            except Exception as row_err:
                print(f"  [ERROR] {row.get('gsm_id')}: {row_err}", file=sys.stderr)
                bad += 1
        return ok, bad


def refresh_views(client: Client):
    """Refresh materialized views."""
    try:
        client.rpc("refresh_corpus_stats").execute()
    except Exception as e:
        print(f"  [WARN] Could not refresh views: {e}", file=sys.stderr)


def main():
    start = time.time()
    print(f"[{datetime.now(timezone.utc).isoformat()}] ETL sync starting...")

    client = get_supabase_client()

    # Build metadata index from batch JSONs
    batch_index = build_batch_metadata_index()
    print(f"  Batch metadata index: {len(batch_index)} GSMs")

    # Find new results (not yet in Supabase)
    existing = get_existing_gsm_ids(client)
    print(f"  Existing in Supabase: {len(existing)}")

    results = find_new_results(existing)
    print(f"  New results to sync: {len(results)}")

    if not results:
        print("  Nothing to sync.")
        # Still update state timestamp
        state = load_state()
        state["last_sync"] = datetime.now(timezone.utc).isoformat()
        save_state(state)
        return

    success, errors = sync_results(client, results, batch_index)
    print(f"  Synced: {success} success, {errors} errors")

    # Refresh materialized views
    if success > 0:
        refresh_views(client)
        print("  Materialized views refreshed")

    # Update state
    state = load_state()
    state["last_sync"] = datetime.now(timezone.utc).isoformat()
    state["total_synced"] = state.get("total_synced", 0) + success
    save_state(state)

    elapsed = time.time() - start
    print(f"  Done in {elapsed:.1f}s. Total synced: {state['total_synced']}")


if __name__ == "__main__":
    main()

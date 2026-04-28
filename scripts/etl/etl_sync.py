#!/usr/bin/env python3
"""
ETL: Sync singlet pipeline results to Supabase.

Scans /mnt/projects/debruinz_project/singlify_pipeline/results/ for new result JSONs,
enriches them with .1pz metadata and QC metrics, and upserts to Supabase `samples` table.

Run via cron every 15 minutes:
    */15 * * * * /mnt/home/debruinz/.conda/envs/cellarium/bin/python /mnt/home/debruinz/Singlet-AI/scripts/etl/etl_sync.py >> /mnt/projects/debruinz_project/singlify_pipeline/logs/etl_sync.log 2>&1

Required env vars:
    SUPABASE_URL        - Supabase project URL
    SUPABASE_SERVICE_KEY - Service role key (for writes)
"""

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
STATE_FILE = Path("/mnt/home/debruinz/Singlet-AI/singletai-website/scripts/etl/.etl-state.json")
BATCH_SIZE = 100  # upsert in batches

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


def find_new_results(since: str) -> list[Path]:
    """Find all result JSONs modified after the given timestamp."""
    since_ts = datetime.fromisoformat(since.replace("Z", "+00:00")).timestamp()
    results = []
    for month_dir in sorted(RESULTS_ROOT.iterdir()):
        if not month_dir.is_dir():
            continue
        for f in month_dir.glob("*.json"):
            if f.stat().st_mtime > since_ts:
                results.append(f)
    return results


def find_pz_path(gsm_id: str) -> str | None:
    """Find the .1pz file path for a given GSM ID."""
    for modality in ["scrna", "cite", "multiome", "visium", "atac"]:
        modality_dir = QUANT_ROOT / modality
        if not modality_dir.exists():
            continue
        # Pattern: modality/GSE{shard}/GSE{id}/GSM{id}/
        for gse_shard in modality_dir.iterdir():
            if not gse_shard.is_dir():
                continue
            for gse_dir in gse_shard.iterdir():
                gsm_dir = gse_dir / gsm_id
                if gsm_dir.exists():
                    # Find the primary .1pz file
                    for pz in gsm_dir.glob("*.1pz"):
                        return str(pz)
    return None


def read_qc_metrics(gsm_id: str, pz_path: str | None) -> dict[str, Any]:
    """Read additional QC metrics from cell_qc_metrics.tsv if available."""
    metrics: dict[str, Any] = {}
    if not pz_path:
        return metrics

    qc_file = Path(pz_path).parent / "cell_qc_metrics.tsv"
    if not qc_file.exists():
        return metrics

    try:
        import csv
        with open(qc_file) as f:
            reader = csv.DictReader(f, delimiter="\t")
            rows = list(reader)

        if not rows:
            return metrics

        # Compute medians from per-cell data
        def median_of(col: str) -> float | None:
            vals = sorted(float(r[col]) for r in rows if r.get(col) and r[col] != "NA")
            if not vals:
                return None
            mid = len(vals) // 2
            return vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2

        metrics["median_genes"] = int(median_of("n_genes") or 0) or None
        metrics["median_umis"] = int(median_of("total_counts") or 0) or None
        mt = median_of("pct_counts_mt")
        if mt is not None:
            metrics["mt_pct"] = round(mt, 2)
    except Exception:
        pass

    return metrics


def enrich_result(result_path: Path) -> dict[str, Any] | None:
    """Read a result JSON and enrich with additional metadata."""
    try:
        data = json.loads(result_path.read_text())
    except (json.JSONDecodeError, OSError):
        return None

    gsm_id = data.get("gsm_id")
    if not gsm_id:
        return None

    # Find .1pz file
    pz_path = find_pz_path(gsm_id)
    pz_size = None
    if pz_path and Path(pz_path).exists():
        pz_size = Path(pz_path).stat().st_size

    # Read QC metrics
    qc = read_qc_metrics(gsm_id, pz_path)

    # Build the row for Supabase
    row = {
        "gsm_id": gsm_id,
        "gse_id": data.get("gse_id", ""),
        "srr_ids": [data["srr_id"]] if data.get("srr_id") else [],
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
        "pipeline_date": data.get("pipeline_date"),
        "pz_path": pz_path,
        "pz_size_bytes": pz_size,
        "title": data.get("geo_title"),
        "source": data.get("geo_source"),
        "characteristics": data.get("geo_characteristics") or {},
        **qc,
    }

    # Remove None values to avoid overwriting existing data
    return {k: v for k, v in row.items() if v is not None}


def sync_results(client: Client, results: list[Path]) -> tuple[int, int]:
    """Upsert results to Supabase in batches. Returns (success, errors)."""
    success = 0
    errors = 0

    batch: list[dict] = []
    for path in results:
        row = enrich_result(path)
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
    """Upsert a batch of rows to the samples table."""
    try:
        client.table("samples").upsert(
            batch,
            on_conflict="gsm_id",
        ).execute()
        return len(batch), 0
    except Exception as e:
        print(f"  [ERROR] Batch upsert failed: {e}", file=sys.stderr)
        return 0, len(batch)


def refresh_views(client: Client):
    """Refresh materialized views."""
    try:
        client.rpc("refresh_corpus_stats").execute()
    except Exception as e:
        print(f"  [WARN] Could not refresh views: {e}", file=sys.stderr)


def main():
    start = time.time()
    print(f"[{datetime.now(timezone.utc).isoformat()}] ETL sync starting...")

    state = load_state()
    results = find_new_results(state["last_sync"])
    print(f"  Found {len(results)} new/updated result files since {state['last_sync']}")

    if not results:
        print("  Nothing to sync.")
        return

    client = get_supabase_client()
    success, errors = sync_results(client, results)
    print(f"  Synced: {success} success, {errors} errors")

    # Refresh materialized views
    if success > 0:
        refresh_views(client)
        print("  Materialized views refreshed")

    # Update state
    state["last_sync"] = datetime.now(timezone.utc).isoformat()
    state["total_synced"] = state.get("total_synced", 0) + success
    save_state(state)

    elapsed = time.time() - start
    print(f"  Done in {elapsed:.1f}s. Total synced: {state['total_synced']}")


if __name__ == "__main__":
    main()

"""
build_timeseries.py

Read hourly history JSON snapshots from both clusters and generate compact
timeseries JSON files for the frontend to render plots.
"""
from __future__ import annotations

import json
import re
from pathlib import Path


FILENAME_RE = re.compile(r"(\d{4})(\d{2})(\d{2})T(\d{2})Z\.json$")


def parse_timestamp_from_filename(path: Path) -> str | None:
    """Parse a filename like 20260604T20Z.json → 2026-06-04T20:00Z."""
    m = FILENAME_RE.search(path.name)
    if not m:
        return None
    year, month, day, hour = m.groups()
    return f"{year}-{month}-{day}T{hour}:00Z"


def avg_cpu(partitions: list) -> float | None:
    """Average cpu_util_pct across all partitions."""
    values = [
        p["cpu_util_pct"]
        for p in partitions
        if isinstance(p, dict) and p.get("cpu_util_pct") is not None
    ]
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def snapshot_to_tick(snapshot: dict, fallback_ts: str | None) -> dict:
    """Convert a snapshot dict to a single timeseries tick."""
    kpi = snapshot.get("kpi") or {}
    partitions = snapshot.get("partitions") or []

    t = snapshot.get("generated_at") or fallback_ts

    return {
        "t": t,
        "cells": kpi.get("cells_total"),
        "samples": kpi.get("samples_success"),
        "reads": kpi.get("reads_total"),
        "umis": kpi.get("umis_total"),
        "cpu_pct": avg_cpu(partitions),
        "disk_tb": kpi.get("disk_usage_tb"),
        "in_flight": kpi.get("samples_in_flight"),
        "failed": kpi.get("samples_failed_terminal"),
    }


def build_timeseries(history_dir: Path, output_path: Path) -> None:
    """Build a timeseries JSON from all snapshots in history_dir."""
    history_dir = history_dir.resolve()
    output_path = output_path.resolve()

    if not history_dir.exists():
        print(f"[warn] history dir not found, skipping: {history_dir}")
        return

    ticks = []
    for snap_path in sorted(history_dir.glob("*.json")):
        fallback_ts = parse_timestamp_from_filename(snap_path)
        try:
            with snap_path.open() as f:
                snapshot = json.load(f)
        except (json.JSONDecodeError, OSError) as exc:
            print(f"[warn] skipping malformed file {snap_path.name}: {exc}")
            continue

        tick = snapshot_to_tick(snapshot, fallback_ts)
        if tick["t"] is None:
            print(f"[warn] no timestamp for {snap_path.name}, skipping")
            continue
        ticks.append(tick)

    # Sort by timestamp string (ISO 8601 sorts lexicographically)
    ticks.sort(key=lambda t: t["t"])

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w") as f:
        json.dump(ticks, f, indent=2)
    print(f"[ok] wrote {len(ticks)} ticks → {output_path}")


if __name__ == "__main__":
    BASE = Path(__file__).resolve().parent.parent / "public" / "data" / "hpc"

    build_timeseries(
        history_dir=BASE / "history",
        output_path=BASE / "timeseries.json",
    )

    build_timeseries(
        history_dir=BASE / "anvil" / "history",
        output_path=BASE / "anvil" / "timeseries.json",
    )

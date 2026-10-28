#!/usr/bin/env python3
"""Fetch GEO sample text (characteristics, source, title, description) for samples whose text was never stored in D1.

argv: WANTED_TSV OUT_JSONL
WANTED_TSV: gsm_id <TAB> gse_id, one sample per line. Run on Clipper as a Slurm job (never on the login node).

One request per series (acc.cgi targ=gsm, the SOFT of every sample in it); samples a series answer did not include are then fetched
one by one. At most RATE requests a second to NCBI, with a User-Agent. Resumable: series and samples already in OUT_JSONL are skipped.
Output, one JSON object per sample: gsm_id, gse_id (the series asked), title, source, characteristics (several joined with " ;; ", as
scripts/catalog/fetch_geo_metadata.py in singlet-agents does), description, via ("series" | "sample"), or error.
"""
import json
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

RATE = 2.5  # requests per second; NCBI allows 3 without an API key
UA = "singlet.bio-catalog/1.0 (zacharydebruine@gmail.com)"
URL = "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={acc}&targ={targ}&form=text&view=full"
_last = [0.0]


def get(acc: str, targ: str) -> str:
    for attempt in range(5):
        wait = _last[0] + 1.0 / RATE - time.time()
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            req = urllib.request.Request(URL.format(acc=acc, targ=targ), headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read().decode("utf-8", errors="replace")
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            if attempt == 4:
                raise
            time.sleep(min(60, 3 * 2 ** attempt))
            print(f"retry {acc}: {e}", flush=True)
    raise RuntimeError("unreachable")


def parse(text: str) -> dict[str, dict]:
    """GSM id -> fields, from SOFT text holding one or more ^SAMPLE blocks."""
    out: dict[str, dict] = {}
    cur = None
    multi: dict[str, list] = defaultdict(list)

    def flush():
        if cur:
            out[cur] = {
                "title": " ;; ".join(multi.get("title", [])) or None,
                "source": " ;; ".join(multi.get("source_name_ch1", [])) or None,
                "characteristics": " ;; ".join(multi.get("characteristics_ch1", [])) or None,
                "description": " ;; ".join(multi.get("description", [])) or None,
            }

    for line in text.split("\n"):
        line = line.rstrip("\r")
        if line.startswith("^SAMPLE"):
            flush()
            cur = line.partition("=")[2].strip()
            multi = defaultdict(list)
        elif cur and line.startswith("!Sample_"):
            key, _, val = line.partition(" = ")
            key = key[len("!Sample_"):].strip()
            if val.strip():
                multi[key].append(val.strip())
    flush()
    return out


def main():
    wanted_p, out_p = sys.argv[1], Path(sys.argv[2])
    by_gse: dict[str, set] = defaultdict(set)
    for ln in open(wanted_p):
        if ln.strip():
            gsm, gse = ln.split("\t")[:2]
            by_gse[gse.strip()].add(gsm.strip())
    done = set()
    if out_p.exists():
        for ln in open(out_p):
            done.add(json.loads(ln)["gsm_id"])
    fh = open(out_p, "a")
    n_series = 0
    missing: list[tuple[str, str]] = []
    for gse in sorted(by_gse):
        need = by_gse[gse] - done
        if not need:
            continue
        n_series += 1
        try:
            got = parse(get(gse, "gsm"))
        except Exception as e:  # noqa: BLE001
            print(f"series {gse} failed: {e}", flush=True)
            got = {}
        for gsm in sorted(need):
            if gsm in got:
                fh.write(json.dumps({"gsm_id": gsm, "gse_id": gse, **got[gsm], "via": "series"}) + "\n")
                done.add(gsm)
            else:
                missing.append((gsm, gse))
        fh.flush()
        if n_series % 100 == 0:
            print(f"{n_series} series, {len(done)} samples, {len(missing)} left for single fetch", flush=True)
    for gsm, gse in missing:
        try:
            got = parse(get(gsm, "self")).get(gsm)
            rec = {"gsm_id": gsm, "gse_id": gse, **got, "via": "sample"} if got else {"gsm_id": gsm, "gse_id": gse, "error": "no sample block"}
        except Exception as e:  # noqa: BLE001
            rec = {"gsm_id": gsm, "gse_id": gse, "error": str(e)}
        fh.write(json.dumps(rec) + "\n")
        fh.flush()
    print(json.dumps({"series": n_series, "samples": len(done), "single_fetches": len(missing)}), flush=True)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Build a processing catalog (parquet) for pack_gse from GEO SOFT.

Columns are the ones singlet.bundle.pack_gse reads (gse_id, gsm_id, organism, protocol_inferred, sample_source,
sample_characteristics, qc_flag, processing_status, series_title, summary, overall_design) plus the GEO fields that the
v2 catalog lacked (gsm_title, protocols, library strategy, SRA relation, pubmed ids, submission/update dates, contact).
sample_characteristics keeps the GEO text as "key: value; key: value" (the structured gsm columns in D1 are empty,
so downstream search reads this text).

usage: build_catalog_v3.py OUT.parquet GSE... [--targets targets_v3.tsv] [--status done]
Run on a compute node (needs outbound internet to ncbi.nlm.nih.gov); pandas + pyarrow from the Anvil conda module.
"""
import argparse
import re
import sys
import time
import urllib.request

import pandas as pd

SOFT = "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={}&targ=all&form=text&view=brief"


def fetch(gse, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(SOFT.format(gse), timeout=90) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            print(f"[{gse}] fetch attempt {i + 1}: {e}", file=sys.stderr)
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"cannot fetch SOFT for {gse}")


def parse(gse, text):
    ser, gsms, cur = {}, [], None
    for line in text.splitlines():
        if line.startswith("^SAMPLE"):
            cur = {"gsm_id": line.split("=", 1)[1].strip(), "_chars": [], "_rel": []}
            gsms.append(cur)
            continue
        if line.startswith("^SERIES"):
            cur = None
            continue
        if not line.startswith("!") or "=" not in line:
            continue
        k, v = (s.strip() for s in line[1:].split("=", 1))
        if cur is None:
            ser.setdefault(k, []).append(v)
        elif k.startswith("Sample_characteristics_ch"):
            cur["_chars"].append(v)
        elif k == "Sample_relation":
            cur["_rel"].append(v)
        else:
            cur.setdefault(k, v)
    return ser, gsms


def rows_for(gse, status, qc_flag, tgt=None, results=None):
    """tgt: {gsm: all_srrs csv} for this GSE (restricts rows to campaign targets); results: results dir -> real status."""
    import json, os
    ser, gsms = parse(gse, fetch(gse))
    n_total = len(gsms)
    if tgt is not None:
        gsms = [g for g in gsms if g["gsm_id"] in tgt]
    j = lambda k: " ".join(ser.get(k, []))  # noqa: E731
    out = []
    for g in gsms:
        st, why = status, ""
        if results:
            d = f"{results}/{g['gsm_id']}"
            if os.path.exists(f"{d}/out/pileup_stats.json"):
                st = "done"
            elif os.path.exists(f"{d}/.rejected"):
                why = open(f"{d}/.rejected").read().split()[0]
                st = "fail_" + why
            else:
                continue  # not terminal: leave out
        out.append({
            "gse_id": gse, "gsm_id": g["gsm_id"],
            "organism": g.get("Sample_organism_ch1", ""),
            "protocol_inferred": "",
            "sample_source": g.get("Sample_source_name_ch1", ""),
            "sample_characteristics": "; ".join(g["_chars"]),
            "qc_flag": qc_flag, "processing_status": st,
            "disk_status": "done_singlify" if st == "done" else "", "failure_category": why,
            "srr_accessions": json.dumps((tgt or {}).get(g["gsm_id"], "").split(",")) if tgt else "",
            "n_gsm_in_series": n_total,
            "reconciled_at": __import__("datetime").datetime.utcnow().isoformat(timespec="seconds"),
            "series_title": j("Series_title"), "summary": j("Series_summary"),
            "overall_design": j("Series_overall_design"),
            # GEO fields beyond the v2 catalog
            "gsm_title": g.get("Sample_title", ""),
            "growth_protocol": g.get("Sample_growth_protocol_ch1", ""),
            "treatment_protocol": g.get("Sample_treatment_protocol_ch1", ""),
            "extract_protocol": g.get("Sample_extract_protocol_ch1", ""),
            "library_strategy": g.get("Sample_library_strategy", ""),
            "library_source": g.get("Sample_library_source", ""),
            "instrument_model": g.get("Sample_instrument_model", ""),
            "sra_relation": "; ".join(r for r in g["_rel"] if r.startswith("SRA")),
            "pubmed_ids": ",".join(ser.get("Series_pubmed_id", [])),
            "submission_date": j("Series_submission_date"),
            "last_update_date": j("Series_last_update_date"),
            "series_type": "; ".join(ser.get("Series_type", [])),
            "contributors": "; ".join(ser.get("Series_contributor", [])),
            "geo_url": f"https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={gse}",
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("gse", nargs="*")
    ap.add_argument("--targets", help="targets_v3.tsv (gsm primary_srr protocol_tag species gse ...): GSEs and GSM filter")
    ap.add_argument("--status", default="done")
    ap.add_argument("--qc-flag", default="")
    ap.add_argument("--results", help="results dir: status per GSM from out/pileup_stats.json or .rejected; non-terminal GSMs omitted")
    ap.add_argument("--only-gsm", default="", help="comma list: keep only these GSMs (smoke test)")
    a = ap.parse_args()
    gses = list(a.gse)
    if a.targets:
        for line in open(a.targets):
            f = line.rstrip("\n").split("\t")
            if len(f) > 4 and f[0] not in ("gsm", "") and not f[0].startswith("#") and f[4] not in gses:
                gses.append(f[4])
    rows = []
    for g in gses:
        rows += rows_for(g, a.status, a.qc_flag)
        time.sleep(0.4)  # NCBI courtesy rate
    df = pd.DataFrame(rows)
    if a.only_gsm:
        keep = set(a.only_gsm.split(","))
        df = df[df.gsm_id.isin(keep)]
    df.to_parquet(a.out, index=False)
    print(f"wrote {a.out}: {len(df)} GSMs in {df.gse_id.nunique()} GSEs")


if __name__ == "__main__":
    main()

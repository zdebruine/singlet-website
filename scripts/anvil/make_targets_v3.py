#!/usr/bin/env python3
"""Build a targets_v3.tsv (rows: gsm primary_srr protocol_tag species gse gse_pdat n_runs all_srrs) from GEO + ENA.

GSM, organism and SRX come from the GEO series SOFT (brief); runs and read counts from ENA filereport for the
series' BioProject. Only human (GRCh38) and mouse (GRCm39) RNA-Seq samples are kept. primary_srr is the run with
the most reads. A sample whose runs are not mirrored in ENA yet (all read_count 0 / none) goes to the pending file
instead, so a later call (the controller re-runs this each day until the cutoff) can pick it up.

usage: make_targets_v3.py --studies new_studies.tsv --tier A --out targets_A.tsv [--pending pending_A.tsv] [--limit N]
       make_targets_v3.py --gse GSE1 GSE2 ... --out targets.tsv
Run on a compute node (outbound internet). Standard library only.
"""
import argparse, csv, re, sys, time, urllib.parse, urllib.request

SOFT = "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={}&targ=all&form=text&view=brief"
ENA = "https://www.ebi.ac.uk/ena/portal/api/filereport?"

SPECIES = {"Homo sapiens": "human", "Mus musculus": "mouse"}


def get(url, tries=6):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            print(f"  retry {i + 1} {url[:90]}: {e}", file=sys.stderr)
            time.sleep(3 * (i + 1))
    return ""


def parse_soft(text):
    bp, pdat, gsms, cur = "", "", [], None
    for line in text.splitlines():
        if line.startswith("^SAMPLE"):
            cur = {"gsm": line.split("=", 1)[1].strip(), "org": "", "srx": "", "strategy": ""}
            gsms.append(cur)
        elif line.startswith("^SERIES"):
            cur = None
        elif line.startswith("!") and "=" in line:
            k, v = (s.strip() for s in line[1:].split("=", 1))
            if cur is None:
                if k == "Series_relation" and "BioProject" in v:
                    m = re.search(r"PRJ[A-Z]{2}\d+", v)
                    bp = bp or (m.group(0) if m else "")
                elif k == "Series_submission_date":
                    pdat = v
            else:
                if k == "Sample_organism_ch1" and not cur["org"]:
                    cur["org"] = v
                elif k == "Sample_relation" and v.startswith("SRA:"):
                    m = re.search(r"[SED]RX\d+", v)
                    cur["srx"] = m.group(0) if m else ""
                elif k == "Sample_library_strategy":
                    cur["strategy"] = v
    return bp, pdat, gsms


def runs_by_srx(bp):
    txt = get(ENA + urllib.parse.urlencode(dict(
        accession=bp, result="read_run", format="tsv",
        fields="run_accession,experiment_accession,read_count,library_strategy,library_source")))
    if not txt:
        return None  # ENA error (not "no runs"): the caller records ena_error so a later run retries
    out = {}
    for row in csv.DictReader(txt.splitlines(), delimiter="\t"):
        try:
            n = int(row.get("read_count") or 0)
        except ValueError:
            n = 0
        out.setdefault(row["experiment_accession"], []).append((n, row["run_accession"], row.get("library_strategy", "")))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--studies"); ap.add_argument("--tier", default="A"); ap.add_argument("--gse", nargs="*", default=[])
    ap.add_argument("--out", required=True); ap.add_argument("--pending"); ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    gses = list(a.gse)
    if a.studies:
        for r in csv.DictReader(open(a.studies, encoding="utf8"), delimiter="\t"):
            if r["tier"].startswith(a.tier) and r["organism"] in SPECIES:
                gses.append(r["gse"])
    if a.limit:
        gses = gses[: a.limit]
    out = open(a.out, "w"); pend = open(a.pending, "w") if a.pending else None
    n_ok = n_pend = n_skip = 0
    for gse in gses:
        bp, pdat, gsms = parse_soft(get(SOFT.format(gse)))
        time.sleep(0.4)
        runs = runs_by_srx(bp) if bp else {}
        why = "no_runs_in_ena" if runs is not None else "ena_error"
        runs = runs or {}
        time.sleep(0.2)
        for g in gsms:
            sp = SPECIES.get(g["org"])
            if not sp or (g["strategy"] and g["strategy"] != "RNA-Seq"):
                n_skip += 1
                continue
            rs = sorted([r for r in runs.get(g["srx"], []) if r[0] > 0], reverse=True)
            if not rs:
                n_pend += 1
                if pend:
                    pend.write(f"{g['gsm']}\t{g['srx']}\t{sp}\t{gse}\t{pdat}\t{why}\n")
                continue
            allr = ",".join(r[1] for r in rs)
            out.write(f"{g['gsm']}\t{rs[0][1]}\tauto\t{sp}\t{gse}\t{pdat}\t{len(rs)}\t{allr}\n")
            n_ok += 1
    print(f"studies={len(gses)} targets={n_ok} pending(no runs yet)={n_pend} skipped(other species/assay)={n_skip}")


if __name__ == "__main__":
    main()

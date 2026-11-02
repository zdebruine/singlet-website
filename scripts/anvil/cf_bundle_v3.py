#!/usr/bin/env python3
"""Campaign v3 bundler: pack finished GSEs with the reconciled packer (pylib_v3/cf_pack_v3.py = singlet.bundle at the
binary's commit). New studies only, so no grow-from-v1 path and no D1 pre-check. Idempotent: a bundle is rebuilt only
when its done-GSM count grew. Run as a Slurm job (compute), not on a login node.

usage: cf_bundle_v3.py --catalog CAT.parquet --results DIR --out-dir DIR [--gse-list FILE | --gse GSE] [--jobs N]
"""
import argparse, json, multiprocessing as mp, os, sys, zipfile

R = os.environ.get("CF_ANVIL_ROOT", "/anvil/projects/x-bio260157/singlet_campaign")
sys.path.insert(0, f"{R}/pylib_v3")
import cf_pack_v3 as pack  # noqa: E402
import pandas as pd  # noqa: E402

_CAT = None


def _init(cat):
    global _CAT
    _CAT = pd.read_parquet(cat)


def _done(results, gsm):
    return os.path.exists(f"{results}/{gsm}/out/pileup_stats.json")


def _one(a):
    gse, results, cat, out_dir = a
    d = f"{out_dir}/{gse}"; b = f"{d}/{gse}.singlet"
    gsms = [g for g in _CAT[_CAT.gse_id == gse].gsm_id if _done(results, g)]
    if not gsms:
        return gse, "no_done_gsm"
    try:
        if os.path.exists(b):
            with zipfile.ZipFile(b) as z:
                have = json.load(z.open("manifest.json")).get("n_gsms", -1)
            if have >= len(gsms):
                return gse, "skip"
    except Exception:
        pass
    os.makedirs(d, exist_ok=True)
    try:
        pack.pack_gse(gse_id=gse, results_dir=results, catalog_path=cat, out_path=b, verbose=False,
                      series_meta_path=f"{d}/series_meta.json", _catalog_df=_CAT)
        return gse, "ok"
    except Exception as e:  # noqa: BLE001
        return gse, f"err:{e}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", required=True); ap.add_argument("--results", required=True)
    ap.add_argument("--out-dir", required=True); ap.add_argument("--gse-list"); ap.add_argument("--gse")
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    cat = pd.read_parquet(a.catalog)
    gses = [a.gse] if a.gse else ([l.strip() for l in open(a.gse_list) if l.strip()] if a.gse_list else sorted(cat.gse_id.unique()))
    work = [(g, a.results, a.catalog, a.out_dir) for g in gses]
    res = {}
    with mp.Pool(min(a.jobs, max(1, len(work))), initializer=_init, initargs=(a.catalog,)) as p:
        for g, st in p.imap_unordered(_one, work):
            res[g] = st
            if st.startswith("err") or st == "no_done_gsm":
                print(f"  {g}: {st}", file=sys.stderr)
    n_ok = sum(v == "ok" for v in res.values())
    print(f"bundled={n_ok} skipped={sum(v == 'skip' for v in res.values())} failed={sum(v.startswith('err') or v == 'no_done_gsm' for v in res.values())} total={len(work)}")


if __name__ == "__main__":
    main()

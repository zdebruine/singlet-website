#!/usr/bin/env python3
"""Publish finished studies from the cluster: pack -> R2 upload -> D1 upsert -> verify -> register -> clean scratch.

usage: publish_study_v3.py --targets TIER_TARGETS.tsv GSE [GSE ...]      (run through publish_v3.sbatch, on compute)

Per study, idempotent (marker state_v3/study/<GSE>.published makes a rerun a no-op):
  1. catalog slice from GEO SOFT + results dir (build_catalog_v3.py --results): done GSMs, fail_<reason> GSMs.
  2. pack with the reconciled packer (cf_bundle_v3.py).
  3. existing publisher, unchanged (cf_publish_anvil_v2.py) pointed at per-study paths through its env overrides:
     sync-catalog --all (D1 gse/gsm upsert through the HTTP API), upload-bundles --missing (R2 data/<GSE>/<GSE>.singlet
     + series_meta.json, sets r2_bundle_key/bytes/n_gsms).
  4. verify: R2 HEAD size == local size, D1 row has r2_bundle_key and bytes, GET /api/gse/<GSE> shows bundle_key + bytes.
  5. register: refresh-next / index-next with INGEST_TOKEN if the env has one; otherwise the 3-hourly catalog-crank does it.
  6. only after 4 passes: delete the study's scratch sample dirs and the local bundle; write the .published marker.
PUBLISH_DRY=1 stops after step 2 and prints what steps 3-6 would do (no R2, no D1 write).
Never prints credentials.
"""
import argparse, json, os, shutil, subprocess, sys, time, urllib.request

R = os.environ.get("CF_ANVIL_ROOT", "/anvil/projects/x-bio260157/singlet_campaign")
S = f"{R}/smoke_v3"
RESULTS = os.environ.get("SINGLET_RESULTS_DIR", "/anvil/scratch/x-zdebruine/results_v3")
STATE = f"{R}/state_v3"
BUNDLES = os.environ.get("CF_V3_BUNDLES_DIR", f"{R}/singlet_bundles_v3")
DRY = os.environ.get("PUBLISH_DRY") == "1"
UA = {"User-Agent": "singlet-anvil-campaign/1.0"}  # the site (Cloudflare) answers 403 to the default Python user agent
PY = os.environ.get("V3_PY", "/apps/anvil/external/apps/conda/2024.02/bin/python3")


def log(m):
    print(time.strftime("%Y-%m-%dT%H:%M:%S"), m, flush=True)


def run(cmd, env=None, check=True):
    log("$ " + " ".join(cmd))
    r = subprocess.run(cmd, env=env, capture_output=True, text=True)
    tail = (r.stdout + r.stderr).strip().splitlines()[-12:]
    for l in tail:
        print("   " + l)
    if check and r.returncode:
        raise RuntimeError(f"{cmd[1] if len(cmd) > 1 else cmd[0]} exit {r.returncode}")
    return r


def verify(gse, local_bundle):
    import boto3  # noqa: F401  (conda python has it; the publisher needs it too)
    key = f"data/{gse}/{gse}.singlet"
    size = os.path.getsize(local_bundle)
    s3 = boto3.client("s3", endpoint_url=os.environ["R2_ENDPOINT"], aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
                      aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"], region_name="auto")
    h = s3.head_object(Bucket=os.environ["R2_BUCKET"], Key=key)
    ok_r2 = h["ContentLength"] == size
    log(f"verify R2: key={key} remote={h['ContentLength']} local={size} etag={h.get('ETag')} ok={ok_r2}")
    ok_api = False
    for attempt in range(6):  # the API may cache for a short time
        try:
            with urllib.request.urlopen(urllib.request.Request(f"https://singlet.bio/api/gse/{gse}", headers=UA), timeout=60) as r:
                s = json.load(r)["series"]
            ok_api = s.get("bundle_key") == key and s.get("bundle_bytes") == size
            log(f"verify API: bundle_key={s.get('bundle_key')} bundle_bytes={s.get('bundle_bytes')} "
                f"n_gsm_done={s.get('n_gsm_done')} ok={ok_api}")
            if ok_api:
                break
        except Exception as e:  # noqa: BLE001
            log(f"verify API attempt {attempt + 1}: {e}")
        time.sleep(20)
    return ok_r2 and ok_api


def register():
    tok = os.environ.get("INGEST_TOKEN")
    if not tok:
        log("register: no INGEST_TOKEN on this host; catalog-crank (GitHub Actions, every 3 h) runs refresh-next/index-next")
        return
    def call(p):
        rq = urllib.request.Request(f"https://singlet.bio/api/ingest/{p}", headers=dict(UA, **{"X-Ingest-Token": tok}))
        with urllib.request.urlopen(rq, timeout=120) as r:
            return json.load(r)
    for ep in ("refresh-next?n=50", "index-next?n=25", "refresh-next?n=50"):
        for _ in range(40):
            b = call(ep)
            rem = b.get("remaining_total", b.get("remaining", 0))
            log(f"register {ep}: remaining={rem}")
            if not rem or rem < 0:
                break


def publish(gse, targets):
    mark = f"{STATE}/study/{gse}.published"
    if os.path.exists(mark):
        log(f"{gse}: already published, skipping")
        return True
    pdir = f"{STATE}/pub/{gse}"; os.makedirs(pdir, exist_ok=True)
    cat = f"{pdir}/catalog.parquet"
    run([PY, f"{S}/build_catalog_v3.py", cat, "--gse", gse, "--targets", targets, "--results", RESULTS])
    run([PY, f"{S}/cf_bundle_v3.py", "--catalog", cat, "--results", RESULTS, "--out-dir", BUNDLES, "--gse", gse, "--jobs", "1"])
    bundle = f"{BUNDLES}/{gse}/{gse}.singlet"
    if not os.path.exists(bundle):
        raise RuntimeError("no bundle produced")
    run([PY, f"{S}/verify_bundle_v3.py", bundle], check=False)
    if DRY:
        log(f"{gse}: DRY RUN, bundle {os.path.getsize(bundle)} bytes; would sync-catalog, upload-bundles, verify, register, clean")
        return True
    # existing publisher with per-study paths (symlinked single-bundle dir, per-study ledger)
    stage = f"{pdir}/bundles"; os.makedirs(stage, exist_ok=True)
    link = f"{stage}/{gse}"
    if os.path.islink(link):
        os.unlink(link)
    os.symlink(f"{BUNDLES}/{gse}", link)
    env = dict(os.environ, CF_V2_CATALOG=cat, CF_V2_BUNDLES_DIR=stage, CF_V2_STATE_DIR=f"{pdir}/ledger",
               CF_V2_SINGLET_VERSION=open(os.environ["V3_BIN_DIR"] + "/VERSION").read().strip())
    pub = f"{R}/cf_publish_anvil_v2.py"
    run([PY, pub, "sync-catalog", "--all"], env=env)
    run([PY, pub, "upload-bundles", "--missing"], env=env)
    if not verify(gse, bundle):
        raise RuntimeError("verification failed; scratch kept")
    register()
    # safe to delete now
    for gsm in [l.split("\t")[0] for l in open(targets) if l.split("\t")[4:5] == [gse]]:
        shutil.rmtree(f"{RESULTS}/{gsm}", ignore_errors=True)
    shutil.rmtree(f"{BUNDLES}/{gse}", ignore_errors=True)
    os.makedirs(os.path.dirname(mark), exist_ok=True)
    open(mark, "w").write(time.strftime("%Y-%m-%dT%H:%M:%S") + "\n")
    log(f"{gse}: PUBLISHED, scratch cleaned")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--targets", required=True); ap.add_argument("gse", nargs="+")
    a = ap.parse_args()
    bad = 0
    for g in a.gse:
        try:
            publish(g, a.targets)
        except Exception as e:  # noqa: BLE001
            bad += 1
            log(f"{g}: PUBLISH FAILED: {e}")
            open(f"{STATE}/study/{g}.publish_error", "a").write(f"{time.strftime('%FT%T')} {e}\n")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()

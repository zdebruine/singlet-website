#!/usr/bin/env python3
"""Rolling ingest for the Research Beta channel: publish finished samples of one study to beta.singlet.bio.

Standard library only, so it runs from a Clipper compute job without an environment. Per call (idempotent, safe to re-run):

  1. verify every local object against the manifest: size, SHA-256, and the key's digest (first 16 bytes of the SHA-256);
  2. upload the objects the bucket does not already hold with that SHA-256 (PUT /api/ingest/s1-object; R2 re-checks the hash;
     objects over 80 MiB use multipart parts of 32 MiB and are read back and hashed by the server);
  3. publish the manifest (POST /api/ingest/s1-publish): the server checks that every object is in the bucket, writes s1/m/<GSE>.json to R2
     last, then applies the D1 rows. Re-posting an unchanged manifest writes nothing.

  SINGLET_INGEST_TOKEN=... beta_ingest.py --manifest GSE138867.manifest.json --root /scratch/out [--base https://beta.singlet.bio]

--root is the directory that holds the manifest's keys (<root>/s1/s/GSM.../<digest>.s1, <root>/s1/a/GSM.../<digest>.parquet).
The manifest lists the samples finished so far; call again with the longer manifest as more samples finish. A sample that is re-run gets a new
object key (its digest changes) and replaces the old one in the manifest. Private outputs (genotypes, reads) never go through this script:
the server refuses private/* keys.

D1 cost: 3 rows per sample of the new rev + 1 per sample of the rev it replaces + about 3 for the study rows (measured: 5 samples replacing 3 = 21), printed before the post
and checked against the count D1 returns. Publish once per job, or every k samples, rather than after each sample of a large study.
Exit status 0 on success, 1 on a failed check, 2 on a usage error.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

PART = 32 * 1024 * 1024
SINGLE_MAX = 80 * 1024 * 1024
LABEL_RE = re.compile(r"s1/a/GSM\d+/[0-9a-f]{32}\.parquet")
DIGEST_RE = re.compile(r"/([0-9a-f]{32})\.")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


class Client:
    def __init__(self, base, token):
        self.base = base.rstrip("/")
        self.token = token

    def call(self, method, path, query=None, body=None, headers=None, retries=4):
        url = f"{self.base}/api/ingest/{path}"
        if query:
            url += "?" + "&".join(f"{k}={v}" for k, v in query.items())
        h = {"X-Ingest-Token": self.token, "User-Agent": "singlet-beta-ingest/1"}
        h.update(headers or {})
        for attempt in range(retries + 1):
            req = urllib.request.Request(url, data=body, method=method, headers=h)
            try:
                with urllib.request.urlopen(req, timeout=300) as r:
                    return r.status, json.loads(r.read() or b"{}")
            except urllib.error.HTTPError as e:
                text = e.read()
                try:
                    data = json.loads(text)
                except ValueError:
                    data = {"error": text[:200].decode("utf-8", "replace")}
                if e.code in (500, 502, 503, 504, 520, 522, 524) and attempt < retries:
                    time.sleep(2 ** attempt)
                    continue
                return e.code, data
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                if attempt == retries:
                    raise
                time.sleep(2 ** attempt)


def upload(c, key, path, sha):
    """Upload one object unless the bucket already holds it. Returns (bytes sent, status word)."""
    size = os.path.getsize(path)
    st, d = c.call("GET", "s1-object", {"key": key})
    if st == 200 and d.get("sha256") == sha and d.get("bytes") == size:
        return 0, "present"
    hdr = {"X-Content-SHA256": sha}
    octet = {**hdr, "Content-Type": "application/octet-stream"}
    if size <= SINGLE_MAX:
        with open(path, "rb") as f:
            st, d = c.call("PUT", "s1-object", {"key": key}, f.read(), octet)
        if st != 200:
            raise RuntimeError(f"PUT {key}: {st} {d}")
        return size, "unchanged" if d.get("unchanged") else "uploaded"
    st, d = c.call("POST", "s1-object", {"key": key, "action": "mpu-create"}, b"", hdr)
    if st != 200:
        raise RuntimeError(f"mpu-create {key}: {st} {d}")
    if d.get("unchanged"):
        return 0, "present"
    uid, parts = d["upload_id"], []
    try:
        with open(path, "rb") as f:
            n = 1
            while True:
                chunk = f.read(PART)
                if not chunk:
                    break
                st, d = c.call("PUT", "s1-object", {"key": key, "action": "mpu-part", "upload": uid, "part": n}, chunk, octet)
                if st != 200:
                    raise RuntimeError(f"mpu-part {n} {key}: {st} {d}")
                parts.append({"part": d["part"], "etag": d["etag"]})
                n += 1
        st, d = c.call("POST", "s1-object", {"key": key, "action": "mpu-complete", "upload": uid}, json.dumps({"parts": parts}).encode(), {**hdr, "Content-Type": "application/json"})
        if st != 200:
            raise RuntimeError(f"mpu-complete {key}: {st} {d}")
    except Exception:
        c.call("POST", "s1-object", {"key": key, "action": "mpu-abort", "upload": uid}, b"", hdr, retries=0)
        raise
    return size, "uploaded"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--manifest", required=True, help="study manifest JSON (docs/format-s1.md section 7) listing the finished samples")
    ap.add_argument("--root", required=True, help="directory holding the manifest's object keys")
    ap.add_argument("--base", default=os.environ.get("SINGLET_BETA_BASE", "https://beta.singlet.bio"))
    ap.add_argument("--ledger", help="append one JSON line with the result here")
    ap.add_argument("--no-publish", action="store_true", help="upload objects only")
    ap.add_argument("--force", action="store_true", help="rewrite D1 rows even when this rev is stored")
    a = ap.parse_args(argv)
    token = os.environ.get("SINGLET_INGEST_TOKEN", "")
    if not token:
        print("SINGLET_INGEST_TOKEN is not set", file=sys.stderr)
        return 2
    text = open(a.manifest, encoding="utf-8").read()
    manifest = json.loads(text)
    gse, samples = manifest["gse"], manifest["samples"]
    t0 = time.time()

    todo = [(s["key"], s["bytes"], s.get("sha256")) for s in samples] + [(k, None, None) for k in sorted(set(LABEL_RE.findall(text)))]
    checked = []
    for key, size, sha in todo:  # 1. verify locally before sending a byte
        path = os.path.join(a.root, *key.split("/"))
        if key.startswith("private/") or not os.path.isfile(path):
            print(f"FAIL {key}: {'private key' if key.startswith('private/') else 'not found under --root'}", file=sys.stderr)
            return 1
        got = sha256_file(path)
        m = DIGEST_RE.search(key)
        if (size is not None and os.path.getsize(path) != size) or (sha and got != sha) or (m and not got.startswith(m.group(1))):
            print(f"FAIL {key}: local file does not match the manifest (size or sha256) or the key digest", file=sys.stderr)
            return 1
        checked.append((key, got))

    c = Client(a.base, token)
    sent = 0
    counts = {"present": 0, "unchanged": 0, "uploaded": 0}
    for key, sha in checked:  # 2. objects
        n, word = upload(c, key, os.path.join(a.root, *key.split("/")), sha)
        sent += n
        counts[word] += 1
    result = {"gse": gse, "samples": len(samples), "objects": len(checked), **counts, "bytes_sent": sent, "upload_s": round(time.time() - t0, 1)}

    if not a.no_publish:  # 3. manifest last, then D1
        st, d = c.call("GET", "s1-study", {"gse": gse})
        stored = (d.get("study") or {}) if st == 200 else {}
        old = int(stored.get("n_samples") or 0)
        est = 3 * len(samples) + (old if stored.get("rev") != manifest["rev"] else 0) + 3
        if stored.get("rev") == manifest["rev"] and not a.force:
            est = 0
        print(f"estimated D1 rows written: {est}")
        st, d = c.call("POST", "s1-publish", None, json.dumps({"manifest": manifest, "force": a.force}).encode(), {"Content-Type": "application/json"})
        if st != 200:
            print(f"FAIL publish: {st} {d}", file=sys.stderr)
            return 1
        result.update(rev=d["rev"], rev_unchanged=d["unchanged"], r2_manifest=d["r2_manifest"], d1_rows_written=d["rows_written"], d1_rows_estimated=est)
    result["total_s"] = round(time.time() - t0, 1)
    print(json.dumps(result))
    if a.ledger:
        with open(a.ledger, "a", encoding="utf-8") as f:
            f.write(json.dumps({**result, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

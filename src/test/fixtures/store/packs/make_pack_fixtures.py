# SPDX-License-Identifier: MIT
"""Generate the pack fixtures read by src/test/store-packs.test.ts.

Run with the singlet-bio Python reference (read only):

    python -P src/test/fixtures/store/packs/make_pack_fixtures.py [--singlet-python C:/path/to/singlet-bio/python]

Writes next to this script: <id>.pack for every pack, index.json (the format of store/ref/index.json) and expected.json (the
names the Python reference expands, for every index of every pack). Nothing here is random except the whitelists, which use
a fixed seed, so a rerun produces identical bytes as long as the reference packs.py/zstd do.

Packs:
  A    human-like vocabulary: 5 genes on chrX/chr1/chr2, symbol kinds 0 (empty), 1 (== gene id) and 2 (explicit), multi-exon
       genes and one single-exon gene                                    -> A.exon (SVP0), A.intron (SVPD)
  B    mouse-like: 3 single-exon genes (no introns at all, empty gap stream)   -> B.exon, B.intron (n = 0)
  C    no explicit symbols (empty symbol blob), 4-digit padded ids, two exons per gene -> C.exon, C.intron
  AB   barnyard-like composite of A and B with species tags                -> AB.exon, AB.intron
  W16  whitelist of 150 sorted 16-mers; W32 whitelist of 40 32-mers (gaps need the full 64-bit range)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument("--singlet-python", default=r"C:\Users\zacha\Projects\singlet-bio\python")
ap.add_argument("--out", default=HERE)
args = ap.parse_args()
sys.path.insert(0, args.singlet_python)

import numpy as np  # noqa: E402

from singlet.store import packs as P  # noqa: E402
from singlet.store import util  # noqa: E402


def build_vocab(build, prefix, width, genes):
    """genes: [(num, kind, symbol, chrom, [(start, end), ...])]; kind 0 empty symbol, 1 symbol == gene id, 2 explicit symbol."""
    exon, intron, tab = [], [], []
    for num, kind, sym, chrom, exs in genes:
        gid = prefix + str(num).zfill(width)
        s = "" if kind == 0 else (gid if kind == 1 else sym)
        tab.append({"gene_id": gid, "gene_name": sym if kind == 2 else gid})
        for i, (a, b) in enumerate(exs):
            exon.append("%s_%s_%s:%d-%d" % (gid, s, chrom, a, b))
            if i + 1 < len(exs):
                intron.append("%s_%s_intron_%s:%d-%d" % (gid, s, chrom, b, exs[i + 1][0]))
    vocab = {"schema_version": "1.0", "reference_build": build, "n_genes": len(tab), "genes": tab}
    S = P.build_struct(exon, intron, vocab)
    ep = P.build_exon_pack(S, {"source": "fixture"})
    ip = P.build_intron_pack(ep)
    return exon, intron, ep, ip


A = build_vocab("FIXTURE-A", "ENSG", 11, [
    (3, 2, "TSPAN6", "chrX", [(100, 200), (300, 450), (500, 520)]),
    (5, 0, "", "chr1", [(1000, 1100)]),
    (419, 2, "DPM1", "chr1", [(2000, 2100), (2500, 2800)]),
    (457, 1, "", "chrX", [(50, 80), (90, 95), (1000, 2000), (3000, 3010)]),
    (1084, 2, "GCLC", "chr2", [(7, 9), (20, 30)]),
])
B = build_vocab("FIXTURE-B", "ENSMUSG", 11, [
    (1, 2, "Gnai3", "chr3", [(5000, 5100)]),
    (28, 1, "", "chr3", [(9000, 9500)]),
    (31, 0, "", "chr7", [(12, 400)]),
])
C = build_vocab("FIXTURE-C", "FBgn", 4, [
    (7, 1, "", "2L", [(10, 20), (30, 45)]),
    (12345678, 0, "", "3R", [(1, 2), (5, 6)]),
])

TAGS = ("GRCh38___", "GRCm39___")


def composite(member, a, b, names):
    comp = [(P.pack_id(a), TAGS[0]), (P.pack_id(b), TAGS[1])]
    return P.build_composite("FIXTURE-A-B-barnyard", member, comp, len(names), hashlib.sha256(util.join_nul(names)).hexdigest())


os.makedirs(args.out, exist_ok=True)
for f in os.listdir(args.out):
    if f.endswith(".pack"):
        os.remove(os.path.join(args.out, f))

blobs = {"A.exon": A[2], "A.intron": A[3], "B.exon": B[2], "B.intron": B[3], "C.exon": C[2], "C.intron": C[3]}
# composite names come from a store that holds the components
tmp = os.path.join(args.out, "_tmp_store")
os.makedirs(tmp, exist_ok=True)
for b in (A[2], A[3], B[2], B[3]):
    open(os.path.join(tmp, P.pack_id(b).hex() + ".pack"), "wb").write(b)
store0 = P.PackStore(dirs=[tmp], download=False)
ex_names = store0.get(P.pack_id(A[2]).hex())._expand(TAGS[0], "exon") + store0.get(P.pack_id(B[2]).hex())._expand(TAGS[1], "exon")
in_names = store0.get(P.pack_id(A[3]).hex())._expand(TAGS[0], "intron") + store0.get(P.pack_id(B[3]).hex())._expand(TAGS[1], "intron")
blobs["AB.exon"] = composite("exon", A[2], B[2], ex_names)
blobs["AB.intron"] = composite("intron", A[3], B[3], in_names)

# whitelists (fixed seed)
rs = np.random.RandomState(7)
alpha = np.frombuffer(b"ACGT", dtype=np.uint8)


def rand_barcodes(n, k):
    return [alpha[rs.randint(0, 4, size=k)].tobytes().decode("ascii") for _ in range(n)]


w16_in = rand_barcodes(150, 16)
w32_in = rand_barcodes(40, 32)
blobs["W16"] = P.build_whitelist(w16_in, {"protocol": "fixture-16", "names": ["fixture-16"]})
blobs["W32"] = P.build_whitelist(w32_in, {"protocol": "fixture-32", "names": ["fixture-32"]})

entries = []
meta = {
    "A.exon": ("vocab", dict(build="FIXTURE-A", member="exon", n=len(A[0]))),
    "A.intron": ("vocab", dict(build="FIXTURE-A", member="intron", n=len(A[1]))),
    "B.exon": ("vocab", dict(build="FIXTURE-B", member="exon", n=len(B[0]))),
    "B.intron": ("vocab", dict(build="FIXTURE-B", member="intron", n=len(B[1]))),
    "C.exon": ("vocab", dict(build="FIXTURE-C", member="exon", n=len(C[0]))),
    "C.intron": ("vocab", dict(build="FIXTURE-C", member="intron", n=len(C[1]))),
    "AB.exon": ("vocab", dict(build="FIXTURE-A-B-barnyard", member="exon", n=len(ex_names))),
    "AB.intron": ("vocab", dict(build="FIXTURE-A-B-barnyard", member="intron", n=len(in_names))),
    "W16": ("whitelist", dict(protocol="fixture-16", names=["fixture-16"], k=16, n=len(set(w16_in)))),
    "W32": ("whitelist", dict(protocol="fixture-32", names=["fixture-32"], k=32, n=len(set(w32_in)))),
}
for name, buf in blobs.items():
    with open(os.path.join(args.out, P.pack_id(buf).hex() + ".pack"), "wb") as fh:
        fh.write(buf)

store = P.PackStore(dirs=[args.out, ], download=False)
expected = {}
for name, buf in blobs.items():
    kind_name, extra = meta[name]
    entries.append(P.index_entry(buf, kind_name, extra))
    pid = P.pack_id(buf).hex()
    obj = store.get(pid)
    if name.startswith("W"):
        names = obj.all_barcodes()
        expected[name] = {"id": pid, "kind": "whitelist", "k": obj.k, "n": obj.n, "names": names}
    else:
        names = obj.names()
        # the lazy lookup must agree with the full expansion
        assert obj.names_at(list(range(len(names)))) == names, name
        expected[name] = {"id": pid, "kind": "composite" if name.startswith("AB") else "vocab", "build": extra["build"],
                          "member": extra["member"], "n": len(names), "names": names}
expected["AB.exon"]["names"] == ex_names or sys.exit("composite expansion differs from the component expansions")
expected["AB.intron"]["names"] == in_names or sys.exit("composite expansion differs from the component expansions")
# derivation links used by the tests: the SVPD intron packs point at their exon packs
expected["_derived_from"] = {"A.intron": expected["A.exon"]["id"], "B.intron": expected["B.exon"]["id"], "C.intron": expected["C.exon"]["id"]}
expected["_tags"] = list(TAGS)

entries.sort(key=lambda e: (e["kind"], e.get("build", ""), e.get("member", ""), e.get("protocol", "")))
P.write_index(entries, os.path.join(args.out, "index.json"))
with open(os.path.join(args.out, "expected.json"), "w", encoding="utf-8", newline="\n") as fh:
    json.dump(expected, fh, indent=1, sort_keys=True, ensure_ascii=False)
    fh.write("\n")

import shutil  # noqa: E402

shutil.rmtree(tmp, ignore_errors=True)
total = sum(os.path.getsize(os.path.join(args.out, f)) for f in os.listdir(args.out))
print("wrote %d packs, index.json, expected.json; %d bytes in total" % (len(blobs), total))
for name in blobs:
    print("  %-10s %s %6d B" % (name, expected[name]["id"], len(blobs[name])))

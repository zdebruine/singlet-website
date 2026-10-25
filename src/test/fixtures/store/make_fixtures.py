# SPDX-License-Identifier: CC0-1.0
"""Generates the binary fixtures under src/test/fixtures/store/cells and src/test/fixtures/store/sample.

The fixtures are written by the Python reference implementation of the per-sample format (singlet-bio repository, python/singlet/store),
so the TypeScript readers in functions/_shared are tested against the writer that really produces the objects, not against
a second implementation of the spec.

    python -P src/test/fixtures/store/make_fixtures.py [path-to-singlet-bio/python]

The default path is the author's checkout (C:\\Users\\zacha\\Projects\\singlet-bio\\python). Needs numpy and zstandard. The output
is deterministic (fixed seeds, no timestamps); rerunning it must leave git clean. Nothing here runs in CI.

Writes
  cells/*.cel                  cells tables (docs/format-store.md 5.3), one per scenario, plus cells/<table>.expected.json with the logical
                               column values, dtype and enc of every column
  sample/GSM1000001.s2         a complete sample object (300 cells, 5 chunks of 64 columns, exon + intron codec-2 matrices,
                               cells table, summary.json and cell_calls.tsv stored, one derived member)
  sample/GSM1000001.manifest.json   the sample dict manifest.sample_entry() puts in the study manifest
  sample/GSM1000001.expected.json   file header, member table, pz2 headers, chunk index records, cells columns
"""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SINGLET_PY = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\zacha\Projects\singlet-bio\python"
sys.path.insert(0, SINGLET_PY)

import numpy as np  # noqa: E402

from singlet.store import cells as CL  # noqa: E402
from singlet.store import codec as CD  # noqa: E402
from singlet.store import container as C  # noqa: E402
from singlet.store import manifest as M  # noqa: E402
from singlet.store import migrate  # noqa: E402
from singlet.store import packs as P  # noqa: E402
from singlet.store import util  # noqa: E402
from singlet.store.matrix import Csc  # noqa: E402

CELLS_DIR = HERE / "cells"
SAMPLE_DIR = HERE / "sample"
CELLS_DIR.mkdir(exist_ok=True)
SAMPLE_DIR.mkdir(exist_ok=True)

ACGT = np.frombuffer(b"ACGT", dtype=np.uint8)


def barcodes16(rng, n, k=16):
    seen, out = set(), []
    while len(out) < n:
        b = ACGT[rng.integers(0, 4, k)].tobytes().decode()
        if b not in seen:
            seen.add(b)
            out.append(b)
    return out


# ---------------------------------------------------------------------------------------------------- cells tables
_FIXED = struct.Struct("<BBQQ")


def directory(buf: bytes):
    magic = buf[:4]
    assert magic == b"CEL2"
    ver, ncols, nrows = struct.unpack_from("<HHI", buf, 4)
    p = 12
    cols = []
    for _ in range(ncols):
        (nl,) = struct.unpack_from("<H", buf, p)
        p += 2
        name = buf[p:p + nl].decode()
        p += nl
        dt, enc, off, ln = _FIXED.unpack_from(buf, p)
        p += _FIXED.size
        cols.append({"name": name, "dtype": dt, "enc": enc, "off": off, "len": ln})
    return nrows, cols


def logical(table: CL.CellsTable, name: str):
    c = table._cols[name]
    v = c.values
    if c.dtype == CL.DT_BARCODE:
        return None  # barcodes are never decoded by the TypeScript reader; only the directory entry is checked
    if c.dtype == CL.DT_STR:
        return list(v)
    if c.dtype == CL.DT_BOOL:
        return np.asarray(v).astype(int).tolist()
    if c.dtype == CL.DT_F32:
        return np.asarray(v).astype(np.float64).tolist()
    return np.asarray(v).tolist()


EXPECTED_CELLS: dict = {}


def write_table(fname: str, t: CL.CellsTable, note: str, compact_prefix: str = "") -> bytes:
    body = t.encode(19)
    (CELLS_DIR / fname).write_bytes(body)
    n_rows, dirs = directory(body)
    assert n_rows == t.n_rows
    cols = []
    for d in dirs:
        d = dict(d)
        vals = logical(t, d["name"])
        if vals is None:
            d["values"] = None
        elif compact_prefix and d["name"].startswith(compact_prefix):
            d["sum"] = int(sum(vals))
            d["head"] = vals[:8]
        else:
            d["values"] = vals
        cols.append(d)
    EXPECTED_CELLS[fname] = {"note": note, "n_rows": n_rows, "bytes": len(body), "columns": cols}
    print("%-22s %6d B  %5d rows  %s" % (fname, len(body), n_rows, ", ".join("%s:%d/%d" % (c["name"], c["dtype"], c["enc"]) for c in cols)[:150]))
    return body


def numeric_all():
    n = 400
    rng = np.random.default_rng(7)
    ar = np.arange(n, dtype=np.uint64)
    t = CL.CellsTable(n)
    t.add("barcode", CL.DT_BARCODE, barcodes16(rng, n))  # 2-bit codes (mode 2)
    t.add("u8_wrap", CL.DT_U8, ((ar * 37) % 256).astype(np.uint8))
    t.add("u16_wrap", CL.DT_U16, ((ar * 251) % 65536).astype(np.uint16))
    t.add("u32_wrap", CL.DT_U32, ((ar * 2654435761) % (2 ** 32)).astype(np.uint32))
    t.add("i32_wrap", CL.DT_I32, ((ar * 2147483633) % (2 ** 32)).astype(np.uint32).view(np.int32))
    t.add("u32_rand", CL.DT_U32, rng.integers(0, 2 ** 32, n, dtype=np.uint64).astype(np.uint32))
    t.add("u16_skew", CL.DT_U16, np.minimum(rng.geometric(0.05, n), 65535).astype(np.uint16))
    t.add("u8_small", CL.DT_U8, rng.integers(0, 4, n).astype(np.uint8))
    t.add("i32_signed", CL.DT_I32, (rng.normal(0, 1000, n)).astype(np.int32))
    t.add("f32_score", CL.DT_F32, (np.round(rng.random(n) * 256) / 256).astype(np.float32))
    t.add("f64_ramp", CL.DT_F64, ar.astype(np.float64) * 0.5)
    t.add("f32_zero", CL.DT_F32, np.zeros(n, np.float32))
    sparse = np.zeros(n, bool)
    sparse[rng.choice(n, 8, replace=False)] = True
    t.add("bool_sparse", CL.DT_BOOL, sparse)
    t.add("bool_rand", CL.DT_BOOL, rng.random(n) < 0.5)
    t.add("cluster", CL.DT_STR, ["c%d" % x for x in rng.integers(0, 10, n)])
    return t


def barcode_mode0():
    n = 300
    rng = np.random.default_rng(11)
    codes = [ACGT[rng.integers(0, 4, int(rng.integers(8, 20)))].tobytes().decode() + "-1" for _ in range(n)]  # mixed lengths
    t = CL.CellsTable(n)
    t.add("barcode", CL.DT_BARCODE, codes)
    t.add("called", CL.DT_BOOL, rng.random(n) < 0.4)
    t.add("n_umi_exon", CL.DT_U32, rng.integers(0, 20000, n).astype(np.uint32))
    return t


def barcode_mode1():
    n = 300
    rng = np.random.default_rng(13)
    wl_list = barcodes16(rng, 1000)
    buf = P.build_whitelist(wl_list, {"protocol": "fixture-whitelist", "names": ["fixture-whitelist"]})
    w = P.Whitelist(buf)
    pick = [wl_list[i] for i in rng.choice(1000, n, replace=False)]
    idx = w.index_of(pick)
    assert idx is not None
    t = CL.CellsTable(n)
    t.add("barcode", CL.DT_BARCODE, pick, whitelist=(w, idx))
    t.add("called", CL.DT_BOOL, rng.random(n) < 0.4)
    t.add("n_umi_exon", CL.DT_U32, rng.integers(0, 20000, n).astype(np.uint32))
    return t, w.id.hex()


def empty_table():
    t = CL.CellsTable(0)
    t.add("barcode", CL.DT_BARCODE, [])
    t.add("called", CL.DT_BOOL, np.zeros(0, bool))
    for nm in ("n_umi_exon", "n_umi_intron", "n_feat_exon", "n_feat_intron"):
        t.add(nm, CL.DT_U32, np.zeros(0, np.uint32))
    return t


def reordered():
    """1000 cells, required columns in a non-canonical order plus optional columns; called cells come in runs."""
    n = 1000
    rng = np.random.default_rng(17)
    called = np.zeros(n, bool)
    for a, b in ((0, 120), (200, 230), (231, 260), (400, 401), (640, 700), (990, 1000)):
        called[a:b] = True
    umi_e = np.where(called, rng.lognormal(8.0, 0.6, n), rng.lognormal(3.0, 0.5, n)).astype(np.uint32)
    umi_i = np.where(called, rng.lognormal(7.0, 0.7, n), rng.lognormal(2.0, 0.5, n)).astype(np.uint32)
    feat_e = np.minimum(umi_e, np.where(called, rng.integers(500, 4000, n), rng.integers(1, 40, n))).astype(np.uint32)
    feat_i = np.minimum(umi_i, np.where(called, rng.integers(300, 3000, n), rng.integers(1, 30, n))).astype(np.uint32)
    t = CL.CellsTable(n)
    t.add("n_feat_intron", CL.DT_U32, feat_i)
    t.add("n_umi_exon", CL.DT_U32, umi_e)
    t.add("doublet_score", CL.DT_F32, (np.round(rng.random(n) * 256) / 256).astype(np.float32))
    t.add("cell_cycle", CL.DT_STR, [("G1", "S", "G2M")[x] for x in rng.integers(0, 3, n)])
    t.add("n_feat_exon", CL.DT_U32, feat_e)
    t.add("barcode", CL.DT_BARCODE, barcodes16(rng, n))
    t.add("n_umi_intron", CL.DT_U32, umi_i)
    t.add("called", CL.DT_BOOL, called)
    return t


def many_columns():
    """A directory longer than the default 4096-byte prefetch."""
    n = 300
    rng = np.random.default_rng(19)
    t = CL.CellsTable(n)
    t.add("barcode", CL.DT_BARCODE, barcodes16(rng, n))
    t.add("called", CL.DT_BOOL, rng.random(n) < 0.5)
    for i in range(100):
        t.add("extra_%03d_%s" % (i, "x" * 50), CL.DT_U8, rng.integers(0, 5, n).astype(np.uint8))
    t.add("n_umi_exon", CL.DT_U32, rng.integers(0, 20000, n).astype(np.uint32))
    return t


def make_cells():
    write_table("numeric_all.cel", numeric_all(), "every numeric dtype; raw, zstd and delta+zstd (wrapping) columns; bool and string columns; barcode mode 2")
    write_table("barcode_mode0.cel", barcode_mode0(), "barcode column in mode 0 (zstd strings, mixed lengths)")
    t1, wid = barcode_mode1()
    write_table("barcode_mode1.cel", t1, "barcode column in mode 1 (whitelist indices); pack id %s" % wid)
    EXPECTED_CELLS["barcode_mode1.cel"]["whitelist_pack"] = wid
    write_table("empty.cel", empty_table(), "no rows")
    write_table("reordered.cel", reordered(), "required columns in another order, optional columns, called cells in runs")
    write_table("many_columns.cel", many_columns(), "directory longer than 4096 bytes; extra_* columns carry sum and head only", compact_prefix="extra_")
    seen = {(c["dtype"], c["enc"]) for e in EXPECTED_CELLS.values() for c in e["columns"]}
    encs = {e for _d, e in seen}
    assert encs >= {0, 1, 2}, seen
    for dt in (1, 2, 3, 4):
        assert (dt, 2) in seen, ("no delta column for dtype", dt)
    assert {d for d, _e in seen} >= set(range(1, 10)), seen
    print("dtype/enc pairs:", sorted(seen))
    # one expected file per table (<table>.expected.json), values compact
    for k, v in EXPECTED_CELLS.items():
        (CELLS_DIR / (k[:-4] + ".expected.json")).write_text(json.dumps(v, separators=(",", ":")) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------------------------------- sample object
def make_matrix(rng, m, n, called, dens_called, dens_other, vt, rows, barcodes):
    cols = []
    for j in range(n):
        p = dens_called if called[j] else dens_other
        k = int(rng.binomial(m, p))
        ids = np.sort(rng.choice(m, size=k, replace=False)).astype(np.uint32) if k else np.zeros(0, np.uint32)
        cols.append(ids)
    indptr = np.concatenate([[0], np.cumsum([len(c) for c in cols])]).astype(np.int64)
    indices = np.concatenate(cols).astype(np.uint32)
    hi = {1: 255, 2: 65535, 3: 2 ** 32 - 1}[vt]
    data = np.minimum(rng.geometric(0.35, size=len(indices)), hi).astype(np.uint32)
    return Csc(m, n, indptr, indices, data, rows, list(barcodes), {"build": "FIXTURE-1"}, vt)


def hdr_json(h: dict) -> dict:
    out = {}
    for k, v in h.items():
        if isinstance(v, (bytes, bytearray)):
            out[k] = bytes(v).hex()
        elif isinstance(v, dict):
            out[k] = {kk: list(vv) for kk, vv in v.items()}
        else:
            out[k] = int(v) if isinstance(v, (np.integer,)) else v
    return out


def make_sample():
    gsm = "GSM1000001"
    rng = np.random.default_rng(1000001)
    n = 300
    barcodes = barcodes16(rng, n)
    called = np.zeros(n, bool)
    called[:80] = True
    called[rng.choice(np.arange(80, n), 40, replace=False)] = True
    exon_rows = ["ENSG%011d_SYM%d_chr1:%d-%d" % (i + 1, i + 1, 1000 * (i + 1), 1000 * (i + 1) + 120) for i in range(400)]
    intron_rows = ["ENSG%011d_SYM%d_intron_chr1:%d-%d" % (i + 1, i + 1, 1000 * (i + 1) + 120, 1000 * (i + 1) + 900) for i in range(300)]
    exon = make_matrix(rng, 400, n, called, 0.18, 0.01, CD.VT_U16, exon_rows, barcodes)
    intron = make_matrix(rng, 300, n, called, 0.10, 0.006, CD.VT_U8, intron_rows, barcodes)
    assert exon.check_canonical() is None and intron.check_canonical() is None

    base = CL.base_table(barcodes, exon, intron, called)
    base.meta = {"called_source": "cell_calls.tsv", "whitelist": None}
    stats = base.stats()
    w = C.S2Writer(gsm)
    w.add_cells("cells", base.encode(19), base.digest(),
                {"n_rows": base.n_rows, "columns": base.names, "called_source": "cell_calls.tsv", "whitelist": None}, flags=C.FLAG_ANNDATA)
    codec = CD.PyCodec2()
    for rel, csc in (("exon_counts.1pz", exon), ("intron_counts.1pz", intron)):
        body = codec.encode(csc, CD.EncodeOptions(chunk_cols=64, row_names="inline", col_names="cells", level=19))
        w.add_matrix(rel, body, csc.digest(),
                     {"m": csc.m, "n": csc.n, "nnz": csc.nnz, "legacy_vt_code": csc.value_type, "chunk_cols": 64,
                      "names": {"rows": "inline", "cols": "cells"}, "legacy_size": len(body) + 100, "legacy_crc32": 0},
                     C.FLAG_LEGACY | C.FLAG_ANNDATA)
    summary = json.dumps({"schema_version": "1.1", "sample_id": gsm, "status": "success", "reference_build": "FIXTURE-1",
                          "n_cells_called": int(called.sum()), "median_umi_per_cell": stats["median_umi"],
                          "median_genes_per_cell": stats["median_genes"], "protocol_name": "10x 3' v3"}, indent=2).encode()
    w.add_stored("summary.json", summary, {}, C.FLAG_LEGACY, 19)
    tsv = ("barcode\tis_cell\n" + "".join("%s\t%s\n" % (b, "True" if c else "False") for b, c in zip(barcodes, called))).encode()
    w.add_stored("cell_calls.tsv", tsv, {}, C.FLAG_LEGACY, 19)
    qc = ("barcode\tn_umi\n" + "".join("%s\t%d\n" % (b, int(u)) for b, u in zip(barcodes, base.column("n_umi_exon")))).encode()
    w.add_derived("cell_qc_metrics.tsv", len(qc), util.crc32(qc), util.d16(qc), {"recipe": "cellqc-v1", "params": {}, "needs": ["cells"]}, C.FLAG_LEGACY)
    obj = w.build()
    key = "store/s/%s/%s.s1" % (gsm, util.d16(obj).hex())
    members = {info.name: migrate._manifest_member(info, obj) for info in w.infos}
    entry = M.sample_entry(gsm, key, obj, base.n_rows, int(called.sum()), members, stats)
    (SAMPLE_DIR / (gsm + ".s1")).write_bytes(obj)
    (SAMPLE_DIR / (gsm + ".manifest.json")).write_text(json.dumps(entry, indent=1, sort_keys=False) + "\n", encoding="utf-8")

    # what the readers must find
    rd = C.S2Reader(obj)
    exp = {
        "key": key,
        "object_len": len(obj),
        "file_header": {"version": rd.version, "flags": rd.flags, "n_members": rd.n_members, "table_off": rd.table_off,
                        "table_len": rd.table_len, "file_len": rd.file_len, "sample_id": rd.sample_id},
        "member_table": [{"name": mi.name, "kind": mi.kind, "flags": mi.flags, "off": mi.off, "len": mi.len, "out_len": mi.out_len,
                          "crc32": mi.crc32, "digest": mi.digest.hex(), "meta": mi.meta} for mi in rd.members.values()],
        "stats": stats,
        "matrices": {},
    }
    for rel in ("exon_counts.1pz", "intron_counts.1pz"):
        mi = rd.members[rel]
        mem = obj[mi.off:mi.off + mi.len]
        h = CD.parse_header(mem[:CD.HEADER_SIZE])
        ioff, ilen = h["sections"]["chunk_index"]
        recs = []
        for i in range(h["n_chunks"] + 1):
            off, ln, first, nb = struct.unpack_from("<QIIQ", mem, ioff + 24 * i)
            recs.append({"off": off, "len": ln, "first_col": first, "nnz_before": nb})
        exp["matrices"][rel] = {"member_off": mi.off, "member_len": mi.len, "header": hdr_json(h), "chunk_index": recs}
    cm = rd.members["cells"]
    cbody = obj[cm.off:cm.off + cm.len]
    n_rows, dirs = directory(cbody)
    cols = []
    for d in dirs:
        d = dict(d)
        d["values"] = logical(base, d["name"])
        cols.append(d)
    exp["cells"] = {"member_off": cm.off, "member_len": cm.len, "n_rows": n_rows, "columns": cols}
    (SAMPLE_DIR / (gsm + ".expected.json")).write_text(json.dumps(exp, separators=(",", ":")) + "\n", encoding="utf-8")
    print("sample", gsm, len(obj), "B; members:", list(rd.members), "; n_called", int(called.sum()))


if __name__ == "__main__":
    make_cells()
    make_sample()

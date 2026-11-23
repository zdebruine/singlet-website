/**
 * Byte-for-byte check of src/pz2.ts against the compiled reference decoder (singlet._pz2): decodes every member listed in a truth.json
 * written by pz2_truth.py, chunk by chunk, and compares the SHA-256 of indptr (i64), indices (u32) and data (u32) in canonical mode.
 *
 *   python pz2_truth.py <dir> GSE138867:2 GSE202371:1      (needs `pip install singlet`)
 *   node workers/data/scripts/pz2-check.ts <dir>
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Member } from "../src/pz2.ts";

interface Truth {
  gsm: string;
  key: string;
  member: string;
  off: number;
  len: number;
  m: number;
  n: number;
  nnz: number;
  sha_indptr: string;
  sha_indices: string;
  sha_data: string;
}

const dir = process.argv[2];
const truth = JSON.parse(readFileSync(join(dir, "truth.json"), "utf8")) as Truth[];
let bad = 0;
for (const t of truth) {
  const obj = readFileSync(join(dir, t.key.replace(/\//g, "_")));
  const b = new Uint8Array(obj.buffer, obj.byteOffset + t.off, t.len);
  const t0 = performance.now();
  const mem = new Member(b);
  const indptr = new BigInt64Array(mem.h.n + 1);
  const idx = new Uint32Array(mem.h.nnz);
  const val = new Uint32Array(mem.h.nnz);
  for (let c = 0; c < mem.h.nChunks; c++) {
    const [o, l] = mem.chunkRange(c);
    const ch = mem.decodeChunk(c, b.subarray(o, o + l));
    const base = mem.ix.nnzBefore[c];
    idx.set(ch.idx, base);
    val.set(ch.val, base);
    for (let j = 0; j < ch.counts.length; j++) indptr[ch.first + j + 1] = BigInt(base + ch.colptr[j + 1]);
  }
  const ms = performance.now() - t0;
  const sha = (a: ArrayBufferView) => createHash("sha256").update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest("hex");
  const ok = sha(indptr) === t.sha_indptr && sha(idx) === t.sha_indices && sha(val) === t.sha_data;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${t.gsm} ${t.member} m=${t.m} n=${t.n} nnz=${t.nnz} codec=${mem.h.codec} ${ms.toFixed(0)} ms (${((t.nnz / ms) * 1e-3).toFixed(1)} M nnz/s)`);
}
console.log(bad ? `${bad} of ${truth.length} members differ` : `all ${truth.length} members identical`);
process.exit(bad ? 1 : 0);

/**
 * Per-sample `summary.json` of a study served from store, read from the sample objects instead of the legacy bundle.
 *
 * A legacy study keeps its summaries in `samples/<GSM>/summary.json` inside the `.singlet` file, and the QC rows in D1 (`sample_qc`) are
 * filled from there. Once the legacy file is retired (or for a study that never had one) the same JSON is the `summary.json` member of
 * each `store/s/<GSM>/<digest>.s1` object: kind 3 (stored, zstd) at an absolute offset the catalog holds (`store_sample.members_json`).
 *
 * Reads are plain Range GETs of the public data host, six at a time, like the legacy summaries. A summary that cannot be read is left out
 * (the caller decides what a short list means); objects are immutable, so there is no stale-offset case to retry.
 */
import { decompress } from "fzstd";
import { fetchObjectRange } from "./store-serve";
import { storeUrl } from "./store-urls";

/** A summary.json larger than this after decompression is not read (they are a few KB). */
export const MAX_SUMMARY_BYTES = 4 * 1024 * 1024;
const CONCURRENCY = 6;

export interface StoreSummaryTarget {
  gsm_id: string;
  key: string;
  off: number;
  len: number;
  kind: number;
  out_len: number | null;
}

/** The samples of a study under one rev that have a summary.json member, in gsm order. */
export async function storeSummaryTargets(db: D1Database, gse: string, rev: string): Promise<StoreSummaryTarget[]> {
  const rs = await db
    .prepare(
      `SELECT gsm_id, key,
              json_extract(members_json, '$."summary.json".off') AS off,
              json_extract(members_json, '$."summary.json".len') AS len,
              json_extract(members_json, '$."summary.json".kind') AS kind,
              json_extract(members_json, '$."summary.json".out_len') AS out_len
         FROM store_sample
        WHERE gse_id = ? AND rev = ? AND json_extract(members_json, '$."summary.json".len') IS NOT NULL
        ORDER BY gsm_id`
    )
    .bind(gse, rev)
    .all<{ gsm_id: string; key: string; off: number | null; len: number | null; kind: number | null; out_len: number | null }>();
  const out: StoreSummaryTarget[] = [];
  for (const r of rs.results ?? []) {
    const off = Number(r.off);
    const len = Number(r.len);
    if (!Number.isFinite(off) || !Number.isFinite(len) || len <= 0) continue;
    out.push({ gsm_id: r.gsm_id, key: r.key, off, len, kind: Number(r.kind), out_len: r.out_len != null ? Number(r.out_len) : null });
  }
  return out;
}

async function readOne(t: StoreSummaryTarget): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fetchObjectRange(storeUrl(t.key), t.off, t.len);
    let bytes: Uint8Array;
    if (t.kind === 3) {
      if (t.out_len != null && t.out_len > MAX_SUMMARY_BYTES) return null;
      bytes = decompress(raw);
    } else if (t.kind === 5) {
      bytes = raw;
    } else {
      return null;
    }
    if (bytes.length > MAX_SUMMARY_BYTES) return null;
    const v = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The parsed summary.json of each sample that has a readable one (bounded concurrency), in gsm order. Shape them with `shapeSummary`. */
export async function readStoreSummaries(db: D1Database, gse: string, rev: string): Promise<{ gsm_id: string; summary: Record<string, unknown> }[]> {
  const targets = await storeSummaryTargets(db, gse, rev);
  const out: { gsm_id: string; summary: Record<string, unknown> }[] = [];
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const part = await Promise.all(targets.slice(i, i + CONCURRENCY).map(async (t) => ({ gsm_id: t.gsm_id, summary: await readOne(t) })));
    for (const p of part) if (p.summary) out.push({ gsm_id: p.gsm_id, summary: p.summary });
  }
  return out;
}

/**
 * Compressed exon + intron matrix bytes per sample under one rev, from the catalog alone (no network): the `len` of the two top-level
 * count matrices. The legacy equivalent is `matrixBytesByGsm` over the zip's central directory.
 */
export async function storeMatrixBytes(db: D1Database, gse: string, rev: string): Promise<Map<string, number>> {
  const rs = await db
    .prepare(
      `SELECT gsm_id,
              COALESCE(json_extract(members_json, '$."exon_counts.1pz".len'), 0) + COALESCE(json_extract(members_json, '$."intron_counts.1pz".len'), 0) AS b
         FROM store_sample WHERE gse_id = ? AND rev = ?`
    )
    .bind(gse, rev)
    .all<{ gsm_id: string; b: number | null }>();
  return new Map((rs.results ?? []).map((r) => [r.gsm_id, Number(r.b ?? 0)] as [string, number]));
}

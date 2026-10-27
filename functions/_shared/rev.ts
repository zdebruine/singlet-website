/**
 * `rev`: a short token that changes when an answer about a study could have changed, so a client can send it back as
 * `known_rev` and get `{unchanged: true}` instead of the whole answer again (w4_cf section 6, step 5).
 *
 *   file revision   what the study's data is: the s1 manifest `rev` (a content digest, stable across re-migrations that produce
 *                   the same objects), or for a study still served from the legacy bundle a digest of its ETag (size when the
 *                   index row predates schema/031).
 *   combined        the file revision plus whatever else the answer reads (catalog timestamps, QC update time).
 *
 * Every rev is 16 lowercase hex characters. They are opaque: compare for equality only.
 */
import { getS1Study } from "./s1-catalog";

export async function sha16(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d).subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Digest of several parts; null and undefined count as "absent", so an absent part and an empty one differ from a present one. */
export async function combineRev(parts: (string | number | null | undefined)[]): Promise<string> {
  return sha16(parts.map((p) => (p == null ? "\u0000" : String(p))).join("\u001f"));
}

/** Revision of a legacy bundle from what bundle_index knows: its ETag, or its size for a row indexed before schema/031. */
export async function legacyRev(etag: string | null | undefined, bytes: number | null | undefined): Promise<string> {
  return sha16(`legacy|${etag ?? `bytes:${bytes ?? 0}`}`);
}

/**
 * The file revision of a study, from light reads: the s1_study row, else the legacy bundle_index row WITHOUT its entries.
 * Null when neither exists (no file yet).
 */
export async function fileRev(db: D1Database, gse: string, s1Rev?: string | null): Promise<{ rev: string; source: "s1" | "legacy" } | null> {
  // s1Rev: the study's s1 rev when the caller already looked (null = it did and there is none); undefined = look here.
  const s1 = s1Rev === undefined ? ((await getS1Study(db, gse))?.rev ?? null) : s1Rev;
  if (s1) return { rev: s1, source: "s1" };
  const row =
    (await db
      .prepare(`SELECT bytes, etag FROM bundle_index WHERE gse_id = ?`)
      .bind(gse)
      .first<{ bytes: number | null; etag: string | null }>()
      .catch(() => null)) ??
    // before schema/031 there is no etag column
    (await db
      .prepare(`SELECT bytes FROM bundle_index WHERE gse_id = ?`)
      .bind(gse)
      .first<{ bytes: number | null }>()
      .then((r) => (r ? { bytes: r.bytes, etag: null } : null))
      .catch(() => null));
  if (!row) return null;
  return { rev: await legacyRev(row.etag, row.bytes), source: "legacy" };
}

/** The reply to a `known_rev` that is still current. */
export function unchangedBody(gse: string, rev: string, extra: Record<string, unknown> = {}) {
  return { gse_id: gse, rev, unchanged: true, ...extra };
}

/** `known_rev` as the caller sent it: 16 hex or nothing. */
export function knownRev(args: Record<string, unknown>): string | null {
  const v = typeof args.known_rev === "string" ? args.known_rev.trim().toLowerCase() : "";
  return /^[0-9a-f]{16}$/.test(v) ? v : null;
}

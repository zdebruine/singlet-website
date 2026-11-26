/**
 * Applies a parsed study post to D1: the one code path behind POST /api/ingest/s1-study and POST /api/ingest/s1-publish.
 * The order of writes and the cost accounting are described in api/ingest/s1-study.ts.
 */
import { type ParsedIngest, ingestStatements } from "./s1-catalog";

const SERVED = new Set(["verified", "retired"]);
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/** What D1 says this post cost: the sum of meta.rows_written (table and index rows) over every statement, or null when the binding does not report it. */
export function rowsWritten(results: unknown[]): number | null {
  let total = 0;
  for (const r of results) {
    const n = (r as { meta?: { rows_written?: unknown } } | null)?.meta?.rows_written;
    if (typeof n !== "number") return null;
    total += n;
  }
  return results.length ? total : 0;
}

export async function applyIngest(db: D1Database, parsed: ParsedIngest, started: number) {
  const stamp = nowIso();
  // The rev already stored decides what is rewritten: an unchanged rev costs no sample or study rows (see ingestStatements).
  const stored = parsed.study ? await db.prepare(`SELECT rev FROM s1_study WHERE gse_id = ?`).bind(parsed.gse).first<{ rev: string }>() : null;
  const { batches, tail, unchanged } = ingestStatements(db, parsed, stamp, stored?.rev ?? null);
  const results: unknown[] = [];
  for (const batch of batches) results.push(...(await db.batch(batch)));
  // The tail is one atomic batch: the s1_study row (the flip), the removal of the other revs' sample rows, the migration row.
  if (tail.length) results.push(...(await db.batch(tail)));
  // A study that is now served from s1 but has no legacy file (gse_meta.has_bundle = 0) is queued for the catalog crank, which recomputes
  // has_bundle from the s1 tables. Best effort and no write at all for a study with a legacy file (the WHERE matches nothing).
  if (parsed.final && parsed.migration && SERVED.has(parsed.migration.status)) {
    await db
      .prepare(`UPDATE gse_meta SET n_usable_samples = NULL WHERE gse_id = ? AND COALESCE(has_bundle, 0) = 0`)
      .bind(parsed.gse)
      .run()
      .catch(() => undefined);
  }
  return {
    ok: true,
    gse_id: parsed.gse,
    rev: parsed.study?.rev ?? null,
    unchanged,
    samples_written: unchanged ? 0 : (parsed.study?.samples.length ?? 0),
    rows_written: rowsWritten(results),
    n_samples: parsed.study?.n_samples ?? null,
    final: parsed.final,
    migration_status: parsed.migration && parsed.final && !(parsed.migrationImplicit && unchanged) ? parsed.migration.status : null,
    ms: Date.now() - started,
  };
}

/**
 * Single-flight lock for the catalog cranks, kept in one `meta_cache` row.
 *
 * Acquiring is one atomic upsert whose WHERE clause only lets the write
 * through when the stored deadline has passed, so two concurrent callers can
 * never both win (a read followed by a write could). The row holds
 * `<deadline-ms>:<owner>`; SQLite's CAST(... AS INTEGER) reads the deadline
 * from that prefix, and only the owner may shorten it on release.
 */
export interface CrankLock {
  key: string;
  owner: string;
}

export type LockResult = { ok: true; lock: CrankLock } | { ok: false; retryAfterMs: number };

function ownerToken(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Takes the lock for `holdMs` unless another run holds or is cooling down on it. */
export async function acquireCrankLock(
  db: D1Database,
  key: string,
  holdMs: number,
  now: number = Date.now()
): Promise<LockResult> {
  const owner = ownerToken();
  const res = await db
    .prepare(
      `INSERT INTO meta_cache (key, value, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
       WHERE CAST(meta_cache.value AS INTEGER) <= ?4`
    )
    .bind(key, `${now + holdMs}:${owner}`, new Date(now).toISOString(), now)
    .run();
  if (Number(res.meta?.changes ?? 0) === 1) return { ok: true, lock: { key, owner } };

  const row = await db.prepare(`SELECT value FROM meta_cache WHERE key = ?`).bind(key).first<{ value: string }>();
  const until = Number.parseInt(row?.value ?? "0", 10);
  return { ok: false, retryAfterMs: Math.max(0, (Number.isFinite(until) ? until : 0) - now) };
}

/** Ends the run: the lock stays closed for `cooldownMs`, then opens. Only the owner's row is touched. */
export async function releaseCrankLock(
  db: D1Database,
  lock: CrankLock,
  cooldownMs: number,
  now: number = Date.now()
): Promise<void> {
  await db
    .prepare(`UPDATE meta_cache SET value = ?1, updated_at = ?2 WHERE key = ?3 AND value LIKE ?4`)
    .bind(`${now + cooldownMs}:${lock.owner}`, new Date(now).toISOString(), lock.key, `%:${lock.owner}`)
    .run()
    .catch(() => undefined);
}

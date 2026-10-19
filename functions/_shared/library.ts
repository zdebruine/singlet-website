/**
 * Libraries: a signed-in user's named folders of studies (schema/023_library_feedback.sql).
 * Every query is scoped to the owner, so one user can never read or change another's folders.
 */
const GSE_RE = /^GSE\d+$/;

export const MAX_LIBRARIES = 50;
export const MAX_ITEMS = 1000;
export const NAME_MAX = 60;
const ITEM_BATCH = 90;

export interface Library {
  id: string;
  name: string;
  gse_ids: string[];
  created_at: string;
  updated_at: string;
}

export class LibraryError extends Error {
  constructor(
    public code: "invalid_name" | "invalid_ids" | "not_found" | "too_many_libraries" | "too_many_items",
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t.length >= 1 && t.length <= NAME_MAX ? t : null;
}

/** Distinct, upper-cased GSE accessions; null when any entry is not one. */
export function cleanIds(v: unknown, max = 500): string[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out = new Set<string>();
  for (const x of v) {
    if (typeof x !== "string") return null;
    const id = x.trim().toUpperCase();
    if (!GSE_RE.test(id)) return null;
    out.add(id);
  }
  return [...out];
}

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export async function listLibraries(db: D1Database, userId: string): Promise<Library[]> {
  const libs = await db
    .prepare(`SELECT id, name, created_at, updated_at FROM libraries WHERE user_id = ? ORDER BY created_at ASC`)
    .bind(userId)
    .all<{ id: string; name: string; created_at: string; updated_at: string }>();
  if (!libs.results.length) return [];
  const items = await db
    .prepare(
      `SELECT i.library_id, i.gse_id FROM library_items i JOIN libraries l ON l.id = i.library_id
        WHERE l.user_id = ? ORDER BY i.added_at DESC, i.gse_id`,
    )
    .bind(userId)
    .all<{ library_id: string; gse_id: string }>();
  const byLib = new Map<string, string[]>();
  for (const r of items.results) {
    const list = byLib.get(r.library_id);
    if (list) list.push(r.gse_id);
    else byLib.set(r.library_id, [r.gse_id]);
  }
  return libs.results.map((l) => ({ ...l, gse_ids: byLib.get(l.id) ?? [] }));
}

async function owned(db: D1Database, userId: string, id: unknown): Promise<string> {
  if (typeof id !== "string" || !id) throw new LibraryError("not_found", "Library not found.", 404);
  const row = await db.prepare(`SELECT id FROM libraries WHERE id = ? AND user_id = ?`).bind(id, userId).first<{ id: string }>();
  if (!row) throw new LibraryError("not_found", "Library not found.", 404);
  return row.id;
}

export async function createLibrary(db: D1Database, userId: string, name: string, gseIds: string[] = []): Promise<string> {
  const n = await db.prepare(`SELECT COUNT(*) AS n FROM libraries WHERE user_id = ?`).bind(userId).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_LIBRARIES) {
    throw new LibraryError("too_many_libraries", `You can have up to ${MAX_LIBRARIES} libraries. Delete one first.`, 409);
  }
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO libraries (id, user_id, name) VALUES (?, ?, ?)`).bind(id, userId, name).run();
  if (gseIds.length) await addItems(db, userId, id, gseIds);
  return id;
}

export async function renameLibrary(db: D1Database, userId: string, id: unknown, name: string): Promise<void> {
  const lib = await owned(db, userId, id);
  await db.prepare(`UPDATE libraries SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?`).bind(name, nowIso(), lib, userId).run();
}

export async function deleteLibrary(db: D1Database, userId: string, id: unknown): Promise<void> {
  const lib = await owned(db, userId, id);
  // Items first: do not rely on foreign-key cascades being enforced on every connection.
  await db.batch([
    db.prepare(`DELETE FROM library_items WHERE library_id = ?`).bind(lib),
    db.prepare(`DELETE FROM libraries WHERE id = ? AND user_id = ?`).bind(lib, userId),
  ]);
}

export async function addItems(db: D1Database, userId: string, id: unknown, gseIds: string[]): Promise<number> {
  const lib = await owned(db, userId, id);
  const have = await db.prepare(`SELECT gse_id FROM library_items WHERE library_id = ?`).bind(lib).all<{ gse_id: string }>();
  const existing = new Set(have.results.map((r) => r.gse_id));
  const fresh = gseIds.filter((g) => !existing.has(g));
  if (existing.size + fresh.length > MAX_ITEMS) {
    throw new LibraryError("too_many_items", `A library holds up to ${MAX_ITEMS} studies.`, 409);
  }
  for (let i = 0; i < fresh.length; i += ITEM_BATCH) {
    await db.batch(
      fresh.slice(i, i + ITEM_BATCH).map((g) => db.prepare(`INSERT OR IGNORE INTO library_items (library_id, gse_id) VALUES (?, ?)`).bind(lib, g)),
    );
  }
  if (fresh.length) await db.prepare(`UPDATE libraries SET updated_at = ? WHERE id = ?`).bind(nowIso(), lib).run();
  return fresh.length;
}

export async function removeItems(db: D1Database, userId: string, id: unknown, gseIds: string[]): Promise<void> {
  const lib = await owned(db, userId, id);
  for (let i = 0; i < gseIds.length; i += ITEM_BATCH) {
    const chunk = gseIds.slice(i, i + ITEM_BATCH);
    await db
      .prepare(`DELETE FROM library_items WHERE library_id = ? AND gse_id IN (${chunk.map(() => "?").join(",")})`)
      .bind(lib, ...chunk)
      .run();
  }
  await db.prepare(`UPDATE libraries SET updated_at = ? WHERE id = ?`).bind(nowIso(), lib).run();
}

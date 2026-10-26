// Legacy-bundle retirement (website schema/038, docs/S1-CUTOVER.md). One switch in D1, `s1_flags.legacy_bundles`:
//   'served'  (default) legacy files are guarded as before;
//   'retired' a study whose .s1 migration is verified (or retired) has no public legacy file: data/<GSE>/* answers 410 and points at
//             the study's .s1 manifest. The catalog reads the same switch, so the site stops naming those URLs at the same moment.
// The Worker only reads D1 (two primary-key lookups, remembered per isolate for a minute). Without the binding, or if D1 cannot be
// read, nothing is retired: the guard fails open to the legacy behaviour, which is the rollback state.

export interface RetireEnv {
  DB?: D1Database;
}

const TTL_MS = 60_000;
const MAX_STUDIES = 4096;

let flag: { value: string; at: number } | null = null;
const studies = new Map<string, { retired: boolean; at: number }>();

/** For tests: forget everything remembered. */
export function resetRetireMemo(): void {
  flag = null;
  studies.clear();
}

async function switchValue(db: D1Database, now: number): Promise<string> {
  if (flag && now - flag.at < TTL_MS) return flag.value;
  const row = await db.prepare(`SELECT value FROM s1_flags WHERE name = 'legacy_bundles'`).first<{ value: string }>();
  flag = { value: row?.value ?? "served", at: now };
  return flag.value;
}

/** True when the study's legacy file is retired: the switch says so and its migration is verified, or its migration is retired. */
export async function isLegacyRetired(env: RetireEnv, gse: string, now = Date.now()): Promise<boolean> {
  if (!env.DB) return false;
  try {
    if ((await switchValue(env.DB, now)) !== "retired") return false;
    const hit = studies.get(gse);
    if (hit && now - hit.at < TTL_MS) return hit.retired;
    const row = await env.DB.prepare(
      `SELECT m.status FROM s1_migration m JOIN s1_study s ON s.gse_id = m.gse_id WHERE m.gse_id = ?`
    )
      .bind(gse)
      .first<{ status: string }>();
    const retired = row?.status === "verified" || row?.status === "retired";
    if (studies.size >= MAX_STUDIES) studies.delete(studies.keys().next().value as string);
    studies.set(gse, { retired, at: now });
    return retired;
  } catch {
    return false;
  }
}

export const s1ManifestUrl = (gse: string) => `https://data.singlet.bio/s1/m/${gse}.json`;

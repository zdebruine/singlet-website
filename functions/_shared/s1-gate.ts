/**
 * Whether the s1-only MCP tools (find_cells, slice_cells, resolve_features) are advertised in tools/list and the server instructions.
 *
 * They are listed only when some study is actually served from s1 (a s1_study row whose migration is verified or retired), or when the
 * variable S1_TOOLS=1 forces them on. The answer is remembered for five minutes per isolate, so the check is at most one D1 read per
 * isolate per five minutes (concurrent callers share it). Before schema 032 is applied, or on any D1 error, the answer is "no".
 *
 * The tools themselves still answer if called by name; this only decides what is advertised.
 */
export const S1_GATE_TTL_MS = 5 * 60 * 1000;

let memo: { at: number; visible: boolean } | null = null;
let inflight: Promise<boolean> | null = null;

export async function s1ToolsVisible(env: { DB?: D1Database; S1_TOOLS?: string; V2_TOOLS?: string } | null | undefined): Promise<boolean> {
  if (env?.S1_TOOLS === "1" || env?.V2_TOOLS === "1") return true; // DUAL: V2_TOOLS is the old name
  const db = env?.DB;
  if (!db) return false;
  if (memo && Date.now() - memo.at < S1_GATE_TTL_MS) return memo.visible;
  if (inflight) return inflight;
  inflight = (async () => {
    let visible = false;
    try {
      const row = await db
        .prepare(`SELECT 1 AS x FROM s1_study s JOIN s1_migration m ON m.gse_id = s.gse_id WHERE m.status IN ('verified', 'retired') LIMIT 1`)
        .first();
      visible = !!row;
    } catch {
      visible = false;
    }
    memo = { at: Date.now(), visible };
    return visible;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Forget the remembered answer (tests, and nothing else). */
export function resetS1ToolsGate(): void {
  memo = null;
  inflight = null;
}

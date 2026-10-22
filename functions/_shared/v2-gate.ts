/**
 * Whether the v2-only MCP tools (find_cells, slice_cells, resolve_features) are advertised in tools/list and the server instructions.
 *
 * They are listed only when some study is actually served from v2 (a v2_study row whose migration is verified or retired), or when the
 * variable V2_TOOLS=1 forces them on. The answer is remembered for five minutes per isolate, so the check is at most one D1 read per
 * isolate per five minutes (concurrent callers share it). Before schema 032 is applied, or on any D1 error, the answer is "no".
 *
 * The tools themselves still answer if called by name; this only decides what is advertised.
 */
export const V2_GATE_TTL_MS = 5 * 60 * 1000;

let memo: { at: number; visible: boolean } | null = null;
let inflight: Promise<boolean> | null = null;

export async function v2ToolsVisible(env: { DB?: D1Database; V2_TOOLS?: string } | null | undefined): Promise<boolean> {
  if (env?.V2_TOOLS === "1") return true;
  const db = env?.DB;
  if (!db) return false;
  if (memo && Date.now() - memo.at < V2_GATE_TTL_MS) return memo.visible;
  if (inflight) return inflight;
  inflight = (async () => {
    let visible = false;
    try {
      const row = await db
        .prepare(`SELECT 1 AS x FROM v2_study s JOIN v2_migration m ON m.gse_id = s.gse_id WHERE m.status IN ('verified', 'retired') LIMIT 1`)
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
export function resetV2ToolsGate(): void {
  memo = null;
  inflight = null;
}

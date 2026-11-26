/**
 * GET /api/beta/progress — public, live numbers for the Research Beta campaign page (/campaign). Counts only.
 *
 *   published   studies, samples and cells Beta serves right now, read from this channel's catalog (s1_study with a verified rev),
 *               the time of the newest publish, and the studies whose catalog rows are still being filled
 *   campaign    the public campaign summary the cluster posts every 15 minutes (beta/campaign-public.json in the dashboard bucket,
 *               written by singlet-agents hpc/clipper/campaign/public_feed.py): processed, shipped, held, excluded with reasons
 *   alpha       what Alpha serves (studies with files, samples in files, cells), read from singlet.bio/api/stats and cached for an hour
 *
 * Each block is null when its source is unavailable, so the page can show what it has.
 */
interface Env {
  DB: D1Database;
  HPC_DASHBOARD?: R2Bucket;
  ALPHA_API?: string;
}

const PUBLIC_FEED = "beta/campaign-public.json";

async function alphaStats(base: string): Promise<Record<string, number> | null> {
  const key = new Request(`${base}/api/stats#beta-progress`);
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) return hit.json();
  const r = await fetch(`${base}/api/stats`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (!r?.ok) return null;
  const d = (await r.json()) as Record<string, unknown>;
  const out = {
    studies: Number(d.studies_with_files) || 0,
    samples: Number(d.samples_in_files) || 0,
    cells: Number(d.cells_in_files) || 0,
  };
  await cache
    .put(key, new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" } }))
    .catch(() => undefined);
  return out;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const [published, campaign, alpha] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS studies, COALESCE(SUM(st.n_samples), 0) AS samples, COALESCE(SUM(st.n_cells_called), 0) AS cells,
              MAX(st.updated_at) AS last_publish,
              (SELECT COUNT(*) FROM s1_study s2 LEFT JOIN beta_catalog_sync y ON y.gse_id = s2.gse_id
                WHERE y.rev IS NULL OR y.rev != s2.rev) AS catalog_pending
         FROM s1_study st JOIN s1_migration mg ON mg.gse_id = st.gse_id AND mg.status IN ('verified', 'retired')`,
    )
      .first<Record<string, number | string>>()
      .catch(() =>
        env.DB.prepare(
          `SELECT COUNT(*) AS studies, COALESCE(SUM(n_samples), 0) AS samples, COALESCE(SUM(n_cells_called), 0) AS cells, MAX(updated_at) AS last_publish FROM s1_study`,
        )
          .first<Record<string, number | string>>()
          .catch(() => null),
      ),
    env.HPC_DASHBOARD?.get(PUBLIC_FEED)
      .then((o) => (o ? o.json() : null))
      .catch(() => null) ?? Promise.resolve(null),
    alphaStats(env.ALPHA_API || "https://singlet.bio").catch(() => null),
  ]);
  return new Response(JSON.stringify({ schema: "beta-progress/1", generated_at: new Date().toISOString(), published, campaign, alpha }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60", "Access-Control-Allow-Origin": "*" },
  });
};

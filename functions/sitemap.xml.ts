/**
 * GET /sitemap.xml
 * Static routes plus one /study/<GSE> entry per study that has a downloadable
 * bundle (gse_meta.has_bundle = 1). Built from D1, served through the edge
 * cache for a day — the catalog changes roughly daily and crawlers re-fetch
 * far less often than that.
 *
 * Kept as a single <urlset>: the sitemap protocol allows 50,000 URLs per
 * file and the catalog has ~10K studies with bundles. `MAX_URLS` guards the
 * limit; if the atlas ever grows past it this should become a sitemap index.
 */
import { cachedJson } from "./_shared/cache";

interface Env {
  DB: D1Database;
}

const ORIGIN = "https://singlet.bio";
const TTL_SECONDS = 86_400;
const MAX_URLS = 49_000;

const STATIC_ROUTES: { path: string; changefreq: string; priority: string }[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/browse", changefreq: "daily", priority: "0.9" },
  { path: "/docs", changefreq: "weekly", priority: "0.8" },
  { path: "/about", changefreq: "weekly", priority: "0.7" },
  { path: "/data-license", changefreq: "yearly", priority: "0.3" },
  { path: "/terms", changefreq: "yearly", priority: "0.2" },
  { path: "/privacy", changefreq: "yearly", priority: "0.2" },
];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** `updated_at` arrives as ISO text or epoch seconds; emit YYYY-MM-DD or nothing. */
function lastmod(v: unknown): string | null {
  if (v == null) return null;
  const d = typeof v === "number" ? new Date(v * (v < 1e12 ? 1000 : 1)) : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function build(db: D1Database): Promise<string> {
  const rows = await db
    .prepare(
      `SELECT gse_id, updated_at
         FROM gse_meta
        WHERE has_bundle = 1
        ORDER BY gse_id
        LIMIT ?`
    )
    .bind(MAX_URLS - STATIC_ROUTES.length)
    .all<{ gse_id: string; updated_at: unknown }>();

  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
  for (const r of STATIC_ROUTES) {
    out.push(`  <url><loc>${ORIGIN}${r.path}</loc><changefreq>${r.changefreq}</changefreq><priority>${r.priority}</priority></url>`);
  }
  for (const r of rows.results) {
    if (!/^GSE\d+$/.test(r.gse_id)) continue;
    const lm = lastmod(r.updated_at);
    out.push(
      `  <url><loc>${ORIGIN}/study/${esc(r.gse_id)}</loc>${lm ? `<lastmod>${lm}</lastmod>` : ""}<changefreq>monthly</changefreq><priority>0.6</priority></url>`
    );
  }
  out.push("</urlset>", "");
  return out.join("\n");
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request, waitUntil }) =>
  cachedJson(
    request,
    waitUntil,
    async () => {
      try {
        const xml = await build(env.DB);
        return new Response(xml, {
          status: 200,
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": `public, max-age=${TTL_SECONDS}`,
          },
        });
      } catch (e) {
        // Never cache a failure; fall back to the static routes so crawlers
        // still get a valid document.
        const xml = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...STATIC_ROUTES.map((r) => `  <url><loc>${ORIGIN}${r.path}</loc><changefreq>${r.changefreq}</changefreq><priority>${r.priority}</priority></url>`),
          `  <!-- study entries unavailable: ${esc(String(e)).slice(0, 200)} -->`,
          "</urlset>",
          "",
        ].join("\n");
        return new Response(xml, {
          status: 503,
          headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "300" },
        });
      }
    },
    { ttl: TTL_SECONDS, key: "v=1" }
  );

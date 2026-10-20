// Pages through GET /api/ingest/export and writes the two files build-index.ts reads:
// samples.json (flat rows, `layer` joined in from the studies table) and facts.json (sample_attr rows).
// Needs SINGLET_INGEST_TOKEN in the environment (never printed) and, optionally, SITE_URL (default https://singlet.bio).
//
//   node scripts/search-index/fetch-export.mjs <outdir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
const token = process.env.SINGLET_INGEST_TOKEN;
const site = (process.env.SITE_URL || "https://singlet.bio").replace(/\/+$/, "");
if (!out || !token) {
  console.error("usage: SINGLET_INGEST_TOKEN=... fetch-export.mjs <outdir>");
  process.exit(2);
}

async function page(table, after, limit) {
  const url = `${site}/api/ingest/export?table=${table}&limit=${limit}&after=${encodeURIComponent(after)}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "X-Ingest-Token": token }, signal: AbortSignal.timeout(60_000) });
      if (res.ok) return await res.json();
      // A bad token or table will not get better; a 5xx or 429 might.
      if (res.status < 500 && res.status !== 429) throw Object.assign(new Error(`${table}: HTTP ${res.status}`), { fatal: true });
      throw new Error(`${table}: HTTP ${res.status}`);
    } catch (e) {
      if (e.fatal || attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

async function all(table, limit) {
  const rows = [];
  let columns = [];
  let after = "";
  for (;;) {
    const p = await page(table, after, limit);
    columns = p.columns;
    for (const r of p.rows) rows.push(Object.fromEntries(columns.map((c, i) => [c, r[i]])));
    if (!p.next) break;
    after = p.next;
  }
  console.log(`${table}: ${rows.length} rows`);
  return rows;
}

const studies = await all("studies", 2000);
const layers = new Map(studies.map((s) => [s.gse_id, s.layer || null]));
const samples = await all("samples", 2000);
if (samples.length === 0) throw new Error("the export returned no samples");
for (const s of samples) s.layer = layers.get(s.gse_id) ?? null;
const facts = await all("sample_attr", 5000);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "samples.json"), JSON.stringify(samples));
writeFileSync(join(out, "facts.json"), JSON.stringify(facts));

// Publishes a built index through POST /api/ingest/search-index: the binary first, then index.json.
// Needs SINGLET_INGEST_TOKEN in the environment (never printed) and, optionally, SITE_URL (default https://singlet.bio).
//
//   node scripts/search-index/upload.mjs <build-index --out dir>
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const token = process.env.SINGLET_INGEST_TOKEN;
const site = (process.env.SITE_URL || "https://singlet.bio").replace(/\/+$/, "");
if (!dir || !token) {
  console.error("usage: SINGLET_INGEST_TOKEN=... upload.mjs <index dir>");
  process.exit(2);
}

async function post(query, body, type) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${site}/api/ingest/search-index?${query}`, {
        method: "POST",
        headers: { "X-Ingest-Token": token, "Content-Type": type },
        body,
        signal: AbortSignal.timeout(300_000),
      });
      const text = await res.text();
      if (res.ok) return JSON.parse(text);
      const err = Object.assign(new Error(`${query}: HTTP ${res.status} ${text.slice(0, 300)}`), { fatal: res.status < 500 });
      throw err;
    } catch (e) {
      if (e.fatal || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

const dictText = readFileSync(join(dir, "index.json"), "utf8");
const bin = JSON.parse(dictText).bin;
const a = await post(`part=bin&name=${encodeURIComponent(bin)}`, readFileSync(join(dir, bin)), "application/octet-stream");
console.log(`binary stored: ${a.bin}, ${a.bytes} bytes, ${a.n_samples} samples`);
const b = await post("part=dict", dictText, "application/json");
console.log(`published ${b.index_version} (${b.n_samples} samples; previous ${b.previous ?? "none"}, ${b.deleted} old binaries deleted)`);

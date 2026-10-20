/**
 * Posts the files written by make-cards.ts to POST /api/ingest/<table> (sample_attr, study_card, pz_chunk_index).
 * Idempotent (the server upserts on the table key) and resumable: a <file>.done marker records the next row to send.
 * The ingest token comes from SINGLET_INGEST_TOKEN and is only ever sent as the X-Ingest-Token header.
 *
 *   SINGLET_INGEST_TOKEN=... npm run enrich:ingest -- --dir /tmp/run [--tables sample_attr,study_card] [--base https://singlet.bio]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arg } from "./api";

const dir = arg("dir", "scripts/enrich/sample-run");
const base = arg("base", process.env.SINGLET_BASE ?? "https://singlet.bio");
const tables = arg("tables", "sample_attr,study_card").split(",");
const batch = Number(arg("batch", "500"));
const token = process.env.SINGLET_INGEST_TOKEN;
if (!token) {
  console.error("SINGLET_INGEST_TOKEN is not set");
  process.exit(2);
}

async function post(table: string, rows: unknown[]): Promise<{ written: number }> {
  let last = "";
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`${base}/api/ingest/${table}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ingest-token": token! },
      body: JSON.stringify({ rows }),
    });
    if (r.ok) return (await r.json()) as { written: number };
    last = `${r.status} ${(await r.text()).slice(0, 300)}`;
    if (r.status >= 400 && r.status < 500 && r.status !== 429) break;
    await new Promise((res) => setTimeout(res, 1000 * 2 ** i));
  }
  throw new Error(`${table}: ${last}`);
}

for (const table of tables) {
  const file = join(dir, `${table}.jsonl`);
  if (!existsSync(file)) {
    console.error(`${file} not found, skipping`);
    continue;
  }
  const marker = `${file}.done`;
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  let from = existsSync(marker) ? Number(readFileSync(marker, "utf8")) || 0 : 0;
  let written = 0;
  for (; from < lines.length; from += batch) {
    const res = await post(table, lines.slice(from, from + batch).map((l) => JSON.parse(l)));
    written += res.written;
    writeFileSync(marker, String(from + batch));
    if ((from / batch) % 20 === 0) console.log(`${table}: ${Math.min(from + batch, lines.length)}/${lines.length}`);
  }
  console.log(`${table}: done, ${written} rows written this run, ${lines.length} in file`);
}

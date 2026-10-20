/**
 * Deterministic sample-fact pre-pass (T5). Reads studies from the public API, writes `sample_attr` rows
 * (source = 'geo') and, per study, a JSONL batch of what the rules could not place, for a model pass
 * (prompt and schema: scripts/enrich/extract-sample-attrs.md). Read-only against singlet.bio; writes files only.
 *
 *   npm run enrich:attrs -- --sample 50 --seed 1 --out /tmp/attrs
 *   npm run enrich:attrs -- --studies GSE138867,GSE128639 --out /tmp/attrs
 *
 * Output: <out>/sample_attr.jsonl (ingest-ready rows), <out>/unplaced/<GSE>.jsonl (model batches).
 * Concurrency is capped at 4. Re-running with the same arguments writes identical files.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arg, listDownloadableStudies, loadStudyInput, pool, sampleIds } from "./api";
import { extractStudy } from "./batch";

const out = arg("out", "scripts/enrich/out");
const cache = arg("cache", "") || undefined;
const explicit = arg("studies", "");

const ids = explicit
  ? explicit.split(",").map((s) => s.trim().toUpperCase())
  : sampleIds(await listDownloadableStudies(), Number(arg("sample", "50")), Number(arg("seed", "1")));

mkdirSync(join(out, "unplaced"), { recursive: true });
const rows: string[] = [];
let nUnplaced = 0;
let nBatches = 0;

await pool(ids, 4, async (gse) => {
  const input = await loadStudyInput(gse, cache);
  const e = extractStudy(input);
  rows.push(...e.rows.map((r) => JSON.stringify(r)));
  nUnplaced += e.unplaced.length;
  if (e.batch.length) {
    writeFileSync(join(out, "unplaced", `${gse}.jsonl`), e.batch.join("\n") + "\n");
    nBatches++;
  }
});

rows.sort();
writeFileSync(join(out, "sample_attr.jsonl"), rows.join("\n") + "\n");
console.log(`${ids.length} studies, ${rows.length} rows, ${nUnplaced} unplaced values, ${nBatches} model batches -> ${out}`);

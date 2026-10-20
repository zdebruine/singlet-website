/**
 * Builds study cards and per-sample lines from facts and writes the run report (T7). Read-only against
 * singlet.bio; writes files only, never D1, and no model is called.
 *
 *   npm run enrich:cards -- --sample 200 --seed 20261020 --out scripts/enrich/sample-run [--cache /tmp/studies]
 *   npm run enrich:cards -- --studies GSE138867 --out /tmp/cards
 *
 * Output in <out>: cards.jsonl (one card per study), sample-lines.jsonl (first studies only),
 * summaries.tsv (gse, grounded, summary), report.json (coverage, grounding, top unplaced values).
 * The ingest shape for `study_card` is { gse_id, card_json, summary_text, extractor_version, model: null, grounded }.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arg, listDownloadableStudies, loadStudyInput, pool, sampleIds } from "./api";
import { extractStudy } from "./batch";
import { EXTRACTOR_VERSION } from "../../functions/_shared/attr-extract";
import { approvedSamples, buildStudyCard, CARD_VERSION, sampleLine, type StudyCard } from "../../functions/_shared/study-card";

const out = arg("out", "scripts/enrich/sample-run");
const cache = arg("cache", "") || undefined;
const explicit = arg("studies", "");
const LINE_STUDIES = 5;

const ids = explicit
  ? explicit.split(",").map((s) => s.trim().toUpperCase())
  : sampleIds(await listDownloadableStudies(), Number(arg("sample", "200")), Number(arg("seed", "20261020")));

mkdirSync(out, { recursive: true });

interface Result {
  card: StudyCard;
  lines: { gsm_id: string; line: string }[];
  samples: number;
  have: Record<string, number>;
  unplaced: { attr: string; value: string; gsm_id: string }[];
  unmapped: { key: string; gsm_id: string }[];
  batchLines: number;
}

const results = (
  await pool(ids, 4, async (gse): Promise<Result> => {
    const input = await loadStudyInput(gse, cache);
    const e = extractStudy(input);
    const card = buildStudyCard(input, e.rows);
    const approved = approvedSamples(input);
    const have: Record<string, number> = {};
    for (const a of ["tissue", "disease", "treatment", "age", "sex", "donor", "genotype", "cell_type_sorted"]) have[a] = card.coverage[a] ?? 0;
    return {
      card,
      lines: approved.map((s) => ({ gsm_id: s.gsm_id, line: sampleLine(s, e.rows) })),
      samples: approved.length,
      have,
      unplaced: e.unplaced.map((u) => ({ attr: u.attr, value: u.value, gsm_id: u.gsm_id })),
      unmapped: e.unmapped.map((u) => ({ key: u.key, gsm_id: u.gsm_id })),
      batchLines: Math.max(0, e.batch.length - 1),
    };
  })
)
  .filter((r): r is Result => r != null)
  .sort((a, b) => a.card.gse_id.localeCompare(b.card.gse_id));

// ── report ──────────────────────────────────────────────────────────────────
const nStudies = results.length;
const withSamples = results.filter((r) => r.samples > 0);
const nSamples = results.reduce((t, r) => t + r.samples, 0);
const grounded = withSamples.filter((r) => r.card.grounded).length;
const share = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

const factShare: Record<string, { samples: number; pct: number; studies_with_any: number; studies_pct: number }> = {};
for (const a of ["tissue", "disease", "treatment", "age", "sex", "donor", "genotype", "cell_type_sorted"]) {
  const s = results.reduce((t, r) => t + r.have[a], 0);
  const st = withSamples.filter((r) => r.have[a] > 0).length;
  factShare[a] = { samples: s, pct: share(s, nSamples), studies_with_any: st, studies_pct: share(st, withSamples.length) };
}

function top(items: string[], k = 10) {
  const m = new Map<string, { value: string; n: number }>();
  for (const v of items) {
    const key = v.toLowerCase();
    const h = m.get(key);
    if (h) h.n++;
    else m.set(key, { value: v, n: 1 });
  }
  return [...m.values()].sort((a, b) => b.n - a.n || a.value.localeCompare(b.value)).slice(0, k);
}
const unplacedTop: Record<string, { value: string; n: number }[]> = {};
const attrs = [...new Set(results.flatMap((r) => r.unplaced.map((u) => u.attr)))].sort();
for (const a of attrs) unplacedTop[a] = top(results.flatMap((r) => r.unplaced.filter((u) => u.attr === a).map((u) => u.value)));
const unplacedSamples: Record<string, number> = {};
for (const a of attrs) unplacedSamples[a] = results.reduce((t, r) => t + new Set(r.unplaced.filter((u) => u.attr === a).map((u) => u.gsm_id)).size, 0);

const reasons = top(withSamples.flatMap((r) => r.card.ungrounded.map((u) => u.replace(/GSM\d+/g, "GSM").replace(/"[^"]*"/g, '"..."').replace(/\d+/g, "N"))), 10);
const lens = withSamples.map((r) => r.card.summary_text.length);

const report = {
  extractor_version: EXTRACTOR_VERSION,
  card_version: CARD_VERSION,
  ids: explicit ? ids : { n: ids.length, seed: Number(arg("seed", "20261020")), source: "downloadable studies in /api/search, seeded shuffle" },
  studies: nStudies,
  studies_with_approved_samples: withSamples.length,
  approved_samples: nSamples,
  grounded_studies: grounded,
  grounded_pct: share(grounded, withSamples.length),
  ungrounded_reasons: reasons,
  facts: factShare,
  summary_chars: { mean: Math.round(lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length)), max: Math.max(0, ...lens) },
  samples_with_unplaced_value: unplacedSamples,
  unplaced_top10: unplacedTop,
  unmapped_keys_top20: top(results.flatMap((r) => r.unmapped.map((u) => u.key)), 20),
  samples_in_model_batches: results.reduce((t, r) => t + r.batchLines, 0),
};

writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
writeFileSync(join(out, "cards.jsonl"), results.map((r) => JSON.stringify(r.card)).join("\n") + "\n");
writeFileSync(
  join(out, "sample-lines.jsonl"),
  results
    .filter((r) => r.samples > 0)
    .slice(0, LINE_STUDIES)
    .map((r) => JSON.stringify({ gse_id: r.card.gse_id, lines: r.lines.slice(0, 12) }))
    .join("\n") + "\n",
);
writeFileSync(join(out, "summaries.tsv"), results.map((r) => `${r.card.gse_id}\t${r.card.grounded ? 1 : 0}\t${r.card.summary_text}`).join("\n") + "\n");

console.log(JSON.stringify({ ...report, unplaced_top10: undefined, unmapped_keys_top20: undefined }, null, 2));
console.log("\nTop unplaced raw values per attr:");
for (const a of attrs) console.log(`  ${a} (${unplacedSamples[a]} samples): ` + unplacedTop[a].map((x) => `${x.value} (${x.n})`).join("; "));

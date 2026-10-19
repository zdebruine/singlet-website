// Offline scope heuristic for GEO series text: is this a single-cell study at all?
// Text triage only: it reads the title and abstract, so a "not_single_cell" verdict means "review before
// processing", not "remove". Reads { id, title, abs } records (JSON object or array) from a file and prints a count per class.
// Usage: node scripts/data-audit/scope.mjs records.json [--list=class]
import { readFileSync } from "node:fs";

const SC = /single[-_ ]?cell|single[-_ ]?nucle|scrna|snrna|sc-?rna|sn-?rna|10x genomics|chromium|drop-?seq|in-?drop|smart-?seq|cel-?seq|cite-?seq|seq-?well|sci-?rna|cell atlas|scatac/i;
const OTHER = /\bbulk\b|chip-?seq|atac-?seq|cut&|cut-and|hi-?c\b|methylation|microarray|ribosome profiling|small rna|mirna|16s|whole[- ]genome|exome|proteom/i;
const SUPER = /this superseries is composed of/i;

/** @returns {"single_cell" | "mixed" | "not_single_cell" | "superseries"} */
export function scopeOf(title, abstract) {
  const text = `${title ?? ""}\n${abstract ?? ""}`;
  if (SUPER.test(text) && !SC.test(text)) return "superseries";
  const sc = SC.test(text);
  const other = OTHER.test(text);
  if (sc && !other) return "single_cell";
  if (sc && other) return "mixed";
  return "not_single_cell";
}

if (process.argv[1]?.endsWith("scope.mjs") && process.argv[2]) {
  const raw = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const rows = Array.isArray(raw) ? raw : Object.values(raw);
  const list = process.argv.find((a) => a.startsWith("--list="))?.slice(7);
  const counts = {};
  for (const r of rows) {
    const c = scopeOf(r.title, r.abs ?? r.abstract);
    counts[c] = (counts[c] ?? 0) + 1;
    if (list === c) console.log(r.id, "|", (r.title ?? "").slice(0, 110));
  }
  if (!list) console.log(counts);
}

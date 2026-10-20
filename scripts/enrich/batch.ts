/**
 * Study-level glue shared by extract-attrs.ts and make-cards.ts: run the deterministic extractor over a
 * study's approved samples and build the JSONL batch the model pass reads.
 */
import { extractSampleAttrs, type AttrRow, type Unplaced } from "../../functions/_shared/attr-extract";
import { approvedSamples, platformLabel, type StudyInput } from "../../functions/_shared/study-card";

export interface StudyExtraction {
  rows: AttrRow[];
  unplaced: (Unplaced & { gsm_id: string })[];
  unmapped: { gsm_id: string; key: string; value: string; evidence: string }[];
  /** One JSONL line per sample that needs the model (plus a header line); empty when nothing is left over. */
  batch: string[];
}

/** Attributes worth asking the model about when the rules found nothing for a sample. */
const ASK_WHEN_MISSING = ["tissue"] as const;

export function extractStudy(input: StudyInput): StudyExtraction {
  const rows: AttrRow[] = [];
  const unplaced: StudyExtraction["unplaced"] = [];
  const unmapped: StudyExtraction["unmapped"] = [];
  const lines: string[] = [];

  for (const s of approvedSamples(input)) {
    const e = extractSampleAttrs({
      gsm_id: s.gsm_id,
      gse_id: s.gse_id,
      title: s.title,
      source: s.source,
      characteristics: s.characteristics_raw,
      organism_primary: s.organism_primary,
    });
    rows.push(...e.rows);
    unplaced.push(...e.unplaced.map((u) => ({ ...u, gsm_id: s.gsm_id })));
    unmapped.push(...e.unmapped.map((u) => ({ ...u, gsm_id: s.gsm_id })));

    const have = new Set(e.rows.map((r) => r.attr));
    const missing = ASK_WHEN_MISSING.filter((a) => !have.has(a));
    if (!e.unplaced.length && !e.unmapped.length && !missing.length) continue;
    lines.push(
      JSON.stringify({
        type: "sample",
        gsm_id: s.gsm_id,
        title: s.title ?? null,
        source: s.source ?? null,
        characteristics: s.characteristics_raw ?? null,
        platform: platformLabel(s.protocol, s.assay_family, s.modality),
        have: Object.fromEntries(e.rows.map((r) => [r.attr, r.value_norm])),
        unplaced: e.unplaced.map(({ attr, key, value }) => ({ attr, key, value })),
        unmapped_keys: e.unmapped.map((u) => u.key),
        missing,
      }),
    );
  }

  const batch = lines.length
    ? [
        JSON.stringify({
          type: "study",
          gse_id: input.series.id,
          title: input.series.title ?? null,
          organism: input.meta?.organisms?.join("; ") ?? null,
          abstract: (input.series.abstract ?? "").slice(0, 1200),
        }),
        ...lines,
      ]
    : [];
  return { rows, unplaced, unmapped, batch };
}

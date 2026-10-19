/**
 * Per-study completeness: where every GEO sample of a series ended up.
 *
 * Every sample lands in exactly one bucket, so a visitor can tell a study that
 * is whole from one that is partly unprocessable, partly pending and partly
 * unpublished. See docs/COMPLETENESS-REPORT.md.
 */

/** Why a sample is not usable, in plain words. `class` groups reasons for counting. */
export type ExclusionClass = "not_processable" | "retry" | "qc" | "queued";

export interface Exclusion {
  class: ExclusionClass;
  reason: string;
}

const NOT_PROCESSABLE: Record<string, string> = {
  fail_barcode_stripped: "the cell-barcode read is not in the deposited reads",
  fail_gse_skip_barcode_stripped: "the cell-barcode read is not in the deposited reads (series skipped)",
  fail_no_r2: "the deposit has no second read",
  skip_plate_based: "plate-based library, not a droplet run",
};

const QC_FAILED: Record<string, string> = {
  fail_low_mapping: "too few reads mapped",
  fail_qc_few_cells: "too few cells called",
  fail_qc_low_genes: "too few genes per cell",
  fail_qc_other: "did not pass QC",
};

/** Classify a gsm row that is not DONE. Returns null for processed samples. */
export function exclusionFor(status: string | null | undefined, category: string | null | undefined): Exclusion | null {
  if (status === "DONE" || status === "DONE_QC_WARN") return null;
  if (status === "FAIL" || status === "HARD_FAIL") {
    const c = category ?? "";
    if (NOT_PROCESSABLE[c]) return { class: "not_processable", reason: NOT_PROCESSABLE[c] };
    if (QC_FAILED[c]) return { class: "qc", reason: QC_FAILED[c] };
    return { class: "retry", reason: "processing did not finish; it may be retried" };
  }
  return { class: "queued", reason: "waiting to be processed" };
}

export type CompletenessState =
  /** Every GEO sample is accounted for and the file holds all processed samples. */
  | "complete"
  /** Some samples are excluded, failed or not yet queued; the file is up to date. */
  | "partial"
  /** Samples are processed but the file does not hold them all. */
  | "file_pending"
  /** Nothing processed. */
  | "none";

export interface Completeness {
  /** Samples GEO lists for the series (the larger of GEO's count and our rows). */
  geo_samples: number;
  /** GEO samples with no row here: never queued, or each GEO sample is one cell of a plate. */
  not_queued: number;
  queued: number;
  processed: number;
  /** Processed samples missing from the published file (all of them when there is no file). */
  file_pending: number;
  in_file: number | null;
  passed_qc: number | null;
  low_qc: number;
  removed: number;
  not_processable: number;
  retry: number;
  failed_qc: number;
  /** Count of failed samples per plain-words reason. */
  reasons: { class: ExclusionClass; reason: string; n: number }[];
  state: CompletenessState;
  /** Short sentences explaining the state, safe to show as-is. */
  notes: string[];
}

export interface CompletenessInput {
  nGsmTotal: number;
  samples: { status: string | null; failure_category: string | null }[];
  hasFile: boolean;
  bundleSamples: number | null;
  passedQc: number | null;
  lowQc: number;
  removed: number;
}

export function studyCompleteness(i: CompletenessInput): Completeness {
  const queued = i.samples.length;
  const geo = Math.max(i.nGsmTotal, queued);
  let processed = 0;
  let waiting = 0;
  const by = new Map<string, { class: ExclusionClass; reason: string; n: number }>();
  const cls: Record<ExclusionClass, number> = { not_processable: 0, retry: 0, qc: 0, queued: 0 };
  for (const s of i.samples) {
    const ex = exclusionFor(s.status, s.failure_category);
    if (!ex) {
      processed++;
      continue;
    }
    cls[ex.class]++;
    if (ex.class === "queued") {
      waiting++;
      continue;
    }
    const k = `${ex.class}:${ex.reason}`;
    const cur = by.get(k);
    if (cur) cur.n++;
    else by.set(k, { ...ex, n: 1 });
  }
  const inFile = i.hasFile ? i.bundleSamples : 0;
  // Without a file nothing is published; with a file of unknown size we cannot say.
  const filePending = i.hasFile ? (inFile != null ? Math.max(0, processed - inFile) : 0) : processed;
  const notQueued = geo - queued;

  const notes: string[] = [];
  if (processed > 0 && !i.hasFile) notes.push(`${processed} processed samples are waiting to be packed into the study file.`);
  else if (filePending > 0) notes.push(`${filePending} processed samples are not in the study file yet.`);
  if (cls.not_processable) notes.push(`${cls.not_processable} samples cannot be processed from the deposited reads.`);
  if (cls.retry) notes.push(`${cls.retry} samples did not finish processing and may be retried.`);
  if (cls.qc) notes.push(`${cls.qc} samples failed QC.`);
  if (waiting) notes.push(`${waiting} samples are queued.`);
  if (notQueued > 0) notes.push(`${notQueued} of the ${geo} samples GEO lists for this series have not been queued.`);

  let state: CompletenessState;
  if (processed === 0) state = "none";
  else if (filePending > 0) state = "file_pending";
  else if (notQueued === 0 && cls.not_processable + cls.retry + cls.qc + waiting === 0) state = "complete";
  else state = "partial";

  return {
    geo_samples: geo,
    not_queued: notQueued,
    queued: waiting,
    processed,
    file_pending: filePending,
    in_file: i.hasFile ? i.bundleSamples : null,
    passed_qc: i.passedQc,
    low_qc: i.lowQc,
    removed: i.removed,
    not_processable: cls.not_processable,
    retry: cls.retry,
    failed_qc: cls.qc,
    reasons: [...by.values()].sort((a, b) => b.n - a.n),
    state,
    notes,
  };
}

/**
 * Study data cards (docs/SEARCH-ROADMAP.md 4.2, task T7): what is in a study, per GSE and per GSM, written
 * from facts only.
 *
 * Inputs are the approved samples of a study (processed, QC tier 0, with counts in the file), their
 * `sample_attr` rows (see ./attr-extract) and the file index. The card is a fixed schema; `summary_text`
 * is rendered from it with templates, so a sentence exists only when the fact behind it does. Nothing is
 * guessed, no model is involved, and low-QC, removed or failed samples are never counted or mentioned.
 *
 * `grounded` is true only when every entity and every number in the card and its summary resolves to a
 * `sample_attr` row (whose evidence is the sample's own text), a sample record or a file path.
 *
 * Pure functions: used by scripts/enrich/make-cards.ts and the study page (src/components/study/DataSummary).
 */
import { evidenceHolds, type Attr, type AttrRow } from "./attr-extract";
import { organismToCommon } from "./vocab";

export const CARD_VERSION = "card-2026-10-20";
export const SUMMARY_MAX_CHARS = 600;

export interface SampleInput {
  gsm_id: string;
  gse_id: string;
  organism_primary?: string | null;
  protocol?: string | null;
  assay_family?: string | null;
  modality?: string | null;
  n_cells?: number | null;
  status?: string | null;
  title?: string | null;
  source?: string | null;
  characteristics_raw?: string | null;
  low_qc?: boolean;
}

export interface StudyInput {
  series: { id: string; title?: string | null; abstract?: string | null; unusable_gsm_ids?: string[]; organism_label?: string | null };
  meta?: { organism_label?: string | null; organisms?: string[] } | null;
  samples: SampleInput[];
  /** Paths inside the study's file with the `samples/<gsm>/` prefix removed (from /api/bundle/<gse>/index). */
  file_paths?: string[];
}

export interface Tally {
  value: string;
  n: number;
}

export interface Axis {
  attr: string;
  groups: Tally[];
  /** Distinct values beyond the four a summary names. */
  hidden: number;
}

export interface StudyCard {
  version: string;
  gse_id: string;
  /** Approved samples: the only ones counted anywhere in the card. */
  n_samples: number;
  n_cells: number | null;
  /** n_cells to two significant figures, as written in the summary ("47k"). */
  cells_label: string | null;
  organisms: string[];
  /** Distinct tissues; `tissues` lists them all. */
  n_tissues: number;
  tissues: Tally[];
  sample_types: Tally[];
  cell_types: Tally[];
  diseases: Tally[];
  treatments: Tally[];
  genotypes: Tally[];
  timepoints: Tally[];
  sexes: Tally[];
  ancestries: Tally[];
  life_stages: Tally[];
  age: { min: number; max: number; unit: string; n: number } | null;
  donors: { n_labeled: number; n_samples: number } | null;
  platforms: Tally[];
  layers: string[];
  /** Attributes with two or more groups among the approved samples. */
  axes: Axis[];
  /** Approved samples that carry each attribute. */
  coverage: Record<string, number>;
  caveats: string[];
  summary_text: string;
  grounded: boolean;
  ungrounded: string[];
}

// ── helpers ────────────────────────────────────────────────────────────────

/** The site's rule (StudyDetail): processed, not low QC, not an empty sample. Tier 2 never reaches the API. */
export function approvedSamples(input: StudyInput): SampleInput[] {
  const bad = new Set(input.series.unusable_gsm_ids ?? []);
  return input.samples.filter((s) => (s.status === "DONE" || s.status === "DONE_QC_WARN") && !s.low_qc && !bad.has(s.gsm_id));
}

export function platformLabel(protocol?: string | null, assay?: string | null, modality?: string | null): string | null {
  const a = assay ?? "";
  const p = (protocol ?? "").toLowerCase();
  if (!a || a === "Unknown" || a === "Not single-cell RNA") return null;
  let base: string;
  if (a === "10x 3'") base = /v([23])/.test(p) ? `10x 3' v${p.match(/v([23])/)![1]}` : "10x 3'";
  else if (a === "10x 5'") base = /v([23])/.test(p) ? `10x 5' v${p.match(/v([23])/)![1]}` : "10x 5'";
  else if (a === "10x (version unconfirmed)") base = "10x";
  else if (a === "10x Multiome / ATAC") base = "10x Multiome";
  else if (a === "Spatial") base = p.includes("visium") ? "Visium spatial" : "spatial";
  else base = a;
  const m = (modality ?? "").trim();
  const suffix = m === "snRNA" ? " snRNA-seq" : m === "scRNA" ? " scRNA-seq" : "";
  return base + suffix;
}

const lc = (s: string) => s.toLowerCase();

function tally(values: string[], order: "count" | "alpha" = "count"): Tally[] {
  const m = new Map<string, Tally>();
  for (const v of values) {
    const k = lc(v);
    const hit = m.get(k);
    if (hit) hit.n += 1;
    else m.set(k, { value: v, n: 1 });
  }
  const out = [...m.values()];
  // Ties keep the order the samples list them in (GSM order), so "wild type 3, KO 3" reads as the submitter's design.
  if (order === "count") out.sort((a, b) => b.n - a.n);
  else out.sort((a, b) => a.value.localeCompare(b.value, "en", { numeric: true, sensitivity: "base" }));
  return out;
}

function roundSig2(n: number): number {
  if (n < 1000) return n;
  const mag = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.round(n / mag) * mag;
}

export function cellsLabel(n: number | null): string | null {
  if (n == null || n <= 0) return null;
  if (n < 1000) return String(n);
  const r = roundSig2(n);
  if (r >= 1e6) return `${Number((r / 1e6).toFixed(1))}M`;
  return `${Number((r / 1e3).toFixed(r >= 1e5 ? 0 : 1))}k`;
}

const TO_DAYS: Record<string, number> = { years: 365.25, months: 30.44, weeks: 7, days: 1 };

/**
 * Layers a summary may name. Research Alpha does not offer genetic ancestry or doublet scores (./restricted), and genetic sex only for human
 * studies (mouse sex_call.json files hold only "unknown", docs/DENSE-METADATA.md).
 */
const LAYER_FILES: { file: string; label: string; humanOnly?: boolean }[] = [
  { file: "sex_call.json", label: "genetic sex", humanOnly: true },
  { file: "donor_assignments.tsv", label: "donor demultiplexing" },
];

const AXIS_ORDER: { attr: Attr; label: string }[] = [
  { attr: "disease", label: "disease" },
  { attr: "treatment", label: "treatment" },
  { attr: "genotype", label: "genotype" },
  { attr: "timepoint", label: "time point" },
  { attr: "age", label: "age" },
  { attr: "sex", label: "sex" },
  { attr: "cell_type_sorted", label: "cell type" },
  { attr: "tissue", label: "tissue" },
  { attr: "sample_type", label: "sample type" },
  { attr: "ancestry", label: "ancestry" },
];

/** The value as a reader sees it ("none" is "untreated"). */
function shown(attr: string, v: string): string {
  if (attr === "treatment" && v === "none") return "untreated";
  return v.length > 40 ? v.slice(0, 37).trimEnd() + "..." : v;
}

function rowsByAttr(rows: AttrRow[], ids: Set<string>) {
  const by = new Map<string, Map<string, AttrRow>>();
  for (const r of rows) {
    if (!ids.has(r.gsm_id)) continue;
    let m = by.get(r.attr);
    if (!m) by.set(r.attr, (m = new Map()));
    if (!m.has(r.gsm_id)) m.set(r.gsm_id, r);
  }
  return by;
}

// ── card ───────────────────────────────────────────────────────────────────

export function buildStudyCard(input: StudyInput, rows: AttrRow[]): StudyCard {
  const approved = approvedSamples(input);
  const ids = new Set(approved.map((s) => s.gsm_id));
  const by = rowsByAttr(rows, ids);
  const attrRows = (a: Attr) => [...(by.get(a)?.values() ?? [])];
  const norms = (a: Attr) => attrRows(a).map((r) => r.value_norm);
  const n = approved.length;

  const cellSum = approved.reduce((t, s) => t + (s.n_cells != null && s.n_cells > 0 ? s.n_cells : 0), 0);
  const nCells = cellSum > 0 ? cellSum : null;

  const orgSci = input.meta?.organisms?.length
    ? input.meta.organisms
    : [...new Set(approved.map((s) => s.organism_primary).filter((o): o is string => !!o))];
  const organisms = [...new Set(orgSci.map((o) => organismToCommon(o)).filter((o) => o && o !== "Unknown"))];

  // age: min/max in the unit most samples use (others converted through days)
  let age: StudyCard["age"] = null;
  const ageRows = attrRows("age").filter((r) => r.value_num != null && r.unit && TO_DAYS[r.unit]);
  if (ageRows.length) {
    const units = tally(ageRows.map((r) => r.unit!));
    const unit = units[0].value;
    const vals = ageRows.map((r) => (r.value_num! * TO_DAYS[r.unit!]) / TO_DAYS[unit]);
    const r1 = (x: number) => Math.round(x * 10) / 10;
    age = { min: r1(Math.min(...vals)), max: r1(Math.max(...vals)), unit, n: ageRows.length };
  }

  const donorRows = attrRows("donor");
  const donors = donorRows.length
    ? { n_labeled: new Set(donorRows.map((r) => lc(r.value_norm))).size, n_samples: donorRows.length }
    : null;

  const platforms = tally(approved.map((s) => platformLabel(s.protocol, s.assay_family, s.modality)).filter((p): p is string => !!p));

  const paths = new Set(input.file_paths ?? []);
  const human = approved.length > 0 && approved.every((s) => s.organism_primary === "Homo sapiens");
  const layers = LAYER_FILES.filter((l) => paths.has(l.file) && (!l.humanOnly || human)).map((l) => l.label);

  const coverage: Record<string, number> = {};
  for (const a of ["tissue", "sample_type", "cell_type_sorted", "disease", "treatment", "genotype", "timepoint", "age", "life_stage", "sex", "ancestry", "donor"] as Attr[]) {
    coverage[a] = by.get(a)?.size ?? 0;
  }
  coverage.platform = platforms.reduce((t, p) => t + p.n, 0);

  const axes: Axis[] = [];
  for (const { attr } of AXIS_ORDER) {
    const g = tally(norms(attr));
    const missing = n - (coverage[attr] ?? 0);
    const groups = missing > 0 && g.length ? [...g, { value: "not stated", n: missing }] : g;
    if (g.length >= 2 || (g.length === 1 && missing > 0)) {
      if (attr === "age" && g.length > 4) continue; // a spread of ages is a range, not groups
      axes.push({ attr, groups, hidden: Math.max(0, groups.length - 4) });
    }
  }

  const caveats: string[] = [];
  if (!coverage.tissue) caveats.push("tissue not stated");
  if (!coverage.disease && !coverage.treatment && !coverage.genotype) caveats.push("no disease, treatment or genotype fields");
  if (donors && donors.n_samples < n) caveats.push(`donor labels for ${donors.n_samples} of ${n} samples`);
  if (!donors) caveats.push("no donor labels");
  const st = tally(norms("sample_type"));
  if (st.length === 1 && st[0].value === "cell line" && st[0].n === n) caveats.push("cell line only");

  const card: StudyCard = {
    version: CARD_VERSION,
    gse_id: input.series.id,
    n_samples: n,
    n_cells: nCells,
    cells_label: cellsLabel(nCells),
    organisms,
    n_tissues: tally(norms("tissue")).length,
    tissues: tally(norms("tissue")),
    sample_types: tally(norms("sample_type")),
    cell_types: tally(norms("cell_type_sorted")),
    diseases: tally(norms("disease")),
    treatments: tally(norms("treatment")),
    genotypes: tally(norms("genotype")),
    timepoints: tally(norms("timepoint")),
    sexes: tally(norms("sex")),
    ancestries: tally(norms("ancestry")),
    life_stages: tally(norms("life_stage")),
    age,
    donors,
    platforms,
    layers,
    axes,
    coverage,
    caveats,
    summary_text: "",
    grounded: false,
    ungrounded: [],
  };
  card.summary_text = renderSummary(card);
  card.ungrounded = groundingProblems(card, input, rows);
  card.grounded = card.ungrounded.length === 0;
  return card;
}

// ── summary ────────────────────────────────────────────────────────────────

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function orgAdj(card: StudyCard): string {
  return list(card.organisms.map((o) => (/\s/.test(o) ? o : o.toLowerCase())));
}

/** "Blood" / "kidney cortex and blood" / "4 tissues (a, b, c and 1 more)"; null when no sample states a tissue. */
function tissuePhrase(card: StudyCard): string | null {
  const t = card.tissues;
  if (!t.length) return null;
  // Stated for only some samples: the tissue axis carries the counts, the opening sentence stays silent.
  if (card.coverage.tissue < card.n_samples) return null;
  if (t.length <= 3) return list(t.map((x) => shown("tissue", x.value)));
  return `${card.n_tissues} tissues (${t.slice(0, 3).map((x) => shown("tissue", x.value)).join(", ")} and others)`;
}

const TALLY_FIELD: Partial<Record<Attr, "diseases" | "treatments" | "genotypes" | "timepoints" | "sexes" | "cell_types" | "ancestries" | "sample_types">> = {
  disease: "diseases",
  treatment: "treatments",
  genotype: "genotypes",
  timepoint: "timepoints",
  sex: "sexes",
  cell_type_sorted: "cell_types",
  ancestry: "ancestries",
  sample_type: "sample_types",
};

function singleClause(attr: Attr, value: string): string {
  switch (attr) {
    case "disease": return shown(attr, value);
    case "treatment": return value === "none" ? "untreated" : `treatment: ${shown(attr, value)}`;
    case "genotype": return value === "wild type" ? "wild type" : `genotype: ${shown(attr, value)}`;
    case "timepoint": return `time point: ${shown(attr, value)}`;
    case "age": return `age ${shown(attr, value)}`;
    case "sex": return shown(attr, value);
    case "cell_type_sorted": return `cell type: ${shown(attr, value)}`;
    case "ancestry": return `reported ancestry: ${shown(attr, value)}`;
    case "sample_type": return shown(attr, value);
    default: return shown(attr, value);
  }
}

export function renderSummary(card: StudyCard): string {
  if (card.n_samples === 0) return "";
  const org = orgAdj(card);
  const single = (a: Attr): Tally[] | null => (card.axes.some((x) => x.attr === a) ? null : TALLY_FIELD[a] ? (card[TALLY_FIELD[a]!] as Tally[]) : null);

  // 1. what it is
  // The life stage is dropped when an age range follows: "aged human samples, aged 66 to 93 years" says it twice.
  const life = !card.age && card.life_stages.length === 1 && card.coverage.life_stage === card.n_samples ? card.life_stages[0].value : null;
  const who = [life, org].filter(Boolean).join(" ");
  const nd = card.donors?.n_labeled ?? 0;
  const donorUnit =
    card.donors && card.donors.n_samples === card.n_samples
      ? nd === card.n_samples
        ? `${nd} ${who} ${nd === 1 ? "donor" : "donors"}`
        : `${nd} ${who} ${nd === 1 ? "donor" : "donors"} (${card.n_samples} samples)`
      : `${card.n_samples} ${who} ${card.n_samples === 1 ? "sample" : "samples"}`;
  const cellLine = card.sample_types.length === 1 && card.sample_types[0].value === "cell line" && card.sample_types[0].n === card.n_samples;
  const tp = tissuePhrase(card);
  const unit = donorUnit.replace(/\s+/g, " ");
  let s1 = tp ? `${cap(tp)} from ${unit}` : `Data from ${unit}`;
  if (cellLine) s1 += " (cell line)";
  if (card.age) {
    const a = card.age;
    const part = card.coverage.age < card.n_samples ? ` for ${a.n} of ${card.n_samples}` : "";
    s1 += a.min === a.max ? `, aged ${a.min} ${a.unit}${part}` : `, aged ${a.min} to ${a.max} ${a.unit}${part}`;
  }
  s1 += ".";

  // 2. design: what all samples share, and what they differ in
  const shared: string[] = [];
  for (const a of ["disease", "treatment", "genotype", "timepoint", "sex", "cell_type_sorted", "ancestry"] as Attr[]) {
    const t = single(a);
    if (t && t.length === 1 && card.coverage[a] === card.n_samples) shared.push(singleClause(a, t[0].value));
  }
  const tissueListed = card.coverage.tissue === card.n_samples && card.tissues.length <= 3;
  const compared = card.axes.filter((ax) => !(ax.attr === "tissue" && tissueListed)).slice(0, 3).map((ax) => {
    const label = AXIS_ORDER.find((x) => x.attr === ax.attr)!.label;
    const groups = ax.groups.slice(0, 4).map((g) => `${shown(ax.attr, g.value)} ${g.n}`);
    return `${label} (${groups.join(", ")}${ax.hidden ? `, ${ax.hidden} more` : ""})`;
  });
  const parts2: string[] = [];
  if (shared.length) parts2.push(`All samples: ${shared.join(", ")}`);
  if (compared.length) parts2.push(`${shared.length ? "compared" : "Compared"}: ${compared.join(", ")}`);
  let s2 = parts2.length ? parts2.join("; ") + "." : "";
  if (!s2 && !card.coverage.tissue && !card.coverage.disease && !card.coverage.treatment && !card.coverage.genotype && !card.coverage.sex && !card.coverage.age) {
    s2 = "The GEO sample records carry no tissue, disease, treatment, genotype, sex or age fields.";
  }

  // 3. platform and size
  let s3 = "";
  const plat = card.platforms.length === 1 ? card.platforms[0].value : card.platforms.map((p) => `${p.value} (${p.n})`).join(", ");
  const cells = card.cells_label ? (/^\d+$/.test(card.cells_label) ? `${card.cells_label} cells` : `about ${card.cells_label} cells`) : "";
  if (plat && cells) s3 = `${plat}, ${cells}.`;
  else if (plat) s3 = `${plat}.`;
  else if (cells) s3 = `${cap(cells)}.`;

  // 4. what the file adds
  const s4 = card.layers.length ? `The file also has ${list(card.layers)}.` : "";

  const all = [s1, s2, s3, s4];
  let text = all.filter(Boolean).join(" ");
  // Over budget: drop the file sentence, then names beyond the first axis, then the second sentence's compared part.
  if (text.length > SUMMARY_MAX_CHARS) text = [s1, s2, s3].filter(Boolean).join(" ");
  if (text.length > SUMMARY_MAX_CHARS && compared.length > 1) {
    const s2b = [shared.length ? `All samples: ${shared.join(", ")}` : "", `${shared.length ? "compared" : "Compared"}: ${compared[0]}`].filter(Boolean).join("; ") + ".";
    text = [s1, s2b, s3].filter(Boolean).join(" ");
  }
  if (text.length > SUMMARY_MAX_CHARS) text = [s1, s3].filter(Boolean).join(" ");
  if (text.length > SUMMARY_MAX_CHARS) text = text.slice(0, SUMMARY_MAX_CHARS - 1).replace(/\s+\S*$/, "") + ".";
  return text;
}

// ── per-sample line ────────────────────────────────────────────────────────

/** "Kidney cortex; healthy; untreated; 36 years; female; 10x 3' v3; 4,148 cells" for one sample, facts only. */
export function sampleLine(sample: SampleInput, rows: AttrRow[]): string {
  const r = new Map<string, AttrRow>();
  for (const x of rows) if (x.gsm_id === sample.gsm_id && !r.has(x.attr)) r.set(x.attr, x);
  const v = (a: Attr) => r.get(a)?.value_norm;
  const parts: string[] = [];
  const type = v("sample_type");
  if (v("tissue")) parts.push(v("tissue")!);
  if (type === "cell line") parts.push(`cell line ${r.get("sample_type")!.value_raw}`);
  else if (type && type !== "primary tissue") parts.push(type);
  if (v("cell_type_sorted")) parts.push(v("cell_type_sorted")!);
  if (v("disease")) parts.push(v("disease")!);
  if (v("treatment")) parts.push(v("treatment") === "none" ? "untreated" : `treatment: ${v("treatment")}`);
  if (v("genotype")) parts.push(v("genotype")!);
  if (v("timepoint")) parts.push(`time point: ${v("timepoint")}`);
  if (v("age")) parts.push(`age ${v("age")}`);
  else if (v("life_stage")) parts.push(v("life_stage")!);
  if (v("sex")) parts.push(v("sex")!);
  if (v("ancestry")) parts.push(v("ancestry")!);
  if (v("donor")) parts.push(`donor ${v("donor")}`);
  const plat = platformLabel(sample.protocol, sample.assay_family, sample.modality);
  if (plat) parts.push(plat);
  if (sample.n_cells != null && sample.n_cells > 0) parts.push(`${Math.round(sample.n_cells).toLocaleString("en-US")} cells`);
  return parts.join("; ");
}

// ── grounding ──────────────────────────────────────────────────────────────

/** Every number written in the summary, after the entity names that contain digits ("10x 3' v3", "CD8") are removed. */
export function numbersOutsideEntities(text: string, card: StudyCard): number[] {
  const strings: string[] = [];
  const walk = (x: unknown, key = "") => {
    if (typeof x === "string") {
      if (key !== "summary_text" && key !== "gse_id" && key !== "version") strings.push(x);
    } else if (Array.isArray(x)) x.forEach((y) => walk(y, key));
    else if (x && typeof x === "object") for (const [k, y] of Object.entries(x)) walk(y, k);
  };
  walk(card);
  let t = text;
  // `shown` cuts values at 40 characters, so the cut form is an entity too
  const forms = strings.flatMap((s) => (s.length > 40 ? [s, s.slice(0, 37).trimEnd() + "..."] : [s]));
  for (const s of forms.filter((s) => /\d/.test(s) && s.length > 1).sort((a, b) => b.length - a.length)) t = t.split(s).join(" ");
  return [...t.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, "")));
}

function numericLeaves(card: StudyCard): Set<number> {
  const out = new Set<number>();
  const walk = (x: unknown) => {
    if (typeof x === "number") out.add(x);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") Object.values(x).forEach(walk);
  };
  walk({ ...card, summary_text: undefined });
  return out;
}

/** Reasons a card is not grounded; empty means grounded. */
export function groundingProblems(card: StudyCard, input: StudyInput, rows: AttrRow[]): string[] {
  const problems: string[] = [];
  const approved = approvedSamples(input);
  const byId = new Map(approved.map((s) => [s.gsm_id, s]));
  if (card.n_samples === 0 || !card.summary_text) return ["no approved samples"];
  if (!card.organisms.length) problems.push("organism not resolved");

  // 1. every tally entity is backed by rows of approved samples, with the same count
  const sets: [Attr, Tally[]][] = [
    ["tissue", card.tissues], ["sample_type", card.sample_types], ["cell_type_sorted", card.cell_types], ["disease", card.diseases],
    ["treatment", card.treatments], ["genotype", card.genotypes], ["timepoint", card.timepoints], ["sex", card.sexes],
    ["ancestry", card.ancestries], ["life_stage", card.life_stages],
  ];
  for (const [attr, t] of sets) {
    const counts = new Map<string, number>();
    const seen = new Set<string>();
    for (const r of rows) {
      if (r.attr !== attr || !byId.has(r.gsm_id) || seen.has(r.gsm_id)) continue;
      seen.add(r.gsm_id);
      counts.set(lc(r.value_norm), (counts.get(lc(r.value_norm)) ?? 0) + 1);
    }
    for (const x of t) if (counts.get(lc(x.value)) !== x.n) problems.push(`${attr} "${x.value}" has no matching rows`);
  }

  // 2. the rows say what the sample's own text says
  const seenEv = new Set<string>();
  for (const r of rows) {
    const s = byId.get(r.gsm_id);
    if (!s) continue;
    const k = `${r.gsm_id}|${r.attr}`;
    if (seenEv.has(k)) continue;
    seenEv.add(k);
    if (!evidenceHolds(r, { title: s.title, source: s.source, characteristics: s.characteristics_raw })) problems.push(`${r.gsm_id} ${r.attr}: evidence is not in the sample text`);
  }

  // 3. platforms and layers come from sample records and file paths
  const plat = tally(approved.map((s) => platformLabel(s.protocol, s.assay_family, s.modality)).filter((p): p is string => !!p));
  if (JSON.stringify(plat) !== JSON.stringify(card.platforms)) problems.push("platforms do not match the samples");
  const paths = new Set(input.file_paths ?? []);
  for (const l of card.layers) {
    const f = LAYER_FILES.find((x) => x.label === l);
    if (!f || !paths.has(f.file)) problems.push(`layer "${l}" has no file`);
  }

  // 4. the summary adds no number the card does not hold
  const allowed = numericLeaves(card);
  for (const num of numbersOutsideEntities(card.summary_text, card)) if (!allowed.has(num)) problems.push(`number ${num} is not in the card`);
  if (card.summary_text.length > SUMMARY_MAX_CHARS) problems.push("summary is longer than 600 characters");
  return problems;
}

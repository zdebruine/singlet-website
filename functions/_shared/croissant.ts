/**
 * MLCommons Croissant 1.1 metadata (JSON-LD, with the Responsible AI vocabulary `rai:`) for the Research Alpha atlas and for each
 * study, built from the catalog (D1) and the study manifest (data.singlet.bio/s1/m/<GSE>.json). docs/CROISSANT.md describes the
 * routes and record sets; docs/croissant/ holds rendered examples and the mlcroissant validator output.
 *
 *   GET /croissant.json, /api/croissant          the atlas: aggregate counts (the /api/stats basis), the release policy id, one
 *                                                `studies` record set (studies.csv) and a file set over every study manifest
 *   GET /api/croissant/studies.csv               one row per downloadable study, with its manifest and Croissant URLs
 *   GET /api/croissant/<GSE>                     one study: every served sample's .s1 object and label sidecar, and the record sets
 *                                                samples, cells, cell_qc, spliced_counts, unspliced_counts and features
 *   GET /api/croissant/<GSE>/<GSM>               the same for one sample, so the cells record set has a single, known sample
 *   GET /api/croissant/<GSE>/samples.csv         the samples record set: catalog metadata with ontology ids, QC and file links
 *   GET /api/croissant/features/<pack id>.csv    the genes of a reference (exon pack) and the matrix rows each one owns
 *
 * Research Alpha (./alpha): a study that is withheld, not downloadable (DOWNLOADABLE_SQL) or not in the .s1 format is not found, and
 * only samples that are part of the atlas and passed QC (sample_qc.usable = 1, qc_tier 0: the samples every headline counts) are
 * described. Cells are cells called in the files (sample_qc.n_cells_called). Every number comes from D1 or the manifest; the
 * copy below only restates numbers that are published elsewhere on the site (known issues, llms.txt).
 */
import { DOWNLOADABLE_SQL } from "./search-core";
import { ALPHA_POLICY_VERSION, sampleServedSql } from "./alpha";
import { QC_LOW_MIN_GENES, QC_LOW_MIN_MAPPING, QC_REMOVED_MAX_GENES, QC_REMOVED_MAX_MAPPING } from "./qc-rules";
import { HANCESTRO_LABELS } from "./hancestro";
import { ANCESTRY_MIN_SHARE, CELL_TYPE_MIN_CELLS, CELL_TYPE_MIN_SHARE, MIN_CELLS, SEX_MIN_SHARE } from "./s1-labels";
import type { CorpusStats } from "./stats-core";
import type { GeneRow } from "./s1-packs";
import { CORS_HEADERS } from "./cors";

export const CROISSANT_SPEC = "http://mlcommons.org/croissant/1.1";
export const SITE_ORIGIN = "https://singlet.bio";
export const RELEASE_NAME = "Singlet Research Alpha (October 2026)";
export const DATA_LICENSE = "https://creativecommons.org/publicdomain/zero/1.0/";
export const CODE_LICENSE = "https://opensource.org/licenses/MIT";
/** encodingFormat of a .s1 sample object: an unregistered format, named by its specification (Croissant 1.1: "the most appropriate URL"). */
export const S1_FORMAT_URL = "https://github.com/Singlet-Bio/singlet/blob/main/docs/format-s1.md";
export const CODE_REPOSITORY = "https://github.com/Singlet-Bio/singlet";
export const PARQUET = "application/x-parquet";

/** The Croissant 1.1 @context (mlcroissant's own, for 1.1) plus the PROV-O and OBO prefixes this document uses. */
export const CROISSANT_CONTEXT = {
  "@language": "en",
  "@vocab": "https://schema.org/",
  arrayShape: "cr:arrayShape",
  citeAs: "cr:citeAs",
  column: "cr:column",
  conformsTo: "dct:conformsTo",
  containedIn: "cr:containedIn",
  cr: "http://mlcommons.org/croissant/",
  rai: "http://mlcommons.org/croissant/RAI/",
  data: { "@id": "cr:data", "@type": "@json" },
  dataType: { "@id": "cr:dataType", "@type": "@vocab" },
  dct: "http://purl.org/dc/terms/",
  description: { "@container": "@language" },
  equivalentProperty: "cr:equivalentProperty",
  examples: { "@id": "cr:examples", "@type": "@json" },
  extract: "cr:extract",
  field: "cr:field",
  fileProperty: "cr:fileProperty",
  fileObject: "cr:fileObject",
  fileSet: "cr:fileSet",
  format: "cr:format",
  includes: "cr:includes",
  isArray: "cr:isArray",
  isLiveDataset: "cr:isLiveDataset",
  jsonPath: "cr:jsonPath",
  key: "cr:key",
  md5: "cr:md5",
  name: { "@container": "@language" },
  parentField: "cr:parentField",
  path: "cr:path",
  recordSet: "cr:recordSet",
  references: "cr:references",
  regex: "cr:regex",
  repeated: "cr:repeated",
  replace: "cr:replace",
  samplingRate: "cr:samplingRate",
  sc: "https://schema.org/",
  separator: "cr:separator",
  source: "cr:source",
  subField: "cr:subField",
  transform: "cr:transform",
  prov: "http://www.w3.org/ns/prov#",
  obo: "http://purl.obolibrary.org/obo/",
} as const;

/** The class each ontology column's values are subclasses of (checked on OLS). */
const ONTOLOGY_CLASS = {
  UBERON: "obo:UBERON_0001062", // anatomical entity
  CL: "obo:CL_0000000", // cell
  MONDO: "obo:MONDO_0000001", // disease
  PATO_SEX: "obo:PATO_0001894", // phenotypic sex
  HANCESTRO: "obo:HANCESTRO_0004", // ancestry category
  HsapDv: "obo:HsapDv_0000000", // life cycle stage
  MmusDv: "obo:MmusDv_0000000", // life cycle stage
} as const;

/** NCBI Taxonomy ids of the organisms the catalog normalises to (gsm.organism_primary); anything else is left without an id. */
const NCBI_TAXON: Record<string, string> = {
  "Homo sapiens": "NCBITaxon:9606",
  "Mus musculus": "NCBITaxon:10090",
  "Rattus norvegicus": "NCBITaxon:10116",
  "Macaca mulatta": "NCBITaxon:9544",
  "Danio rerio": "NCBITaxon:7955",
};

export const geoUrl = (acc: string) => `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${acc}`;

// ── URLs ────────────────────────────────────────────────────────────────────

/** Where the documents point. Production uses the defaults; the example renderer (scripts/croissant) points the function CSVs at local files. */
export interface CroissantUrls {
  site: string;
  data: string;
  atlas: string;
  studiesCsv: string;
  study: (gse: string) => string;
  sample: (gse: string, gsm: string) => string;
  samplesCsv: (gse: string) => string;
  featuresCsv: (packId: string) => string;
}

export function croissantUrls(site = SITE_ORIGIN, data = "https://data.singlet.bio"): CroissantUrls {
  return {
    site,
    data,
    atlas: `${site}/croissant.json`,
    studiesCsv: `${site}/api/croissant/studies.csv`,
    study: (gse) => `${site}/api/croissant/${gse}`,
    sample: (gse, gsm) => `${site}/api/croissant/${gse}/${gsm}`,
    samplesCsv: (gse) => `${site}/api/croissant/${gse}/samples.csv`,
    featuresCsv: (id) => `${site}/api/croissant/features/${id}.csv`,
  };
}

// ── release policy ──────────────────────────────────────────────────────────

export interface ReleasePolicy {
  version: string;
  /** When the last list of that version was loaded (alpha_withheld / alpha_exclusions.added_at). */
  loaded_at: string | null;
}

let policyMemo: { at: number; value: ReleasePolicy } | null = null;

/**
 * The Research Alpha release-policy id in force: the newest policy_version loaded into alpha_withheld / alpha_exclusions (the
 * loader stamps every row it writes with the policy file's `version`, e.g. alpha-2026-10-27e; ids sort by date and letter). Reads
 * all of alpha_withheld (about 1.4k rows) and the last row written to alpha_exclusions, memoised per isolate for ten minutes.
 */
export async function currentReleasePolicy(db: D1Database, now = Date.now()): Promise<ReleasePolicy> {
  if (policyMemo && now - policyMemo.at < 600_000) return policyMemo.value;
  const row = await db
    .prepare(
      `SELECT policy_version AS version, added_at FROM (
         SELECT policy_version, added_at FROM alpha_withheld
         UNION ALL
         SELECT policy_version, added_at FROM alpha_exclusions WHERE rowid = (SELECT MAX(rowid) FROM alpha_exclusions)
       ) ORDER BY policy_version DESC, added_at DESC LIMIT 1`
    )
    .first<{ version: string | null; added_at: string | null }>()
    .catch(() => null);
  const value: ReleasePolicy = row?.version ? { version: row.version, loaded_at: row.added_at ?? null } : { version: ALPHA_POLICY_VERSION, loaded_at: null };
  policyMemo = { at: now, value };
  return value;
}

/** Test hook. */
export function clearCroissantMemo(): void {
  policyMemo = null;
}

// ── manifest ────────────────────────────────────────────────────────────────

/** The parts of a study manifest (docs/format-s1.md section 7) the documents read. */
export interface ManifestMember {
  kind?: number;
  off?: number;
  len?: number;
  m?: number;
  n?: number;
  nnz?: number;
  codec?: number;
  chunk_cols?: number;
  n_chunks?: number;
  columns?: string[];
  n_rows?: number;
  names?: { rows?: unknown; cols?: unknown };
  labels?: { model_version?: string };
}

export interface ManifestAnnotation {
  key?: string;
  sha256?: string;
  bytes?: number;
  n_rows?: number;
  model_version?: string;
  cell_type?: {
    method?: string;
    default_levels?: number[];
    preview_from_level?: number;
    level_names?: Record<string, string>;
    per_study_accuracy?: Record<string, number>;
  };
}

export interface ManifestSample {
  gsm: string;
  key: string;
  bytes?: number;
  sha256?: string;
  n_columns?: number;
  n_called?: number;
  members?: Record<string, ManifestMember>;
  annotations?: Record<string, ManifestAnnotation>;
  stats?: { median_umi?: number | null; median_genes?: number | null };
}

export interface StudyManifest {
  format?: string;
  gse?: string;
  rev?: string;
  created_at?: string;
  reference_build?: string;
  pipeline?: { git_sha?: string; singlet_version?: string };
  packs?: { exon?: string | null; intron?: string | null; whitelist?: string | null; junctions?: string | null };
  samples?: ManifestSample[];
  annotations_default?: string;
}

/** Fetches a study manifest; null when it does not exist. */
export type ManifestFetcher = (gse: string) => Promise<StudyManifest | null>;

// ── study input ─────────────────────────────────────────────────────────────

export interface OntologyValue {
  id: string;
  label: string | null;
  /** "geo" (mapped from GEO's text by rules) or "model" (mapped by a model); "pipeline" for the labeller's calls. */
  source: string;
}

/** sample_term attributes, in column order: the column stem and the ontology class of its values. */
export const TERM_ATTRS = [
  { attr: "tissue", stem: "tissue", what: "Tissue (UBERON)", cls: [ONTOLOGY_CLASS.UBERON] },
  { attr: "disease", stem: "disease", what: "Disease (MONDO; healthy / normal is PATO:0000461)", cls: [ONTOLOGY_CLASS.MONDO] },
  { attr: "development_stage", stem: "development_stage", what: "Developmental stage (HsapDv for human, MmusDv for mouse)", cls: [ONTOLOGY_CLASS.HsapDv, ONTOLOGY_CLASS.MmusDv] },
  { attr: "sex", stem: "sex", what: "Sex as recorded in GEO (PATO)", cls: [ONTOLOGY_CLASS.PATO_SEX] },
  { attr: "ancestry", stem: "self_reported_ancestry", what: "Ancestry as recorded in GEO (HANCESTRO)", cls: [ONTOLOGY_CLASS.HANCESTRO] },
  { attr: "cell_type", stem: "sorted_cell_type", what: "Cell type the sample was sorted or enriched for, as recorded in GEO (Cell Ontology)", cls: [ONTOLOGY_CLASS.CL] },
  { attr: "cell_line", stem: "cell_line", what: "Cell line the GEO cell line field names (Cellosaurus accession, CVCL_xxxx; exact identifier or synonym of the sample's species only)", cls: [] },
] as const;
export type TermAttr = (typeof TERM_ATTRS)[number]["attr"];

export interface SampleInput {
  gsm: string;
  title: string | null;
  organism: string | null;
  srr_ids: string[];
  protocol: string | null;
  assay_family: string | null;
  reference_build: string | null;
  singlet_version: string | null;
  n_input_reads: number | null;
  mapping_rate: number | null;
  median_umi: number | null;
  median_genes: number | null;
  n_cells_called: number | null;
  terms: Partial<Record<TermAttr, OntologyValue[]>>;
  sex_genetic: OntologyValue[];
  ancestry_genetic: OntologyValue[];
  cell_types_called: OntologyValue[];
  /** Structured sample facts (sample_property, ./sample-type): tissue_type, tumor_sample_type, sample_kind, donor_status. */
  props: Partial<Record<SampleProp, string>>;
  /** The manifest's entry for the sample. */
  object: ManifestSample;
  /** The default label sidecar (manifest annotations[annotations_default]), when the sample has one. */
  sidecar: ManifestAnnotation | null;
}

export interface Publication {
  pmid: string;
  title: string | null;
  doi: string | null;
  year: number | null;
  journal: string | null;
}

export interface StudyInput {
  gse: string;
  title: string | null;
  abstract: string | null;
  submitted_date: string | null;
  organism: string | null;
  /** Samples GEO lists for the study, excluded samples left out (gse_meta.n_total). */
  n_geo_samples: number | null;
  publications: Publication[];
  s1: { rev: string; created_at: string | null; updated_at: string | null; reference_build: string | null; bytes: number | null };
  manifest: StudyManifest;
  samples: SampleInput[];
  policy: ReleasePolicy;
  /** Ontology releases the term labels were read from (ontology_term.release), by ontology. */
  ontology_releases: Record<string, string>;
}

// ── loading a study ─────────────────────────────────────────────────────────

const GSE_RE = /^GSE\d+$/;

interface StudyRow {
  gse_id: string;
  title: string | null;
  abstract: string | null;
  submitted_date: string | null;
  organism_primary: string | null;
  n_total: number | null;
  pubmed_ids: string | null;
  rev: string;
  created_at: string | null;
  updated_at: string | null;
  reference_build: string | null;
  bytes: number | null;
}

interface SampleRow {
  gsm_id: string;
  title: string | null;
  organism_primary: string | null;
  srr_ids: string | null;
  assay_family: string | null;
  protocol: string | null;
  reference_build: string | null;
  singlet_version: string | null;
  n_input_reads: number | null;
  mapping_rate: number | null;
  median_umi: number | null;
  median_genes: number | null;
  n_cells_called: number | null;
}

/** The served, QC-passed samples of a study (the samples gse_meta.n_usable_samples counts), with their QC and provenance. */
export const STUDY_SAMPLES_SQL = `SELECT q.gsm_id, g.title, g.organism_primary, g.srr_ids, g.assay_family, q.protocol, q.reference_build, q.singlet_version,
       q.n_input_reads, q.mapping_rate, q.median_umi, q.median_genes, q.n_cells_called
  FROM sample_qc q LEFT JOIN gsm g ON g.gsm_id = q.gsm_id
 WHERE q.gse_id = ?1 AND q.usable = 1 AND COALESCE(q.qc_tier, 0) = 0 AND ${sampleServedSql("q.gsm_id")}
 ORDER BY q.gsm_id`;

const SERVED_GSMS = `SELECT q.gsm_id FROM sample_qc q WHERE q.gse_id = ?1 AND q.usable = 1 AND COALESCE(q.qc_tier, 0) = 0 AND ${sampleServedSql("q.gsm_id")}`;

/** Ontology terms of those samples (sample_term, by its gsm index), with labels from ontology_term or the labeller's vocabulary. */
export const STUDY_TERMS_SQL = `SELECT t.gsm_id, t.attr, t.term_id, t.source, t.confidence,
       COALESCE((SELECT o.label FROM ontology_term o WHERE o.term_id = t.term_id), (SELECT l.label FROM label_term l WHERE l.term_id = t.term_id)) AS label
  FROM sample_term t
 WHERE t.gsm_id IN (${SERVED_GSMS})
 ORDER BY t.gsm_id, t.attr, t.confidence DESC, t.term_id`;

export const SAMPLE_PROPS = ["tissue_type", "tumor_sample_type", "sample_kind", "donor_status"] as const;
export type SampleProp = (typeof SAMPLE_PROPS)[number];

/** Structured sample facts from the sample's own GEO fields (sample_property). */
export const STUDY_PROPS_SQL = `SELECT p.gsm_id, p.property, p.value FROM sample_property p
 WHERE p.gse_id = ?1 AND p.property IN (${SAMPLE_PROPS.map((x) => `'${x}'`).join(", ")}) ORDER BY p.gsm_id, p.property`;

/** The labeller's per-sample facts (sample_attr, source 'pipeline'): chromosomal sex, genetic ancestry, cell types present. */
export const STUDY_LABELS_SQL = `SELECT a.gsm_id, a.attr, a.value_norm, a.ontology_id
  FROM sample_attr a
 WHERE a.gse_id = ?1 AND a.attr IN ('sex_genetic', 'ancestry_genetic', 'cell_type') AND a.source = 'pipeline'
 ORDER BY a.gsm_id, a.attr, a.value_norm`;

/** A downloadable study served in the .s1 format, or nothing. */
export const STUDY_SQL = `SELECT m.gse_id, g.title, g.abstract, g.submitted_date, m.organism_primary, m.n_total, g.pubmed_ids,
       s.rev, s.created_at, s.updated_at, s.reference_build, s.bytes
  FROM gse_meta m
  JOIN gse g ON g.id = m.gse_id
  JOIN s1_study s ON s.gse_id = m.gse_id
  JOIN s1_migration vm ON vm.gse_id = m.gse_id AND vm.status IN ('verified', 'retired')
 WHERE m.gse_id = ?1 AND ${DOWNLOADABLE_SQL}`;

function jsonList(v: string | null | undefined): string[] {
  if (!v) return [];
  try {
    const x = JSON.parse(v);
    return Array.isArray(x) ? x.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Everything one study's documents need, or null when the study is not part of the atlas (withheld, not downloadable, not .s1, no
 * manifest). Five indexed D1 reads and one manifest fetch. Samples are in manifest order; a served sample the manifest does not
 * list (a sample whose QC row belongs to this study while its object is in another study's manifest) is left out.
 */
export async function loadStudyInput(db: D1Database, rawGse: string, fetchManifest: ManifestFetcher): Promise<StudyInput | null> {
  const gse = rawGse.trim().toUpperCase();
  if (!GSE_RE.test(gse)) return null;
  const study = await db.prepare(STUDY_SQL).bind(gse).first<StudyRow>();
  if (!study) return null;
  const [manifest, samples, terms, labels, props, pubs, policy, releases] = await Promise.all([
    fetchManifest(gse),
    db.prepare(STUDY_SAMPLES_SQL).bind(gse).all<SampleRow>(),
    db.prepare(STUDY_TERMS_SQL).bind(gse).all<{ gsm_id: string; attr: string; term_id: string; source: string; confidence: number; label: string | null }>(),
    db.prepare(STUDY_LABELS_SQL).bind(gse).all<{ gsm_id: string; attr: string; value_norm: string; ontology_id: string | null }>(),
    db
      .prepare(STUDY_PROPS_SQL)
      .bind(gse)
      .all<{ gsm_id: string; property: string; value: string }>()
      .catch(() => ({ results: [] as { gsm_id: string; property: string; value: string }[] })),
    db
      .prepare(
        `SELECT p.pmid, p.title, p.doi, p.year, p.journal FROM gse_publication gp JOIN publications p ON p.pmid = gp.pmid WHERE gp.gse_id = ?1 ORDER BY p.pmid`
      )
      .bind(gse)
      .all<Publication>()
      .catch(() => ({ results: [] as Publication[] })),
    currentReleasePolicy(db),
    db
      .prepare(`SELECT ontology, MAX(release) AS release FROM ontology_term WHERE release IS NOT NULL AND release != '' GROUP BY ontology`)
      .all<{ ontology: string; release: string }>()
      .catch(() => ({ results: [] as { ontology: string; release: string }[] })),
  ]);
  if (!manifest || !Array.isArray(manifest.samples)) return null;

  const propsBy = new Map<string, Partial<Record<SampleProp, string>>>();
  for (const p of props.results ?? []) {
    const m = propsBy.get(p.gsm_id) ?? {};
    m[p.property as SampleProp] = p.value;
    propsBy.set(p.gsm_id, m);
  }
  const termsBy = new Map<string, Partial<Record<TermAttr, OntologyValue[]>>>();
  const known = new Set<string>(TERM_ATTRS.map((t) => t.attr));
  for (const t of terms.results ?? []) {
    if (!known.has(t.attr)) continue;
    const m = termsBy.get(t.gsm_id) ?? {};
    const list = (m[t.attr as TermAttr] ??= []);
    list.push({ id: t.term_id, label: t.label ?? null, source: t.source });
    termsBy.set(t.gsm_id, m);
  }
  const labelsBy = new Map<string, { sex_genetic: OntologyValue[]; ancestry_genetic: OntologyValue[]; cell_type: OntologyValue[] }>();
  for (const l of labels.results ?? []) {
    const m = labelsBy.get(l.gsm_id) ?? { sex_genetic: [], ancestry_genetic: [], cell_type: [] };
    const key = l.attr as "sex_genetic" | "ancestry_genetic" | "cell_type";
    if (!m[key]) continue;
    m[key].push({ id: l.ontology_id ?? "", label: l.value_norm || null, source: "pipeline" });
    labelsBy.set(l.gsm_id, m);
  }
  const rows = new Map((samples.results ?? []).map((r) => [r.gsm_id, r]));
  const annot = manifest.annotations_default ?? "";
  const out: SampleInput[] = [];
  for (const obj of manifest.samples) {
    const r = obj && rows.get(obj.gsm);
    if (!r) continue;
    const lab = labelsBy.get(r.gsm_id);
    const side = (annot && obj.annotations?.[annot]) || null;
    out.push({
      gsm: r.gsm_id,
      title: r.title,
      organism: r.organism_primary,
      srr_ids: jsonList(r.srr_ids),
      protocol: r.protocol,
      assay_family: r.assay_family,
      reference_build: r.reference_build ?? manifest.reference_build ?? null,
      singlet_version: r.singlet_version,
      n_input_reads: r.n_input_reads,
      mapping_rate: r.mapping_rate,
      // the file is the truth: its own statistics first, the catalog's QC row otherwise
      median_umi: obj.stats?.median_umi ?? r.median_umi,
      median_genes: obj.stats?.median_genes ?? r.median_genes,
      n_cells_called: r.n_cells_called,
      terms: termsBy.get(r.gsm_id) ?? {},
      sex_genetic: lab?.sex_genetic ?? [],
      ancestry_genetic: lab?.ancestry_genetic ?? [],
      cell_types_called: lab?.cell_type ?? [],
      props: propsBy.get(r.gsm_id) ?? {},
      object: obj,
      sidecar: side && side.key ? side : null,
    });
  }
  if (!out.length) return null;

  const pubmed = new Set(jsonList(study.pubmed_ids));
  const publications = (pubs.results ?? []).filter((p) => p.pmid);
  for (const p of publications) pubmed.delete(p.pmid);
  for (const pmid of pubmed) publications.push({ pmid, title: null, doi: null, year: null, journal: null });

  const ontology_releases: Record<string, string> = {};
  for (const r of releases.results ?? []) ontology_releases[r.ontology] = r.release;

  return {
    gse,
    title: study.title,
    abstract: study.abstract,
    submitted_date: study.submitted_date,
    organism: study.organism_primary,
    n_geo_samples: study.n_total,
    publications,
    s1: { rev: study.rev, created_at: study.created_at, updated_at: study.updated_at, reference_build: study.reference_build, bytes: study.bytes },
    manifest,
    samples: out,
    policy,
    ontology_releases,
  };
}

/** The input restricted to one sample (the per-sample document), or null when the study does not serve it. */
export function oneSample(input: StudyInput, rawGsm: string): StudyInput | null {
  const gsm = rawGsm.trim().toUpperCase();
  const s = input.samples.find((x) => x.gsm === gsm);
  return s ? { ...input, samples: [s] } : null;
}

// ── CSV ─────────────────────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: unknown[][]): string {
  return [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n";
}

const MULTI = "|";
const ids = (vs: OntologyValue[] | undefined) => (vs ?? []).map((v) => v.id).filter(Boolean).join(MULTI);
const labelsOf = (vs: OntologyValue[] | undefined) => (vs ?? []).map((v) => v.label ?? "").join(MULTI);
const sources = (vs: OntologyValue[] | undefined) => (vs ?? []).map((v) => v.source).join(MULTI);

type ColumnType = "sc:Text" | "sc:Integer" | "sc:Float" | "sc:URL" | "sc:Boolean";

/** One column of a function-served CSV: its record-set field and how a row fills it. */
interface Column<R> {
  name: string;
  type: ColumnType;
  /** Extra dataType entries (ontology classes). */
  cls?: readonly string[];
  equivalent?: string;
  description: string;
  value: (row: R) => unknown;
}

interface SampleRowCtx {
  gse: string;
  s: SampleInput;
  urls: CroissantUrls;
}

function termColumns(): Column<SampleRowCtx>[] {
  const out: Column<SampleRowCtx>[] = [];
  for (const t of TERM_ATTRS) {
    out.push(
      { name: `${t.stem}_ontology_term_id`, type: "sc:Text", cls: t.cls, description: `${t.what}: term ids, "|"-separated when GEO lists several.`, value: (r) => ids(r.s.terms[t.attr]) },
      { name: t.stem, type: "sc:Text", description: `Labels of ${t.stem}_ontology_term_id, in the same order.`, value: (r) => labelsOf(r.s.terms[t.attr]) },
      {
        name: `${t.stem}_mapping`,
        type: "sc:Text",
        description: `How each ${t.stem} term was mapped from GEO's text: "geo" by rules, "model" by a model.`,
        value: (r) => sources(r.s.terms[t.attr]),
      }
    );
  }
  return out;
}

/** The samples record set and samples.csv, one definition for both. */
export const SAMPLE_COLUMNS: Column<SampleRowCtx>[] = [
  { name: "gsm_id", type: "sc:Text", description: "GEO sample accession (the record key).", value: (r) => r.s.gsm },
  { name: "gse_id", type: "sc:Text", description: "GEO series accession.", value: (r) => r.gse },
  { name: "title", type: "sc:Text", description: "Sample title in GEO.", value: (r) => r.s.title },
  { name: "geo_url", type: "sc:URL", description: "The sample's GEO record.", value: (r) => geoUrl(r.s.gsm) },
  { name: "organism", type: "sc:Text", description: "Organism (normalised from GEO).", value: (r) => r.s.organism },
  { name: "organism_ontology_term_id", type: "sc:Text", description: "NCBI Taxonomy id of the organism.", value: (r) => (r.s.organism ? NCBI_TAXON[r.s.organism] ?? "" : "") },
  { name: "assay", type: "sc:Text", description: "Library protocol detected from the reads (e.g. 10xv2, 10xv3).", value: (r) => r.s.protocol },
  { name: "assay_family", type: "sc:Text", description: "Assay family in the catalog.", value: (r) => r.s.assay_family },
  { name: "reference_build", type: "sc:Text", description: "Genome build and annotation the reads were aligned to.", value: (r) => r.s.reference_build },
  { name: "pipeline_version", type: "sc:Text", description: "singlet pipeline version that produced the counts (sample_qc).", value: (r) => r.s.singlet_version },
  { name: "sra_runs", type: "sc:Text", description: 'SRA runs of the sample, "|"-separated (Alpha used the first run).', value: (r) => r.s.srr_ids.join(MULTI) },
  { name: "n_input_reads", type: "sc:Integer", description: "Reads the pipeline used (at most 30 million).", value: (r) => r.s.n_input_reads },
  { name: "mapping_rate", type: "sc:Float", description: "Fraction of reads mapped.", value: (r) => r.s.mapping_rate },
  { name: "median_umi", type: "sc:Float", description: "Median UMIs per called cell (the file's own statistic).", value: (r) => r.s.median_umi },
  { name: "median_genes", type: "sc:Float", description: "Median genes per called cell (the file's own statistic).", value: (r) => r.s.median_genes },
  { name: "n_cells_called", type: "sc:Integer", description: "Cells called in the file (sample_qc.n_cells_called, the basis of every cell count on singlet.bio).", value: (r) => r.s.n_cells_called },
  ...termColumns(),
  { name: "tissue_type", type: "sc:Text", description: 'CELLxGENE schema 7.0.0 tissue_type from the sample’s own GEO fields: "tissue" (xenografts included), "organoid", "primary cell culture" or "cell line" (stem-cell-derived cultures included); empty when GEO does not say.', value: (r) => r.s.props?.tissue_type ?? "" },
  { name: "tumor_sample_type", type: "sc:Text", description: 'GDC sample_type vocabulary, when the sample’s GEO fields say so: "tumor", "primary tumor", "metastatic", "recurrent tumor" or "adjacent normal" (Solid Tissue Normal).', value: (r) => r.s.props?.tumor_sample_type ?? "" },
  { name: "sample_kind", type: "sc:Text", description: 'Coarse kind: "primary", "cell_line", "stem_cell", "organoid" or "xenograft".', value: (r) => r.s.props?.sample_kind ?? "" },
  { name: "donor_status", type: "sc:Text", description: '"healthy" (disease PATO:0000461 from explicit text) or "diseased" (a MONDO disease term); empty when not recorded.', value: (r) => r.s.props?.donor_status ?? "" },
  {
    name: "sex_genetic_ontology_term_id",
    type: "sc:Text",
    cls: [ONTOLOGY_CLASS.PATO_SEX],
    description: `Chromosomal sex held by at least ${SEX_MIN_SHARE * 100}% of the sample's sexed cells (at least ${MIN_CELLS} sexed): PATO:0000383 female, PATO:0000384 male; "|"-separated for a pool of both.`,
    value: (r) => ids(r.s.sex_genetic),
  },
  { name: "sex_genetic", type: "sc:Text", description: "Labels of sex_genetic_ontology_term_id.", value: (r) => labelsOf(r.s.sex_genetic) },
  {
    name: "ancestry_genetic_ontology_term_id",
    type: "sc:Text",
    cls: [ONTOLOGY_CLASS.HANCESTRO],
    description: `Continental genetic ancestry (HANCESTRO) held by at least ${ANCESTRY_MIN_SHARE * 100}% of the sample's cells with an ancestry call; human donors with enough covered sites only.`,
    value: (r) => ids(r.s.ancestry_genetic),
  },
  { name: "ancestry_genetic", type: "sc:Text", description: "Labels of ancestry_genetic_ontology_term_id.", value: (r) => labelsOf(r.s.ancestry_genetic) },
  {
    name: "cell_types_ontology_term_ids",
    type: "sc:Text",
    cls: [ONTOLOGY_CLASS.CL],
    description: `Cell Ontology types (with their ancestors in the labeller's vocabulary) held by at least ${CELL_TYPE_MIN_SHARE * 100}% and ${CELL_TYPE_MIN_CELLS} of the sample's typed cells, "|"-separated.`,
    value: (r) => ids(r.s.cell_types_called),
  },
  { name: "s1_url", type: "sc:URL", description: "The sample's .s1 object (immutable; HTTP Range supported).", value: (r) => `${r.urls.data}/${r.s.object.key}` },
  { name: "s1_bytes", type: "sc:Integer", description: "Size of the .s1 object.", value: (r) => r.s.object.bytes },
  { name: "s1_sha256", type: "sc:Text", description: "SHA-256 of the .s1 object.", value: (r) => r.s.object.sha256 },
  { name: "labels_url", type: "sc:URL", description: "The sample's per-cell label sidecar (Parquet).", value: (r) => (r.s.sidecar?.key ? `${r.urls.data}/${r.s.sidecar.key}` : "") },
  { name: "labels_sha256", type: "sc:Text", description: "SHA-256 of the label sidecar.", value: (r) => r.s.sidecar?.sha256 },
  { name: "croissant_url", type: "sc:URL", description: "Croissant metadata for this sample alone.", value: (r) => r.urls.sample(r.gse, r.s.gsm) },
];

export function samplesCsv(input: StudyInput, urls: CroissantUrls = croissantUrls()): string {
  return toCsv(
    SAMPLE_COLUMNS.map((c) => c.name),
    input.samples.map((s) => SAMPLE_COLUMNS.map((c) => c.value({ gse: input.gse, s, urls })))
  );
}

export const FEATURE_COLUMNS: Column<{ g: GeneRow; build: string }>[] = [
  { name: "gene_id", type: "sc:Text", description: "Ensembl gene id (the record key).", value: (r) => r.g.gene_id },
  { name: "gene_symbol", type: "sc:Text", description: "Gene symbol (empty when the annotation has none).", value: (r) => r.g.symbol },
  { name: "reference_build", type: "sc:Text", description: "Genome build and annotation.", value: (r) => r.build },
  { name: "chromosome", type: "sc:Text", description: "Chromosome.", value: (r) => r.g.chromosome },
  { name: "start", type: "sc:Integer", description: "Start of the gene's first exon, as in the feature names.", value: (r) => r.g.start },
  { name: "end", type: "sc:Integer", description: "End of the gene's last exon, as in the feature names.", value: (r) => r.g.end },
  { name: "n_exons", type: "sc:Integer", description: "Merged exons of the gene (rows of the spliced matrix).", value: (r) => r.g.n_exons },
  { name: "exon_row_first", type: "sc:Integer", description: "First row of the gene in exon_counts.1pz (spliced).", value: (r) => r.g.exon_row_first },
  { name: "exon_row_last", type: "sc:Integer", description: "Last row of the gene in exon_counts.1pz (inclusive).", value: (r) => r.g.exon_row_last },
  { name: "intron_row_first", type: "sc:Integer", description: "First row of the gene in intron_counts.1pz (unspliced); -1 for a single-exon gene.", value: (r) => r.g.intron_row_first },
  { name: "intron_row_last", type: "sc:Integer", description: "Last row of the gene in intron_counts.1pz (inclusive); -1 for a single-exon gene.", value: (r) => r.g.intron_row_last },
];

export function featuresCsv(build: string, genes: GeneRow[]): string {
  return toCsv(
    FEATURE_COLUMNS.map((c) => c.name),
    genes.map((g) => FEATURE_COLUMNS.map((c) => c.value({ g, build })))
  );
}

// ── JSON-LD helpers ─────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

function csvRecordSet<R>(id: string, description: string, fileId: string, key: string, cols: Column<R>[]): Json {
  return {
    "@type": "cr:RecordSet",
    "@id": id,
    name: id,
    description,
    key: { "@id": `${id}/${key}` },
    field: cols.map((c) => ({
      "@type": "cr:Field",
      "@id": `${id}/${c.name}`,
      name: c.name,
      description: c.description,
      dataType: c.cls ? [c.type, ...c.cls] : c.type,
      ...(c.equivalent ? { equivalentProperty: c.equivalent } : {}),
      source: { fileObject: { "@id": fileId }, extract: { column: c.name } },
    })),
  };
}

function field(rs: string, name: string, dataType: string | string[], description: string, source: Json): Json {
  return { "@type": "cr:Field", "@id": `${rs}/${name}`, name, description, dataType, source };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmt = (n: number) => n.toLocaleString("en-US");

function annotateVersion(model: string | undefined, part: string): string | null {
  const m = (model ?? "").split(";").find((p) => p.startsWith(`${part}=`));
  return m ? m.slice(part.length + 1) : null;
}

// ── RAI text shared by every document ───────────────────────────────────────

/** The published accuracy (llms.txt, /known-issues, python/singlet/s1/labels.py), rounded as there. */
export const PUBLISHED_ACCURACY = { compartment: 0.84, lineage: 0.75, cell_type: 0.43, subtype: 0.32 } as const;

const QC_TEXT =
  `Sample QC (functions/_shared/qc-rules.ts): a sample is described here only when its count matrix is not empty, at least one cell was called, ` +
  `at least ${Math.round(QC_LOW_MIN_MAPPING * 100)}% of reads mapped and the median cell has at least ${QC_LOW_MIN_GENES} genes. Samples below that are flagged ` +
  `low QC (kept in the study's files, left out of these documents and of every count); samples with under ${Math.round(QC_REMOVED_MAX_MAPPING * 100)}% of reads ` +
  `mapped and a median under ${QC_REMOVED_MAX_GENES} genes are removed.`;

function policyText(policy: ReleasePolicy): string {
  return (
    `Research Alpha release policy ${policy.version}: samples whose reads do not match the expected strand, libraries that are not gene ` +
    `expression (antibody, hashtag, guide, V(D)J or chromatin), samples with no called cell, and studies aligned to a genome other than ` +
    `the species GEO records are left out; a study left with no sample is withheld.`
  );
}

const PREPROCESSING = [
  "One pipeline (singlet) for every sample: raw reads from SRA (the first sequencing run of each sample, at most its first 30 million reads); barcode and UMI layout detected from the reads; alignment and counting with STARsolo against one reference per species (human GRCh38, GENCODE v44; mouse GRCm39, vM33; rat mRatBN7.2; macaque Mmul_10; zebrafish GRCz11).",
  "Exonic (spliced) and intronic (unspliced) molecules are counted separately for every cell, with splice junctions. In Alpha a molecule touching both an exon and an intron, a molecule in nested genes, or a multi-mapping read split across workers can be counted twice (2% to 19% per cell).",
  "Cells were called with the STARsolo CellRanger2.2 knee filter; every barcode with at least 100 reads is stored, so cells can be called again. The cells table also carries an EmptyDrops call (called_ed) that is not the default.",
  QC_TEXT,
  "Files were transcoded to the .s1 format (one immutable object per sample, pz2-coded matrices) and verified member by member against the files they replace.",
];

const ANNOTATION_PROTOCOL = [
  "Per-cell labels are computed by the pipeline, with no human annotator: Cell Ontology cell type by a hierarchical, marker-guided labeller (levels: 1 compartment, 2 lineage, 3 cell type, 4 and deeper subtype; levels 1 and 2 are the default, 3 and deeper are previews); chromosomal sex from XIST against chrY expression (human and mouse); continental genetic ancestry (HANCESTRO) by supervised admixture against 1000 Genomes reference panels, for human donors with enough covered sites.",
  "Sample metadata are GEO's text, mapped to UBERON (tissue), MONDO (disease; healthy is PATO:0000461), HsapDv / MmusDv (developmental stage), PATO (sex), HANCESTRO (self-reported ancestry) and Cell Ontology (sorted cell type), by rules or by a model; each *_mapping column of the samples record set says which.",
];

const ANNOTATION_ANALYSIS = [
  `Cell type, per-study accuracy against CELLxGENE author labels: compartment ${PUBLISHED_ACCURACY.compartment}, lineage ${PUBLISHED_ACCURACY.lineage}, cell type ${PUBLISHED_ACCURACY.cell_type}, subtype ${PUBLISHED_ACCURACY.subtype}. The score ranks calls; it is not a calibrated probability.`,
  "Chromosomal sex: 153 of 156 called samples (98.1%) agree with the sex in GEO; the 3 disagreements were GEO errors. About 13% of human cells stay ambiguous.",
  "Genetic ancestry: validated on donors simulated from 1000 Genomes and on 22 donors with self-reported ancestry.",
  "Measurements: https://singlet.bio/benchmarking#alpha-annotations",
];

const LIMITATIONS = [
  "Alpha used only the first sequencing run of each sample and at most 30 million reads (the median sample used 10% of its deposited reads). Against the authors' own Cell Ranger results on 135 samples, Alpha finds a median of 65% of their cells, with a quarter of their UMIs per cell.",
  "Some molecules are counted twice (2% to 19% per cell); counts depend slightly on the thread count; the spliced and unspliced layers are not suited to RNA velocity.",
  `Cell type labels: per-study accuracy compartment ${PUBLISHED_ACCURACY.compartment}, lineage ${PUBLISHED_ACCURACY.lineage}, cell type ${PUBLISHED_ACCURACY.cell_type}, subtype ${PUBLISHED_ACCURACY.subtype}; levels 3 and deeper are previews.`,
  "Chromosomal sex agrees with GEO for 98.1% of samples; about 13% of human cells stay ambiguous, mostly in pools of both sexes or samples with few reads per cell.",
  "Genetic ancestry is computed only for human donors with enough genotype coverage (under 1,000 samples, about 1% of cells); elsewhere it is missing. Mixed ancestry is reported as admixed.",
  "Transcriptomics only: antibody tags (ADT), hashtags (HTO), ATAC, spatial coordinates, CRISPR guides and V(D)J clonotypes are not served. Doublet, ambient-RNA and mitochondrial allele layers are not in Alpha.",
  "GEO metadata (sex, tissue, disease) is not curated and may be wrong. A cell or sample count in the catalog can differ from the QC inside a file; the file is the truth. A sample GEO lists under two series is in both studies, so atlas-wide totals count it twice.",
  "Known issues and what Beta changes: https://singlet.bio/known-issues",
];

const SENSITIVE = [
  "All studies are public GEO deposits whose raw reads are public in SRA; no new human data was collected.",
  "Genotypes, mitochondrial allele data and the raw genotype inputs of the labeller are never stored in the released files or served. Per cell, only chromosomal sex (female / male / ambiguous) and continental genetic ancestry (HANCESTRO group) are released.",
  "GEO sample characteristics (which may include age, sex, ancestry, disease and donor ids chosen by the depositors) are kept as GEO publishes them.",
];

const USE_CASES = [
  "Training and evaluating models of single-cell gene expression (cell-type classifiers, representation and foundation models) on uniformly processed counts.",
  "Cross-study meta-analysis and cohort building by organism, tissue, disease, cell type, sex or ancestry.",
  "Benchmarking analysis methods on many studies processed the same way; re-calling cells from the stored barcodes.",
  "Not validated for clinical use or for identifying individuals.",
];

const SOCIAL_IMPACT =
  "Uniform reprocessing makes public single-cell studies comparable and reusable without running a pipeline per study. Models trained on it inherit its skew toward human and mouse, toward the tissues and assays most often deposited, and toward the donors with ancestry calls; the dataBiases field gives the numbers.";

function maintenance(policy: ReleasePolicy): string[] {
  return [
    "Per-sample .s1 objects and label sidecars are immutable and content-addressed (the key contains the digest); a change writes a new object, and the study manifest (mutable) gets a new rev.",
    `Which samples and studies are served is set by the Research Alpha release policy; this document's version is the policy id in force (${policy.version}).`,
    "Research Alpha (October 2026) is a feedback-oriented research preview. Beta, a full re-run with a new engine, begins in Q1 2027; the full re-run continues through 2027, and Beta will be released separately.",
    "Feedback from any page of https://singlet.bio; known issues at https://singlet.bio/known-issues.",
  ];
}

function softwareAgent(version: string | null | undefined, sha: string | null | undefined): Json {
  return {
    "@type": ["prov:SoftwareAgent", "sc:SoftwareSourceCode"],
    name: "singlet",
    codeRepository: CODE_REPOSITORY,
    license: CODE_LICENSE,
    ...(version ? { version } : {}),
    ...(sha ? { "prov:label": `git ${sha}` } : {}),
  };
}

const CREATOR = [
  { "@type": "sc:Organization", name: "Singlet", url: SITE_ORIGIN },
  { "@type": "sc:Person", name: "Zachary DeBruine" },
];

const PUBLISHER = { "@type": "sc:Organization", name: "Singlet", url: SITE_ORIGIN };

// ── study document ──────────────────────────────────────────────────────────

const minIso = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).sort()[0] ?? null;
const maxIso = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).sort().reverse()[0] ?? null;

function studyCitation(input: StudyInput): string {
  const pubs = input.publications
    .filter((p) => p.title)
    .map((p) => `${p.title}${p.journal ? `. ${p.journal}` : ""}${p.year ? ` (${p.year})` : ""}${p.doi ? `. doi:${p.doi}` : `. PMID ${p.pmid}`}`);
  return [
    `${input.title ?? input.gse}. GEO accession ${input.gse}, ${geoUrl(input.gse)}.`,
    ...pubs.map((p) => `${p}.`),
    `Reprocessed in ${RELEASE_NAME}, ${SITE_ORIGIN}/study/${input.gse}.`,
  ].join(" ");
}

function cellQcColumns(s: SampleInput): { name: string; type: ColumnType; description: string }[] {
  const have = new Set(s.object.members?.cells?.columns ?? []);
  const known: { name: string; type: ColumnType; description: string }[] = [
    { name: "barcode", type: "sc:Text", description: "Cell barcode (stored as whitelist indices when the protocol has a whitelist)." },
    { name: "called", type: "sc:Boolean", description: "The default cell call (STARsolo knee filter). Matrix columns with called = false are uncalled barcodes." },
    { name: "n_umi_exon", type: "sc:Integer", description: "Spliced (exonic) UMIs of the barcode." },
    { name: "n_umi_intron", type: "sc:Integer", description: "Unspliced (intronic) UMIs of the barcode." },
    { name: "n_feat_exon", type: "sc:Integer", description: "Exon features with at least one UMI." },
    { name: "n_feat_intron", type: "sc:Integer", description: "Intron features with at least one UMI." },
    { name: "called_ed", type: "sc:Boolean", description: "EmptyDrops call (additional, not the default)." },
    { name: "called_ed_fdr", type: "sc:Float", description: "EmptyDrops FDR (NaN = not tested)." },
  ];
  return known.filter((c) => have.has(c.name));
}

/**
 * The Croissant document of one study (or of one sample, when `input` holds a single sample and `single` is set). Pure: the same
 * input gives the same document.
 */
export function buildStudyCroissant(input: StudyInput, urls: CroissantUrls = croissantUrls(), opts: { single?: boolean } = {}): Json {
  const { gse, samples, manifest } = input;
  const single = !!opts.single && samples.length === 1;
  const docUrl = single ? urls.sample(gse, samples[0].gsm) : urls.study(gse);
  const nCells = samples.reduce((a, s) => a + (s.n_cells_called ?? 0), 0);
  const organisms = [...new Set(samples.map((s) => s.organism).filter((x): x is string => !!x))];
  const builds = [...new Set(samples.map((s) => s.reference_build).filter((x): x is string => !!x))];
  const assays = [...new Set(samples.map((s) => s.protocol).filter((x): x is string => !!x))];
  const versions = [...new Set(samples.map((s) => s.singlet_version).filter((x): x is string => !!x))];
  const withLabels = samples.filter((s) => s.sidecar);
  const nAncestry = samples.filter((s) => s.ancestry_genetic.length).length;
  const first = samples[0];
  const model = withLabels[0]?.sidecar?.model_version ?? first.object.members?.cells?.labels?.model_version;
  const ct = withLabels[0]?.sidecar?.cell_type;
  const acc = ct?.per_study_accuracy ?? {};
  const levelNames = ct?.level_names ?? {};

  // ── distribution
  const distribution: Json[] = [
    {
      "@type": "cr:FileObject",
      "@id": "manifest",
      name: "manifest",
      description: `Study manifest (docs/format-s1.md section 7): every sample object, its members and their byte ranges, the reference packs. Mutable; rev ${input.s1.rev} when this document was made.`,
      contentUrl: `${urls.data}/s1/m/${gse}.json`,
      encodingFormat: "application/json",
    },
    {
      "@type": "cr:FileObject",
      "@id": "samples-csv",
      name: "samples.csv",
      description: "The samples record set as CSV, generated from the catalog by singlet.bio.",
      contentUrl: urls.samplesCsv(gse),
      encodingFormat: "text/csv",
    },
  ];
  const exonPack = manifest.packs?.exon ?? null;
  if (exonPack) {
    distribution.push({
      "@type": "cr:FileObject",
      "@id": "features-csv",
      name: `features-${exonPack}.csv`,
      description: `Genes of the reference ${manifest.reference_build ?? ""} (exon pack ${exonPack}) and the matrix rows each one owns, generated from the pack by singlet.bio. Feature names per row: s1/ref/${exonPack}.pack (exon), s1/ref/${manifest.packs?.intron ?? "?"}.pack (intron).`,
      contentUrl: urls.featuresCsv(exonPack),
      encodingFormat: "text/csv",
    });
  }
  for (const s of samples) {
    distribution.push({
      "@type": "cr:FileObject",
      "@id": `s1/${s.gsm}`,
      name: `${s.gsm}.s1`,
      description: `.s1 sample object of ${s.gsm}: ${s.object.n_called ?? "?"} called cells of ${s.object.n_columns ?? "?"} stored barcodes. Immutable; HTTP Range supported; member byte ranges in the manifest.`,
      contentUrl: `${urls.data}/${s.object.key}`,
      encodingFormat: S1_FORMAT_URL,
      ...(s.object.bytes != null ? { contentSize: `${s.object.bytes} B` } : {}),
      ...(s.object.sha256 ? { sha256: s.object.sha256 } : {}),
    });
  }
  for (const s of withLabels) {
    const side = s.sidecar!;
    distribution.push({
      "@type": "cr:FileObject",
      "@id": `labels/${s.gsm}`,
      name: `${s.gsm}.labels.parquet`,
      description: `Per-cell label sidecar of ${s.gsm}: one row per called cell (${side.n_rows ?? "?"} rows). Immutable.`,
      contentUrl: `${urls.data}/${side.key}`,
      encodingFormat: PARQUET,
      ...(side.bytes != null ? { contentSize: `${side.bytes} B` } : {}),
      ...(side.sha256 ? { sha256: side.sha256 } : {}),
    });
  }
  distribution.push({
    "@type": "cr:FileSet",
    "@id": "sample-objects",
    name: "sample-objects",
    description: "Every .s1 sample object of this document.",
    containedIn: samples.map((s) => ({ "@id": `s1/${s.gsm}` })),
    encodingFormat: S1_FORMAT_URL,
    includes: "*",
  });
  if (withLabels.length && !single) {
    distribution.push({
      "@type": "cr:FileSet",
      "@id": "label-sidecars",
      name: "label-sidecars",
      description: "Every per-cell label sidecar of this document (one Parquet file per sample).",
      containedIn: withLabels.map((s) => ({ "@id": `labels/${s.gsm}` })),
      encodingFormat: PARQUET,
      includes: "*",
    });
  }

  // ── record sets
  const recordSet: Json[] = [
    csvRecordSet(
      "samples",
      "One record per sample: GEO metadata mapped to ontologies, the labeller's sample-level calls, QC and provenance, and the sample's files.",
      "samples-csv",
      "gsm_id",
      SAMPLE_COLUMNS
    ),
  ];

  if (withLabels.length) {
    const rs = "cells";
    // One sample: read its sidecar directly (mlcroissant 1.1 reads a FileObject, not a FileSet of plain files).
    const src = (column: string) =>
      single ? { fileObject: { "@id": `labels/${first.gsm}` }, extract: { column } } : { fileSet: { "@id": "label-sidecars" }, extract: { column } };
    const lv = (k: string) => (levelNames[k] ? ` (${levelNames[k]})` : "");
    const levelFields = [1, 2, 3, 4, 5, 6].map((k) =>
      field(rs, `cell_type_p${k}`, "sc:Float", `Gating confidence at level ${k}${lv(String(k))} of cell_type_path; empty below the deepest level.`, src(`cell_type_p${k}`))
    );
    recordSet.push({
      "@type": "cr:RecordSet",
      "@id": rs,
      name: rs,
      description:
        `One record per called cell, from the label sidecars (Parquet, label schema 2). col is the cell's column in its sample's matrices and cells table. ` +
        (single
          ? `All cells belong to ${first.gsm}.`
          : `Each sidecar holds one sample (its GSM is in the file's path and Parquet metadata); for records tied to a known sample, use the per-sample document (samples.croissant_url).`) +
        ` Cell type levels: ${Object.entries(levelNames)
          .map(([k, v]) => `${k} ${v}`)
          .join(", ")}; the level of a call is the number of ids in cell_type_path.`,
      field: [
        field(rs, "col", "sc:Integer", "Column of the cell in its sample's exon_counts / intron_counts matrices and cells table (0-based).", src("col")),
        field(rs, "cell_type_ontology_term_id", ["sc:Text", ONTOLOGY_CLASS.CL], "Deepest Cell Ontology call (levels 3 and deeper are previews).", src("cell_type_cl")),
        field(rs, "cell_type", "sc:Text", "Label of cell_type_ontology_term_id.", src("cell_type_label")),
        field(rs, "cell_type_score", "sc:Float", "Product of the gating confidences down to the deepest level; ranks calls, not a calibrated probability.", src("cell_type_score")),
        field(rs, "cell_type_path", "sc:Text", 'Cell Ontology path of the call, compartment first, ids joined by ">".', src("cell_type_path")),
        ...levelFields,
        field(rs, "sex_chrom", ["sc:Text", ONTOLOGY_CLASS.PATO_SEX], "Chromosomal sex: female (PATO:0000383), male (PATO:0000384) or ambiguous.", src("sex_chrom")),
        field(rs, "sex_score", "sc:Float", "Posterior of sex_chrom.", src("sex_score")),
        field(rs, "ancestry_ontology_term_id", ["sc:Text", ONTOLOGY_CLASS.HANCESTRO], "Continental genetic ancestry of the cell's donor (HANCESTRO); empty when not computed.", src("ancestry_hancestro")),
        field(rs, "ancestry_prob", "sc:Float", "Proportion of the ancestry call.", src("ancestry_prob")),
        field(rs, "model_version", "sc:Text", "Labeller and model versions.", src("model_version")),
      ],
    });
  }

  const qc = cellQcColumns(first);
  const others = (first.object.members?.cells?.columns ?? []).filter(
    (c) => !qc.some((q) => q.name === c) && !c.startsWith("cell_type_") && !c.startsWith("sex_") && !c.startsWith("ancestry_")
  );
  const s1src = (column: string) => ({ fileSet: { "@id": "sample-objects" }, extract: { column } });
  recordSet.push({
    "@type": "cr:RecordSet",
    "@id": "cell_qc",
    name: "cell_qc",
    description:
      `One record per stored barcode (called or not): the 'cells' member (CEL2 columnar table, docs/format-s1.md section 5.3) of each .s1 object, at the byte range the manifest gives. ` +
      `Row i is column i of the sample's matrices. Read it with the singlet Python or R package (singlet.load); mlcroissant cannot decode the .s1 container.` +
      (others.length ? ` Other columns in this study's cells tables: ${others.join(", ")}.` : ""),
    field: qc.map((c) => field("cell_qc", c.name, c.type, c.description, s1src(c.name))),
  });

  const matrix = (id: string, member: string, what: string) => {
    const m = first.object.members?.[member];
    const rowsPack = (m?.names?.rows as { pack?: string } | undefined)?.pack;
    return {
      "@type": "cr:RecordSet",
      "@id": id,
      name: id,
      description:
        `${what} counts, cells x features, as non-zero (col, row, count) entries: member '${member}' of each .s1 object, a pz2 matrix (docs/format-s1.md section 4) stored column- (cell-) chunked ` +
        `with a chunk index, so any range of cells is one HTTP range request. Rows are ${member === "exon_counts.1pz" ? "merged exons" : "introns"} of the reference genes` +
        `${rowsPack ? ` (pack ${rowsPack}${m?.m ? `, ${fmt(m.m)} rows` : ""})` : ""}; the features record set gives each gene's rows, and summing a gene's rows gives gene-level counts. ` +
        `Read with the singlet package (modalities "${member === "exon_counts.1pz" ? "spliced" : "unspliced"}"; "counts" is spliced + unspliced).`,
      field: [
        field(id, "col", "sc:Integer", "Matrix column: the cell's row in cell_qc and its col in cells.", s1src(`${member}:col`)),
        field(id, "row", "sc:Integer", "Matrix row: a feature of the reference (see features).", s1src(`${member}:row`)),
        field(id, "count", "sc:Integer", "UMI count.", s1src(`${member}:value`)),
      ],
    };
  };
  recordSet.push(matrix("spliced_counts", "exon_counts.1pz", "Spliced (exonic)"));
  recordSet.push(matrix("unspliced_counts", "intron_counts.1pz", "Unspliced (intronic)"));

  if (exonPack) {
    recordSet.push(
      csvRecordSet(
        "features",
        `One record per gene of ${manifest.reference_build ?? "the reference"}: Ensembl id, symbol, position, and the rows of the spliced and unspliced matrices that belong to it.`,
        "features-csv",
        "gene_id",
        FEATURE_COLUMNS
      )
    );
  }

  // ── dataset
  const scope = single ? `sample ${first.gsm} of ${gse}` : `${gse}`;
  const description =
    `${input.title ?? gse} (${scope}), reprocessed from raw reads in ${RELEASE_NAME}: ` +
    `${fmt(samples.length)} sample${samples.length === 1 ? "" : "s"} that passed QC, ${fmt(nCells)} called cells` +
    `${organisms.length ? `, ${organisms.join(", ")}` : ""}${builds.length ? `, reference ${builds.join(", ")}` : ""}. ` +
    `Gene counts (spliced and unspliced), splice junctions, cell calls and per-cell QC in one .s1 object per sample, with per-cell Cell Ontology cell type, chromosomal sex and genetic ancestry labels. ` +
    `Data CC0 1.0; code MIT.`;
  const datePublished = input.s1.created_at ?? manifest.created_at ?? null;
  const dateModified = maxIso([input.s1.updated_at, manifest.created_at, datePublished]);
  const biases = [
    single
      ? `One sample of ${gse}.`
      : input.n_geo_samples != null && input.n_geo_samples > samples.length
        ? `${fmt(samples.length)} of the ${fmt(input.n_geo_samples)} samples GEO lists for ${gse} are in this document; the others are not in Research Alpha yet, were flagged low QC, or hold no called cell.`
        : `All ${fmt(samples.length)} samples GEO lists for ${gse} are in this document.`,
    `Organism: ${organisms.join(", ") || "unknown"}; assay: ${assays.join(", ") || "unknown"}. A study is one lab's design: its tissues, donors and conditions are what the depositors chose.`,
    `Genetic ancestry is called for ${fmt(nAncestry)} of ${fmt(samples.length)} samples here; across the atlas it covers about 1% of cells.`,
    "Only studies whose raw reads are in SRA and could be processed are included; GEO metadata is uncurated.",
  ];
  const limitations = [...LIMITATIONS];
  if (Object.keys(acc).length) {
    limitations.unshift(
      `Labeller accuracy recorded in this study's files (manifest annotations.cell_type.per_study_accuracy): ${Object.entries(acc)
        .map(([k, v]) => `level ${k}${lv2(levelNames, k)} ${v}`)
        .join(", ")}; levels from ${ct?.preview_from_level ?? 3} are previews.`
    );
  }

  const doc: Json = {
    "@context": CROISSANT_CONTEXT,
    "@type": "sc:Dataset",
    "@id": docUrl,
    conformsTo: CROISSANT_SPEC,
    name: single ? `${first.gsm} (${gse}), Singlet Research Alpha` : `${gse}, Singlet Research Alpha`,
    description,
    url: `${SITE_ORIGIN}/study/${gse}`,
    sameAs: [geoUrl(gse), ...(single ? [geoUrl(first.gsm)] : [])],
    version: input.policy.version,
    license: DATA_LICENSE,
    isAccessibleForFree: true,
    inLanguage: "en",
    creator: CREATOR,
    publisher: PUBLISHER,
    ...(datePublished ? { datePublished } : {}),
    ...(dateModified ? { dateModified } : {}),
    keywords: ["single-cell RNA-seq", "scRNA-seq", "transcriptomics", "GEO", gse, ...organisms, ...assays, "Cell Ontology", RELEASE_NAME],
    citeAs: studyCitation(input),
    citation: [
      geoUrl(gse),
      ...input.publications.map((p) => (p.doi ? `https://doi.org/${p.doi}` : `https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`)),
      RELEASE_NAME,
    ],
    isPartOf: single ? [{ "@id": urls.study(gse) }, { "@id": urls.atlas }] : { "@id": urls.atlas },
    ...(single ? {} : { hasPart: samples.map((s) => ({ "@id": urls.sample(gse, s.gsm) })) }),
    isLiveDataset: true,
    "prov:wasDerivedFrom": [
      { "@id": geoUrl(gse), "prov:label": `GEO series ${gse}` },
      ...samples.flatMap((s) => s.srr_ids.slice(0, 1).map((r) => ({ "@id": `https://www.ncbi.nlm.nih.gov/sra/${r}`, "prov:label": `SRA run ${r} (${s.gsm})` }))),
    ],
    "prov:wasGeneratedBy": [
      {
        "@type": "prov:Activity",
        "prov:label": `Alignment and counting (singlet pipeline${versions.length ? ` ${versions.join(", ")}` : ""}, reference ${builds.join(", ") || "?"})`,
        "prov:wasAssociatedWith": softwareAgent(versions[0], null),
      },
      {
        "@type": "prov:Activity",
        "prov:label": `Transcode to .s1 and per-cell labels (singlet ${manifest.pipeline?.singlet_version ?? "?"})`,
        ...(manifest.created_at ? { "prov:endedAtTime": manifest.created_at } : {}),
        "prov:wasAssociatedWith": softwareAgent(manifest.pipeline?.singlet_version, manifest.pipeline?.git_sha),
      },
    ],
    "rai:dataCollection":
      `Raw sequencing reads of GEO series ${gse} (submitted ${input.submitted_date ?? "?"}), downloaded from SRA, and GEO's sample metadata. No new samples were collected.`,
    "rai:dataCollectionType": ["Secondary Data Analysis"],
    "rai:dataCollectionRawData": `GEO series ${gse} and its SRA runs (prov:wasDerivedFrom lists the run used per sample).`,
    "rai:dataPreprocessingProtocol": [...PREPROCESSING, policyText(input.policy)],
    "rai:dataAnnotationProtocol": ANNOTATION_PROTOCOL,
    "rai:dataAnnotationPlatform": `Automated, in the pipeline: singlet-annotate ${annotateVersion(model, "singlet-annotate") ?? "?"}; no human annotators.`,
    "rai:machineAnnotationTools": model ? model.split(";") : [],
    "rai:annotationsPerItem":
      "Per cell: one cell-type path (with a confidence per level), one chromosomal sex call, at most one ancestry call. Per sample: one value per ontology field, several where GEO lists several.",
    "rai:dataAnnotationAnalysis": ANNOTATION_ANALYSIS,
    "rai:dataBiases": biases,
    "rai:dataLimitations": limitations,
    "rai:personalSensitiveInformation": SENSITIVE,
    "rai:dataUseCases": USE_CASES,
    "rai:dataSocialImpact": SOCIAL_IMPACT,
    "rai:dataReleaseMaintenancePlan": maintenance(input.policy).join(" "),
    distribution,
    recordSet,
  };
  const rel = Object.entries(input.ontology_releases);
  if (rel.length) (doc["rai:dataAnnotationProtocol"] as string[]).push(`Ontology releases of the term labels: ${rel.map(([o, r]) => `${o} ${r}`).join("; ")}.`);
  return doc;
}

function lv2(names: Record<string, string>, k: string): string {
  return names[k] ? ` (${names[k]})` : "";
}

// ── atlas document ──────────────────────────────────────────────────────────

export interface AtlasStudyRow {
  gse_id: string;
  title: string | null;
  organism_primary: string | null;
  n_usable_samples: number | null;
  n_usable_cells: number | null;
  year: number | null;
  reference_build: string | null;
  bytes: number | null;
  rev: string;
  created_at: string | null;
  updated_at: string | null;
  tissue_groups: string | null;
  assay_families: string | null;
}

/** Every downloadable study served in the .s1 format (the studies record set), one indexed pass over gse_meta. */
export const ATLAS_STUDIES_SQL = `SELECT m.gse_id, g.title, m.organism_primary, m.n_usable_samples, m.n_usable_cells, m.year,
       s.reference_build, s.bytes, s.rev, s.created_at, s.updated_at, m.tissue_groups, m.assay_families
  FROM gse_meta m
  JOIN gse g ON g.id = m.gse_id
  JOIN s1_study s ON s.gse_id = m.gse_id
  JOIN s1_migration vm ON vm.gse_id = m.gse_id AND vm.status IN ('verified', 'retired')
 WHERE ${DOWNLOADABLE_SQL}
 ORDER BY m.gse_id`;

/** Served samples per genetic-ancestry call (study_label roll-up of the labeller's sample facts). */
export const ATLAS_ANCESTRY_SQL = `SELECT sl.value, sl.ontology_id, SUM(sl.n_samples) AS n_samples, COUNT(*) AS n_studies
  FROM study_label sl JOIN gse_meta m ON m.gse_id = sl.gse_id
 WHERE sl.attr = 'ancestry_genetic' AND ${DOWNLOADABLE_SQL}
 GROUP BY sl.value, sl.ontology_id ORDER BY n_samples DESC`;

export interface AtlasInput {
  stats: Pick<CorpusStats, "studies_with_files" | "samples_in_files" | "cells_in_files" | "geo_samples_known" | "species_count">;
  studies: AtlasStudyRow[];
  ancestry: { value: string; ontology_id: string | null; n_samples: number; n_studies: number }[];
  policy: ReleasePolicy;
}

export async function loadAtlasInput(db: D1Database, stats: AtlasInput["stats"]): Promise<AtlasInput> {
  const [studies, ancestry, policy] = await Promise.all([
    db.prepare(ATLAS_STUDIES_SQL).all<AtlasStudyRow>(),
    db
      .prepare(ATLAS_ANCESTRY_SQL)
      .all<AtlasInput["ancestry"][number]>()
      .catch(() => ({ results: [] as AtlasInput["ancestry"] })),
    currentReleasePolicy(db),
  ]);
  return { stats, studies: studies.results ?? [], ancestry: ancestry.results ?? [], policy };
}

export const STUDY_COLUMNS: Column<{ r: AtlasStudyRow; urls: CroissantUrls }>[] = [
  { name: "gse_id", type: "sc:Text", description: "GEO series accession (the record key).", value: (x) => x.r.gse_id },
  { name: "title", type: "sc:Text", description: "Series title in GEO.", value: (x) => x.r.title },
  { name: "organism", type: "sc:Text", description: "Primary organism of the served samples.", value: (x) => x.r.organism_primary },
  { name: "organism_ontology_term_id", type: "sc:Text", description: "NCBI Taxonomy id of the organism.", value: (x) => (x.r.organism_primary ? NCBI_TAXON[x.r.organism_primary] ?? "" : "") },
  { name: "n_samples", type: "sc:Integer", description: "Samples that passed QC.", value: (x) => x.r.n_usable_samples },
  { name: "n_cells", type: "sc:Integer", description: "Cells called in those samples.", value: (x) => x.r.n_usable_cells },
  { name: "reference_build", type: "sc:Text", description: "Genome build the reads were aligned to.", value: (x) => x.r.reference_build },
  { name: "year", type: "sc:Integer", description: "Year GEO received the series.", value: (x) => x.r.year },
  { name: "s1_bytes", type: "sc:Integer", description: "Size of the study's sample objects.", value: (x) => x.r.bytes },
  { name: "rev", type: "sc:Text", description: "Manifest revision (changes whenever a sample object or study file does).", value: (x) => x.r.rev },
  { name: "created_at", type: "sc:Text", description: "When the study's objects were written (ISO 8601).", value: (x) => x.r.created_at },
  { name: "manifest_url", type: "sc:URL", description: "Study manifest.", value: (x) => `${x.urls.data}/s1/m/${x.r.gse_id}.json` },
  { name: "croissant_url", type: "sc:URL", description: "Croissant metadata of the study.", value: (x) => x.urls.study(x.r.gse_id) },
  { name: "study_url", type: "sc:URL", description: "Study page on singlet.bio.", value: (x) => `${x.urls.site}/study/${x.r.gse_id}` },
  { name: "geo_url", type: "sc:URL", description: "GEO record of the series.", value: (x) => geoUrl(x.r.gse_id) },
];

export function studiesCsv(rows: AtlasStudyRow[], urls: CroissantUrls = croissantUrls()): string {
  return toCsv(
    STUDY_COLUMNS.map((c) => c.name),
    rows.map((r) => STUDY_COLUMNS.map((c) => c.value({ r, urls })))
  );
}

function tally(rows: AtlasStudyRow[], pick: (r: AtlasStudyRow) => string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) for (const v of new Set(pick(r))) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** The atlas-level skew, as sentences with the numbers (dataBiases). */
export function atlasBiases(input: AtlasInput): string[] {
  const rows = input.studies;
  const totalSamples = rows.reduce((a, r) => a + (r.n_usable_samples ?? 0), 0);
  const totalCells = rows.reduce((a, r) => a + (r.n_usable_cells ?? 0), 0);
  const org = new Map<string, { samples: number; cells: number }>();
  for (const r of rows) {
    const k = r.organism_primary ?? "organism not recorded";
    const o = org.get(k) ?? { samples: 0, cells: 0 };
    o.samples += r.n_usable_samples ?? 0;
    o.cells += r.n_usable_cells ?? 0;
    org.set(k, o);
  }
  const orgTop = [...org.entries()].sort((a, b) => b[1].samples - a[1].samples).slice(0, 4);
  const tissues = tally(rows, (r) => jsonList(r.tissue_groups)).slice(0, 6);
  const assays = tally(rows, (r) => jsonList(r.assay_families)).slice(0, 5);
  const ancTotal = input.ancestry.reduce((a, x) => a + Number(x.n_samples ?? 0), 0);
  const out = [
    `Organism (share of ${fmt(totalSamples)} samples / ${fmt(totalCells)} cells): ${orgTop
      .map(([k, v]) => `${k} ${totalSamples ? pct(v.samples / totalSamples) : "?"} / ${totalCells ? pct(v.cells / totalCells) : "?"}`)
      .join("; ")}.`,
    `Tissue groups, by number of the ${fmt(rows.length)} studies that include them: ${tissues.map(([k, n]) => `${k} ${fmt(n)}`).join("; ")}.`,
    `Assay families, by studies: ${assays.map(([k, n]) => `${k} ${fmt(n)}`).join("; ")}.`,
    `Coverage is partial: ${fmt(input.stats.samples_in_files)} samples passed QC, of ${fmt(input.stats.geo_samples_known)} that GEO lists for the studies the catalog tracks. Studies whose raw reads are not in SRA, or could not be processed, are absent.`,
  ];
  if (ancTotal) {
    out.push(
      `Genetic ancestry, samples with a call (a pooled sample can carry several): ${input.ancestry
        .map((a) => `${a.value || HANCESTRO_LABELS[a.ontology_id ?? ""] || a.ontology_id} ${fmt(Number(a.n_samples))}`)
        .join("; ")}. Most samples have no call (about 1% of cells are covered).`
    );
  }
  out.push("GEO metadata (sex, tissue, disease) is uncurated and may be wrong.");
  return out;
}

export function buildAtlasCroissant(input: AtlasInput, urls: CroissantUrls = croissantUrls()): Json {
  const { stats, studies, policy } = input;
  const datePublished = minIso(studies.map((r) => r.created_at));
  const dateModified = maxIso([...studies.map((r) => r.updated_at), policy.loaded_at]);
  const builds = tally(studies, (r) => (r.reference_build ? [r.reference_build] : [])).map(([k]) => k);
  return {
    "@context": CROISSANT_CONTEXT,
    "@type": "sc:Dataset",
    "@id": urls.atlas,
    conformsTo: CROISSANT_SPEC,
    name: "Singlet Research Alpha",
    alternateName: RELEASE_NAME,
    description:
      `An open atlas of public single-cell RNA-seq studies from GEO, reprocessed from raw reads with one pipeline: ${fmt(stats.studies_with_files)} studies, ` +
      `${fmt(stats.samples_in_files)} samples that passed QC and ${fmt(stats.cells_in_files)} called cells (the /api/stats basis). One immutable .s1 object per sample ` +
      `(pz2-coded spliced and unspliced count matrices, splice junctions, a per-cell table with cell calls and QC) plus a study manifest, and per-cell labels for Cell Ontology ` +
      `cell type, chromosomal sex and genetic ancestry. Research Alpha is a feedback-oriented research preview; coverage is partial. Data CC0 1.0; code MIT.`,
    url: SITE_ORIGIN,
    version: policy.version,
    license: DATA_LICENSE,
    isAccessibleForFree: true,
    inLanguage: "en",
    creator: CREATOR,
    publisher: PUBLISHER,
    ...(datePublished ? { datePublished } : {}),
    ...(dateModified ? { dateModified } : {}),
    keywords: ["single-cell RNA-seq", "scRNA-seq", "transcriptomics", "atlas", "GEO", "SRA", "Cell Ontology", "HANCESTRO", RELEASE_NAME],
    citeAs: `${RELEASE_NAME}. ${SITE_ORIGIN}. Cite the original GEO study of every dataset you use as well (studies.geo_url).`,
    citation: [RELEASE_NAME],
    isLiveDataset: true,
    "prov:wasDerivedFrom": [
      { "@id": "https://www.ncbi.nlm.nih.gov/geo/", "prov:label": "NCBI Gene Expression Omnibus (series and sample metadata)" },
      { "@id": "https://www.ncbi.nlm.nih.gov/sra", "prov:label": "NCBI Sequence Read Archive (raw reads)" },
    ],
    "prov:wasGeneratedBy": {
      "@type": "prov:Activity",
      "prov:label": `Reprocessing of every study with the singlet pipeline; references ${builds.join(", ")}`,
      "prov:wasAssociatedWith": softwareAgent(null, null),
    },
    "rai:dataCollection":
      "Raw sequencing reads of public single-cell RNA-seq studies deposited in GEO, downloaded from SRA, and GEO's series and sample metadata. No new samples were collected.",
    "rai:dataCollectionType": ["Secondary Data Analysis"],
    "rai:dataCollectionRawData": "NCBI GEO series and their SRA runs (each study's document names the run used per sample).",
    "rai:dataPreprocessingProtocol": [...PREPROCESSING, policyText(policy)],
    "rai:dataAnnotationProtocol": ANNOTATION_PROTOCOL,
    "rai:dataAnnotationPlatform": "Automated, in the pipeline (singlet-annotate); no human annotators. Model versions are in each label sidecar (model_version).",
    "rai:annotationsPerItem":
      "Per cell: one cell-type path (with a confidence per level), one chromosomal sex call, at most one ancestry call. Per sample: one value per ontology field, several where GEO lists several.",
    "rai:dataAnnotationAnalysis": ANNOTATION_ANALYSIS,
    "rai:dataBiases": atlasBiases(input),
    "rai:dataLimitations": LIMITATIONS,
    "rai:personalSensitiveInformation": SENSITIVE,
    "rai:dataUseCases": USE_CASES,
    "rai:dataSocialImpact": SOCIAL_IMPACT,
    "rai:dataReleaseMaintenancePlan": maintenance(policy).join(" "),
    distribution: [
      {
        "@type": "cr:FileObject",
        "@id": "studies-csv",
        name: "studies.csv",
        description: "The studies record set as CSV, generated from the catalog by singlet.bio.",
        contentUrl: urls.studiesCsv,
        encodingFormat: "text/csv",
      },
      {
        "@type": "cr:FileSet",
        "@id": "study-manifests",
        name: "study-manifests",
        description: `Every study manifest, ${urls.data}/s1/m/<GSE>.json (${fmt(studies.length)} files; studies.manifest_url lists them). Each study's own Croissant document (studies.croissant_url) describes its sample objects, label sidecars and record sets.`,
        encodingFormat: "application/json",
        includes: "s1/m/GSE*.json",
      },
    ],
    recordSet: [
      csvRecordSet("studies", "One record per downloadable study.", "studies-csv", "gse_id", STUDY_COLUMNS),
    ],
  };
}

// ── fetchers ────────────────────────────────────────────────────────────────

/** The manifest from data.singlet.bio (edge-cached for its own max-age, 300 s); null on 404 (or the guard's 410). */
export function httpManifestFetcher(dataOrigin = "https://data.singlet.bio"): ManifestFetcher {
  return async (gse) => {
    const res = await fetch(`${dataOrigin}/s1/m/${gse}.json`, { cf: { cacheEverything: true, cacheTtl: 300 } } as RequestInit);
    if (res.status === 404 || res.status === 410) return null;
    if (!res.ok) throw new Error(`manifest ${gse} answered ${res.status}`);
    return (await res.json()) as StudyManifest;
  };
}

/** A JSON-LD response (Croissant documents are JSON-LD; `application/ld+json` is what crawlers and mlcroissant expect). */
export function jsonLd(doc: unknown): Response {
  return new Response(JSON.stringify(doc, null, 1), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/ld+json; charset=utf-8" },
  });
}

export function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `inline; filename="${filename}"` },
  });
}

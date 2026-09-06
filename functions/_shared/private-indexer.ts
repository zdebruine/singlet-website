import { parseZipSource, readEntryFromSource, sampleOf, type BundleByteSource, type ZipEntry } from "./bundle-reader";
import { shapeSummary } from "./bundle-core";
import { loadRules, toGroup } from "./vocab";

const decoder = new TextDecoder();

function object(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function string(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function characteristics(raw: unknown): Record<string, string> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
  }
  const out: Record<string, string> = {};
  for (const part of string(raw).split(/\s*;;\s*/)) {
    const at = part.indexOf(":");
    if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return out;
}

function first(c: Record<string, string>, names: string[]): string {
  for (const name of names) {
    const key = Object.keys(c).find((k) => k.toLowerCase().replace(/[_ -]/g, "") === name.replace(/[_ -]/g, ""));
    if (key && c[key]) return c[key];
  }
  return "";
}

async function jsonEntry(source: BundleByteSource, entry: ZipEntry | undefined): Promise<Record<string, unknown>> {
  if (!entry) return {};
  return object(JSON.parse(decoder.decode(await readEntryFromSource(source, entry))));
}

export async function indexPrivateBundle(db: D1Database, source: BundleByteSource, fallbackId: string, waitUntil?: (p: Promise<unknown>) => void) {
  const index = await parseZipSource(source);
  const manifestEntry = index.entries.find((e) => e.p === "manifest.json");
  if (!manifestEntry) throw new Error("This archive is not a .singlet file: manifest.json is missing.");
  const manifest = await jsonEntry(source, manifestEntry);
  if (!string(manifest.schema_version)) throw new Error("manifest.json has no schema_version.");
  const studyMeta = await jsonEntry(source, index.entries.find((e) => e.p === "study_meta.json"));
  const gsmMeta = object(studyMeta.gsm_meta);
  const sampleIds = [...new Set(index.entries.map((e) => sampleOf(e.p)).filter((v): v is string => !!v))].sort();
  if (!sampleIds.length) throw new Error("The .singlet file contains no sample directories.");
  const rules = await loadRules(db, waitUntil);
  const samples: Record<string, unknown>[] = [];
  const qc: Record<string, unknown>[] = [];
  for (const sampleId of sampleIds) {
    const meta = object(gsmMeta[sampleId]);
    const chars = characteristics(meta.sample_characteristics ?? meta.characteristics);
    const tissue = string(meta.tissue) || first(chars, ["tissue", "source name", "organ"]);
    const disease = string(meta.disease) || first(chars, ["disease", "disease state", "condition", "health status"]);
    const protocol = string(meta.protocol_name ?? meta.protocol);
    const cellType = string(meta.cell_type) || first(chars, ["cell type", "celltype"]);
    samples.push({ sample_id: sampleId, organism: string(meta.organism), tissue, tissue_group: toGroup(rules, "tissue", tissue), disease, disease_group: toGroup(rules, "disease", disease), protocol, assay_family: toGroup(rules, "protocol", protocol), cell_type: cellType, characteristics: chars });
    const summary = await jsonEntry(source, index.entries.find((e) => e.p === `samples/${sampleId}/summary.json`));
    qc.push({ ...shapeSummary(fallbackId, sampleId, summary), sample_id: sampleId });
  }
  const unique = (values: unknown[]) => [...new Set(values.filter((v): v is string => typeof v === "string" && !!v))];
  const nCells = qc.reduce((n, r) => n + (typeof r.n_cells_called === "number" ? r.n_cells_called : 0), 0);
  const organisms = unique(samples.map((s) => s.organism));
  return {
    bytes: index.bytes,
    study: {
      study_id: string(studyMeta.gse_id) || string(manifest.gse_id) || fallbackId,
      title: string(studyMeta.series_title) || fallbackId,
      abstract: string(studyMeta.series_summary),
      organism_primary: organisms[0] ?? null,
      organisms,
      tissue_groups: unique(samples.map((s) => s.tissue_group)),
      disease_groups: unique(samples.map((s) => s.disease_group)),
      assay_families: unique(samples.map((s) => s.assay_family)),
      cell_types_raw: unique(samples.map((s) => s.cell_type)),
      n_cells: nCells || null,
      reference_build: string(manifest.reference_build) || null,
      singlet_version: string(manifest.singlet_version) || null,
      year: typeof studyMeta.year === "number" ? studyMeta.year : null,
      manifest,
      study_meta: studyMeta,
    },
    samples,
    qc,
    entries: index.entries,
  };
}

/**
 * Only public http(s) hosts may be registered. Private, loopback, link-local,
 * carrier-grade-NAT and cloud metadata addresses are refused, and the caller
 * must reject redirects so a public host cannot bounce us into one.
 */
export function assertPublicBundleUrl(value: string): URL {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Register a public HTTPS URL ending in .singlet.");
  if (url.protocol !== "https:") throw new Error("Register a public HTTPS URL ending in .singlet.");
  if (!url.pathname.toLowerCase().endsWith(".singlet")) throw new Error("Register a public HTTPS URL ending in .singlet.");
  const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const blocked =
    h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h === "metadata.google.internal" ||
    h === "0.0.0.0" || h === "::1" || h === "::" ||
    /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(h) ||
    /^(fc|fd|fe8|fe9|fea|feb)/.test(h);
  if (blocked) throw new Error("That address is not public.");
  return url;
}

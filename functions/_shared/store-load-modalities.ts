/**
 * The `modalities` vocabulary of the singlet clients (python/singlet/store/client.py MODALITIES, r/R/store.R .store_modality_members): the
 * names a user passes to `singlet.load(..., modalities=[...])` / `load(..., modalities = ...)`, and the sample-object members each one
 * needs. The MCP tools take the same names so that an answer lists only the byte ranges those members occupy.
 *
 * Storage keeps exon and intron counts apart: `counts` (X = spliced + unspliced) needs both matrices, `spliced` only the exon matrix,
 * `unspliced` only the intron matrix. `psi` is computed by the client from the junction counts. The per-cell `cells` table (barcodes,
 * called flag, per-cell statistics) is always part of a selection.
 */
import type { StoreMember } from "./store-catalog";
import { describeMember, type MemberDescription } from "./store-serve";

export interface LoadModality {
  name: string;
  members: string[];
  /** Where the client puts it: AnnData X / layers / obsm, SingleCellExperiment assay / altExp. */
  python: string;
  r: string;
  description: string;
  /** Names of the catalog's per-sample `modalities` column (./modalities registry) that indicate the members are there. */
  catalog: string[];
}

const EXON = "exon_counts.1pz";
const INTRON = "intron_counts.1pz";
const SJ = "sj_counts.1pz";

export const LOAD_MODALITIES: LoadModality[] = [
  { name: "counts", members: [EXON, INTRON], python: "X", r: 'assay "counts"', description: "Gene counts, spliced + unspliced (summed by the client).", catalog: ["exon_counts"] },
  { name: "spliced", members: [EXON], python: 'layers["spliced"]', r: 'assay "spliced"', description: "Exon (spliced) UMIs per gene.", catalog: ["exon_counts"] },
  { name: "unspliced", members: [INTRON], python: 'layers["unspliced"]', r: 'assay "unspliced"', description: "Intron (unspliced) UMIs per gene.", catalog: ["intron_counts"] },
  { name: "splice_junctions", members: [SJ], python: 'obsm["splice_junctions"]', r: 'altExp "splice_junctions"', description: "Reads per splice junction.", catalog: ["junctions"] },
  { name: "psi", members: [SJ], python: 'obsm["psi"]', r: 'altExp "psi"', description: "Percent spliced in per junction, computed from the junction counts.", catalog: ["junctions"] },
  { name: "mt", members: ["mt_heteroplasmy.1pz"], python: 'obsm["mt"]', r: 'altExp "mt"', description: "Mitochondrial heteroplasmy per chrM variant site.", catalog: ["mt_heteroplasmy"] },
  { name: "vdj", members: ["vdj_gene_usage.1pz"], python: 'obsm["vdj"]', r: 'altExp "vdj"', description: "V(D)J segment usage counts.", catalog: ["vdj_gene_usage"] },
];

export const LOAD_MODALITY_NAMES = LOAD_MODALITIES.map((m) => m.name);
const BY_NAME = new Map(LOAD_MODALITIES.map((m) => [m.name, m]));
const ALIASES: Record<string, string> = {
  x: "counts",
  exon: "spliced",
  exon_counts: "spliced",
  intron: "unspliced",
  intron_counts: "unspliced",
  junctions: "splice_junctions",
  sj: "splice_junctions",
  splice_psi: "psi",
  mt_heteroplasmy: "mt",
  vdj_gene_usage: "vdj",
};

/** The JSON Schema of the `modalities` input, shared by the tools that take it. */
export const MODALITIES_PROP = {
  type: "array",
  items: { type: "string" },
  minItems: 1,
  maxItems: 7,
  description: `Only these data types (the names singlet.load(modalities=...) takes): ${LOAD_MODALITY_NAMES.join(", ")}. counts needs the exon and intron matrices, spliced only exon, unspliced only intron, splice_junctions and psi only the junction matrix. The per-cell cells table is always included.`,
};

/** `modalities` from tool arguments: null when absent, the canonical names (vocabulary order), or an error naming the vocabulary. */
export function parseLoadModalities(v: unknown): { names: string[] } | { error: string } | null {
  if (v === undefined || v === null) return null;
  const items = typeof v === "string" ? [v] : Array.isArray(v) ? v : null;
  if (!items || !items.length) return { error: `\`modalities\` must be a non-empty list of: ${LOAD_MODALITY_NAMES.join(", ")}.` };
  const want = new Set<string>();
  for (const it of items) {
    const k0 = String(it).trim().toLowerCase();
    const k = ALIASES[k0] ?? k0;
    if (!BY_NAME.has(k)) return { error: `Unknown modality '${String(it)}'. Use: ${LOAD_MODALITY_NAMES.join(", ")}.` };
    want.add(k);
  }
  return { names: LOAD_MODALITY_NAMES.filter((n) => want.has(n)) };
}

/** A readable matrix with at least one row and column (stubs and empty legacy members are absent). */
export function memberHasData(members: Record<string, StoreMember>, name: string): boolean {
  const m = members[name];
  return !!m && m.kind === 1 && Number(m.len) > 0 && m.m !== 0 && m.n !== 0;
}

/** The modalities one sample carries (counts needs only the exon matrix: older samples have no intron matrix). */
export function sampleLoadModalities(members: Record<string, StoreMember>): string[] {
  return LOAD_MODALITIES.filter((m) => (m.name === "counts" ? [EXON] : m.members).every((n) => memberHasData(members, n))).map((m) => m.name);
}

export interface Selection {
  modalities: string[];
  /** cells first, then the members of the modalities the sample has, described with their ranges. */
  files: MemberDescription[];
  /** Modalities asked for that this sample lacks. */
  missing: string[];
  /** Bytes of the selected members (what a client downloads for these modalities, whole). */
  bytes: number;
}

/** The members of one sample that `modalities` needs, with byte ranges. */
export function selectMembers(members: Record<string, StoreMember>, modalities: string[]): Selection {
  const have = new Set(sampleLoadModalities(members));
  const missing = modalities.filter((m) => !have.has(m));
  const names = ["cells"];
  for (const k of modalities) {
    if (!have.has(k)) continue;
    for (const n of BY_NAME.get(k)!.members) if (memberHasData(members, n) && !names.includes(n)) names.push(n);
  }
  const files = names.filter((n) => members[n]).map((n) => describeMember(n, members[n]));
  return { modalities, files, missing, bytes: files.reduce((s, f) => s + f.bytes, 0) };
}

export function loadModality(name: string): LoadModality | undefined {
  return BY_NAME.get(name);
}

/** The one-line loaders for these modalities. */
export function loadSnippets(gse: string, gsm: string | null, modalities: string[]) {
  const py = `[${modalities.map((m) => JSON.stringify(m)).join(", ")}]`;
  const r = `c(${modalities.map((m) => JSON.stringify(m)).join(", ")})`;
  return {
    python: gsm ? `singlet.load("${gse}", samples=["${gsm}"], modalities=${py})` : `singlet.load("${gse}", modalities=${py})`,
    r: gsm ? `load("${gsm}", modalities = ${r})` : `load("${gse}", modalities = ${r})`,
  };
}

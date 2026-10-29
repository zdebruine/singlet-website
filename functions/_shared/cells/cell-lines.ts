/**
 * Cell lines in cell search. The labeller was trained on primary tissue, so on a cultured cell line it gives the nearest primary
 * cell type, which is often wrong (K-562 cells come out as "transit amplifying cell"). Search therefore shows the line itself:
 * every cell of a sample whose GEO record names a cell line (sample term cell_line, Cellosaurus CVCL_xxxx) gets that line as its
 * cell type, and a sample marked tissue_type "cell line" without a named line gets CL:0000010 "cultured cell". Each line is
 * listed under "cultured cell", so a query for "cultured cell" finds them all, while a Cell Ontology query for a primary type
 * (T cell, hepatocyte ...) never returns cell-line cells.
 *
 * The index on R2 keeps the labeller's codes; this rewrites the in-memory copy once per (index version, facts build).
 */
import type { CellIndex, IndexDictEntry } from "./atlas-index";
import { TISSUE_TYPES, type SampleFacts } from "./sample-facts";

export const CULTURED_CELL = "CL:0000010";
const CULTURED_CELL_LABEL = "cultured cell";

export interface CellLineIndex extends CellIndex {
  /** GSM accession -> the cell-type code every cell of that cell-line sample carries here */
  lineCode: Map<string, number>;
  /** codes that stand for a cell line (CL:0000010 included) */
  lineCodes: Set<number>;
}

let memo: { key: string; idx: CellLineIndex } | null = null;

/** The sample -> cell line (or CL:0000010) of every cell-line sample in the facts. */
export function cellLineOf(facts: SampleFacts): Map<number, string> {
  const out = new Map<number, string>();
  for (const [term, samples] of facts.termSamples.get("cell_line") ?? []) for (const i of samples) if (!out.has(i)) out.set(i, term);
  const lineType = (TISSUE_TYPES as readonly string[]).indexOf("cell line") + 1;
  for (let i = 0; i < facts.n; i++) if (!out.has(i) && facts.tissue_type?.[i] === lineType) out.set(i, CULTURED_CELL);
  return out;
}

export function withCellLines(idx: CellIndex, facts: SampleFacts): CellLineIndex {
  const key = `${idx.version}|${facts.built_at}`;
  if (memo?.key === key) return memo.idx;
  const lines = cellLineOf(facts);
  const cellTypes: IndexDictEntry[] = idx.cellTypes.slice();
  const codeOf = new Map<string, number>();
  for (const e of cellTypes) if (e.id) codeOf.set(e.id, e.code);
  // a code is its position in the dictionary (0 is "unknown"), so new entries continue after the last one
  let next = cellTypes.reduce((m, e) => Math.max(m, e.code), 0) + 1;
  const code = (term: string): number => {
    let c = codeOf.get(term);
    if (c === undefined) {
      c = next++;
      const label = term === CULTURED_CELL ? CULTURED_CELL_LABEL : (facts.labels[term] ?? term);
      cellTypes.push({ code: c, id: term, label, anc: term === CULTURED_CELL ? [] : [CULTURED_CELL] });
      codeOf.set(term, c);
    }
    return c;
  };
  const lineCode = new Map<string, number>();
  const bySo = new Int32Array(idx.maxSo + 1);
  for (let so = 0; so <= idx.maxSo; so++) {
    const g = idx.gsmOf[so];
    if (!g) continue;
    const si = facts.index.get(`GSM${g}`);
    const term = si === undefined ? undefined : lines.get(si);
    if (term === undefined) continue;
    const c = code(term);
    bySo[so] = c;
    lineCode.set(`GSM${g}`, c);
  }
  const ct = Uint16Array.from(idx.ct);
  if (lineCode.size) for (let r = 0; r < idx.n; r++) if (bySo[idx.so[r]]) ct[r] = bySo[idx.so[r]];
  const lineCodes = new Set(lineCode.values());
  const terms: Record<string, string> = { ...idx.terms, [CULTURED_CELL]: CULTURED_CELL_LABEL };
  for (const e of cellTypes.slice(idx.cellTypes.length)) if (e.id) terms[e.id] = e.label;
  const out: CellLineIndex = { ...idx, cellTypes, ct, terms, lineCode, lineCodes };
  memo = { key, idx: out };
  return out;
}

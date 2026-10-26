/**
 * SQL batch files that load the .s1 per-cell label aggregates into the catalog (schema/039) and derive the searchable facts.
 * Pure functions; the command line is ./load-labels.ts.
 *
 * Inputs, both written by the atlas cell index build on Clipper (Singlet-Bio/singlet scripts/s1_cidx_build.py --d1-export, run on
 * the campaign's .s1 objects and label sidecars; docs/format-s1-cell-index.md 4.10):
 *   sample_cell_summary.csv   gsm_id, gse_id, subject, item, n_cells, n_hi1, n_hi2, q50, q90, mean, version
 *   v/<version>.json          the index directory: its cell_type / ancestry dictionaries ({id, label, anc}) give label_term and the
 *                             ancestor pairs for ontology_closure
 *
 * Files, applied in name order (each file is atomic):
 *   0_terms.sql          label_term upserts, ontology_closure pairs (INSERT OR IGNORE)
 *   1_summary_NNNN.sql   per chunk of studies: their label rows of sample_cell_summary replaced
 *   2_facts_NNNN.sql     per chunk of studies: sample_attr label facts and study_label rebuilt (functions/_shared/s1-labels.ts)
 */
import { labelFactsSql, studyLabelSql } from "../../functions/_shared/s1-labels";

export const LABEL_SUBJECTS = new Set(["cell_type", "sex", "ancestry"]);
const COLUMNS = ["gsm_id", "gse_id", "subject", "item", "n_cells", "n_hi1", "n_hi2", "q50", "q90", "mean", "version"] as const;
const ITEM_RE: Record<string, RegExp> = { cell_type: /^CL:\d{7}$/, sex: /^PATO:\d{7}$/, ancestry: /^HANCESTRO:\d{4}$/ };
const TERM_RE = /^(CL:\d{7}|HANCESTRO:\d{4})$/;
/** D1 refuses statements over 100 KB. */
const MAX_STATEMENT = 90_000;

export interface SummaryRow {
  gsm_id: string;
  gse_id: string;
  subject: string;
  item: string;
  n_cells: number;
  n_hi1: number | null;
  n_hi2: number | null;
  q50: number | null;
  q90: number | null;
  mean: number | null;
  version: string;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (s: string | undefined): number | null => (s === undefined || s.trim() === "" ? null : Number.isFinite(Number(s)) ? Number(s) : null);

/** Label rows of sample_cell_summary.csv (feature rows are skipped); `rejected` lists lines that do not parse. */
export function parseSummaryCsv(text: string): { rows: SummaryRow[]; rejected: string[]; skipped: number } {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  const rows: SummaryRow[] = [];
  const rejected: string[] = [];
  let skipped = 0;
  if (!lines.length) return { rows, rejected, skipped };
  const head = splitCsvLine(lines[0]);
  const at = Object.fromEntries(COLUMNS.map((c) => [c, head.indexOf(c)]));
  for (const c of COLUMNS) if (at[c] < 0) return { rows, rejected: [`header has no column '${c}'`], skipped };
  for (let i = 1; i < lines.length; i++) {
    const f = splitCsvLine(lines[i]);
    const get = (c: (typeof COLUMNS)[number]) => f[at[c]];
    const subject = get("subject");
    if (!LABEL_SUBJECTS.has(subject)) {
      skipped++;
      continue;
    }
    const n = Number(get("n_cells"));
    const row: SummaryRow = {
      gsm_id: get("gsm_id"),
      gse_id: get("gse_id"),
      subject,
      item: get("item"),
      n_cells: n,
      n_hi1: num(get("n_hi1")),
      n_hi2: num(get("n_hi2")),
      q50: num(get("q50")),
      q90: num(get("q90")),
      mean: num(get("mean")),
      version: get("version") ?? "",
    };
    if (!/^GSM\d+$/.test(row.gsm_id) || !/^GSE\d+$/.test(row.gse_id) || !ITEM_RE[subject].test(row.item) || !Number.isInteger(n) || n < 0 || !row.version) {
      rejected.push(`line ${i + 1}: ${lines[i].slice(0, 160)}`);
      continue;
    }
    rows.push(row);
  }
  return { rows, rejected, skipped };
}

interface DictEntry {
  id: string | null;
  label?: string;
  anc?: string[];
}

/** label_term rows and closure pairs from an index directory JSON (dicts.cell_type, dicts.ancestry). */
export function termsFromDirectory(dir: unknown): { terms: { id: string; subject: string; label: string }[]; closure: [string, string, number][] } {
  const d = (dir ?? {}) as { dicts?: Record<string, DictEntry[]> };
  const terms: { id: string; subject: string; label: string }[] = [];
  const closure: [string, string, number][] = [];
  for (const subject of ["cell_type", "ancestry"] as const) {
    for (const e of d.dicts?.[subject] ?? []) {
      if (!e.id || !TERM_RE.test(e.id)) continue;
      terms.push({ id: e.id, subject, label: (e.label || e.id).slice(0, 200) });
      if (subject !== "cell_type") continue;
      closure.push([e.id, e.id, 0]);
      (e.anc ?? []).forEach((a, k) => {
        if (TERM_RE.test(a)) closure.push([e.id!, a, k + 1]);
      });
    }
  }
  return { terms, closure };
}

const lit = (v: string | number | null): string => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`);

/** Multi-row INSERTs of at most MAX_STATEMENT bytes each. */
function inserts(prefix: string, tuples: string[], suffix = ""): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let size = prefix.length + suffix.length;
  for (const t of tuples) {
    if (cur.length && size + t.length + 2 > MAX_STATEMENT) {
      out.push(`${prefix}\n${cur.join(",\n")}${suffix};`);
      cur = [];
      size = prefix.length + suffix.length;
    }
    cur.push(t);
    size += t.length + 2;
  }
  if (cur.length) out.push(`${prefix}\n${cur.join(",\n")}${suffix};`);
  return out;
}

export interface LabelSqlPlan {
  files: { name: string; sql: string }[];
  studies: number;
  samples: number;
  rows: number;
  /** Rough D1 row writes (rows + indexes, facts estimated at 4 per sample). */
  estWrites: number;
}

export function buildLabelSqlFiles(rows: SummaryRow[], dir: unknown | null, opts: { studiesPerFile?: number } = {}): LabelSqlPlan {
  const per = opts.studiesPerFile ?? 50;
  const files: { name: string; sql: string }[] = [];
  if (dir) {
    const { terms, closure } = termsFromDirectory(dir);
    const stmts = [
      ...inserts(
        "INSERT INTO label_term (term_id, subject, label) VALUES",
        terms.map((t) => `(${lit(t.id)}, ${lit(t.subject)}, ${lit(t.label)})`),
        "\nON CONFLICT(term_id) DO UPDATE SET label = excluded.label, subject = excluded.subject, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"
      ),
      ...inserts("INSERT OR IGNORE INTO ontology_closure (term_id, ancestor_id, distance) VALUES", closure.map(([t, a, k]) => `(${lit(t)}, ${lit(a)}, ${k})`)),
    ];
    if (stmts.length) files.push({ name: "0_terms.sql", sql: stmts.join("\n") + "\n" });
  }
  const byGse = new Map<string, SummaryRow[]>();
  for (const r of rows) {
    const l = byGse.get(r.gse_id) ?? [];
    l.push(r);
    byGse.set(r.gse_id, l);
  }
  const gses = [...byGse.keys()].sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
  for (let i = 0, k = 0; i < gses.length; i += per, k++) {
    const chunk = gses.slice(i, i + per);
    const ids = chunk.map((g) => `'${g}'`).join(", ");
    const tuples = chunk.flatMap((g) =>
      byGse.get(g)!.map((r) => `(${[r.gsm_id, r.gse_id, r.subject, r.item, r.n_cells, r.n_hi1, r.n_hi2, r.q50, r.q90, r.mean, r.version].map(lit).join(", ")})`)
    );
    const summary = [
      `DELETE FROM sample_cell_summary WHERE subject IN ('cell_type', 'sex', 'ancestry') AND gse_id IN (${ids});`,
      ...inserts("INSERT INTO sample_cell_summary (gsm_id, gse_id, subject, item, n_cells, n_hi1, n_hi2, q50, q90, mean, version) VALUES", tuples,
        "\nON CONFLICT(subject, item, gsm_id) DO UPDATE SET gse_id = excluded.gse_id, n_cells = excluded.n_cells, n_hi1 = excluded.n_hi1, n_hi2 = excluded.n_hi2, q50 = excluded.q50, q90 = excluded.q90, mean = excluded.mean, version = excluded.version, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"),
    ];
    const tag = String(k).padStart(4, "0");
    files.push({ name: `1_summary_${tag}.sql`, sql: summary.join("\n") + "\n" });
    files.push({ name: `2_facts_${tag}.sql`, sql: [...labelFactsSql(chunk), ...studyLabelSql(chunk)].join("\n") + "\n" });
  }
  const samples = new Set(rows.map((r) => r.gsm_id)).size;
  return { files, studies: gses.length, samples, rows: rows.length, estWrites: rows.length * 3 + samples * 4 * 4 };
}

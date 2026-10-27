/**
 * What a D1 write costs, so that nothing writes to production without a number in front of the owner.
 *
 * D1 bills rows written: the row itself, one row per secondary index touched, and the FTS5 shadow rows a trigger writes
 * (Workers Paid: first 50 million a month included, then $1.00 per million). The Sep 27 - Oct 26 2026 cycle wrote 419M rows
 * into a 430 MB database: $370 of a $429.74 bill. See docs/CLOUDFLARE_COST_PLAN.md.
 *
 * No dependencies and only erasable TypeScript, so scripts/hooks/d1-write-approval.mjs imports it under
 * `node --experimental-strip-types`, and the Pages Functions import it normally.
 */

export const D1_INCLUDED_ROWS_PER_MONTH = 50_000_000;
export const D1_USD_PER_MILLION_ROWS = 1.0;

/**
 * Rows written per row inserted or updated, by table. gsm: the row + 15 secondary indexes + the fts_gsm shadow rows when a text
 * column changes (about 30 measured from the query insights). Conservative round numbers; the D1 dashboard's "Rows written" is the
 * truth, and `meta.rows_written` on a D1 result is exact per call.
 */
export const ROWS_PER_WRITE: Record<string, number> = {
  gsm: 30,
  gse: 10,
  gse_meta: 4,
  sample_attr: 5,
  sample_qc: 4,
  sample_term: 3,
  s1_sample: 3,
  s1_study: 2,
  bundle_manifest: 3,
  bundle_index: 2,
  pz_chunk_index: 3,
  study_card: 3,
};
export const DEFAULT_ROWS_PER_WRITE = 4;

export type WriteKind = "insert" | "update" | "delete" | "ddl" | "other";

export interface StatementEstimate {
  kind: WriteKind;
  table: string;
  /** rows the statement inserts / touches: counted from VALUES tuples for an INSERT, assumed 1 for UPDATE and DELETE */
  rows: number;
  /** estimated D1 rows written, after amplification */
  written: number;
  /** true when the row count is a guess (UPDATE / DELETE / INSERT ... SELECT) */
  guessed: boolean;
}

export interface SqlEstimate {
  statements: number;
  written: number;
  guessed: boolean;
  byTable: Record<string, number>;
}

export function amplification(table: string): number {
  return ROWS_PER_WRITE[table] ?? DEFAULT_ROWS_PER_WRITE;
}

/** Split SQL text on `;` outside quotes. Single quotes ('' escapes), double quotes and -- comments are respected. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (q) {
      cur += c;
      if (c === q) {
        if (sql[i + 1] === q) cur += sql[++i];
        else q = null;
      }
    } else if (c === "'" || c === '"') {
      q = c;
      cur += c;
    } else if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
    } else if (c === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Number of top-level `(...)` tuples after the first VALUES keyword, outside quotes. */
function countTuples(stmt: string): number {
  const m = /\bVALUES\b/i.exec(stmt);
  if (!m) return 0;
  let n = 0;
  let depth = 0;
  let q: string | null = null;
  for (let i = m.index + m[0].length; i < stmt.length; i++) {
    const c = stmt[i];
    if (q) {
      if (c === q) {
        if (stmt[i + 1] === q) i++;
        else q = null;
      }
    } else if (c === "'" || c === '"') q = c;
    else if (c === "(") {
      if (depth++ === 0) n++;
    } else if (c === ")") depth--;
    else if (depth === 0 && c.toUpperCase() === "O" && /^ON\s+CONFLICT\b/i.test(stmt.slice(i, i + 12))) break;
  }
  return n;
}

export function estimateStatement(stmt: string): StatementEstimate {
  const s = stmt.trim();
  const ident = String.raw`[\w."\x60\[\]]+`;
  const unq = (t: string) => t.replace(/^.*\./, "").replace(/["\x60\[\]]/g, "");
  let m: RegExpExecArray | null;
  if ((m = new RegExp(String.raw`^(?:INSERT(?:\s+OR\s+\w+)?|REPLACE)\s+INTO\s+(${ident})`, "i").exec(s))) {
    const table = unq(m[1]);
    const tuples = countTuples(s);
    const rows = tuples || 1;
    return { kind: "insert", table, rows, written: rows * amplification(table), guessed: tuples === 0 };
  }
  if ((m = new RegExp(String.raw`^UPDATE(?:\s+OR\s+\w+)?\s+(${ident})`, "i").exec(s))) {
    const table = unq(m[1]);
    return { kind: "update", table, rows: 1, written: amplification(table), guessed: true };
  }
  if ((m = new RegExp(String.raw`^DELETE\s+FROM\s+(${ident})`, "i").exec(s))) {
    const table = unq(m[1]);
    return { kind: "delete", table, rows: 1, written: amplification(table), guessed: true };
  }
  if (/^(CREATE|DROP|ALTER)\b/i.test(s)) return { kind: "ddl", table: "(schema)", rows: 1, written: 2, guessed: false };
  return { kind: "other", table: "", rows: 0, written: 0, guessed: false };
}

export function estimateSql(sql: string): SqlEstimate {
  const byTable: Record<string, number> = {};
  let written = 0;
  let guessed = false;
  let statements = 0;
  for (const st of splitStatements(sql)) {
    const e = estimateStatement(st);
    if (e.kind === "other") continue;
    statements++;
    written += e.written;
    guessed ||= e.guessed;
    byTable[e.table] = (byTable[e.table] ?? 0) + e.written;
  }
  return { statements, written, guessed, byTable };
}

/** Estimated rows written when `n` rows are upserted into `table` through a bound-parameter statement. */
export function estimateRows(table: string, n: number): number {
  return Math.max(0, Math.ceil(n)) * amplification(table);
}

export interface Cost {
  rows: number;
  /** $ if the monthly 50M included rows are already used up (the worst case, and the number to approve) */
  worstUsd: number;
  /** $ if the whole write fits in what is left of the month's included rows (null when unknown) */
  bestUsd: number | null;
}

export function costOf(rows: number, usedThisMonth: number | null = null): Cost {
  const worstUsd = (rows / 1e6) * D1_USD_PER_MILLION_ROWS;
  if (usedThisMonth == null) return { rows, worstUsd, bestUsd: null };
  const over = Math.max(0, usedThisMonth + rows - D1_INCLUDED_ROWS_PER_MONTH) - Math.max(0, usedThisMonth - D1_INCLUDED_ROWS_PER_MONTH);
  return { rows, worstUsd, bestUsd: (over / 1e6) * D1_USD_PER_MILLION_ROWS };
}

export const fmtRows = (n: number): string =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n));

export const fmtUsd = (n: number): string => `$${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString("en-US")}`;

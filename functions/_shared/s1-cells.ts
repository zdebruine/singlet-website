/**
 * Reader and filter for the per-sample cells table of a sample object (docs/format-s1.md section 5.3, member kind 2).
 * A port of the read side of python/singlet/s1/cells.py in the singlet-bio repository; the fixtures in
 * src/test/fixtures/s1 are written by that code.
 *
 * Layout (all integers little-endian):
 *
 *   "CEL2"  u16 version = 1  u16 n_cols  u32 n_rows
 *   n_cols x { u16 name_len, name (UTF-8), u8 dtype, u8 enc, u64 off, u64 len }      off relative to the table start
 *   column bodies, each at a multiple of 64
 *
 *   dtype 1 u8, 2 u16, 3 u32, 4 i32, 5 f32, 6 f64, 7 bool (bitmap, LSB first), 8 string (NUL joined), 9 barcode
 *   enc   0 raw, 1 zstd, 2 delta + zstd (integer columns; wrapping differences)
 *
 * Only what a cell filter needs is decoded: numeric and bool columns. String and barcode columns are listed in the directory but
 * never decoded here.
 *
 * `openCells` reads through a range fetcher (offsets relative to the start of the cells member): a small table (up to
 * `wholeMax`, 1 MiB by default) costs ONE request for the whole member, a large one costs the directory plus one request per
 * column that is asked for. The input is treated as hostile: every offset, length and decoded size is checked against the
 * directory and the row count before anything is allocated, and a table that would need an oversized column is refused.
 *
 * zstd is decoded with `fzstd` (pure JavaScript, MIT), because the runtime has no zstd; Node's zlib is not available in a Pages
 * Function. Frames must carry their content size (the writer always sets it), which bounds the output allocation.
 */
import { decompress } from "fzstd";

export class CellsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CellsError";
  }
}

/** Reads `length` bytes at `offset`, both relative to the start of the cells member. */
export type RangeFetch = (offset: number, length: number) => Promise<Uint8Array>;

export const DT_U8 = 1;
export const DT_U16 = 2;
export const DT_U32 = 3;
export const DT_I32 = 4;
export const DT_F32 = 5;
export const DT_F64 = 6;
export const DT_BOOL = 7;
export const DT_STR = 8;
export const DT_BARCODE = 9;

export interface CellsColumnInfo {
  name: string;
  dtype: number;
  enc: number;
  /** Byte offset of the column body, relative to the start of the cells member. */
  off: number;
  len: number;
}

const MAX_ROWS = 50_000_000;
const MAX_COLUMNS = 4096;
const FIXED = 18; // u8 dtype, u8 enc, u64 off, u64 len
const WIDTH: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 4, 5: 4, 6: 8 };
const DEFAULT_WHOLE_MAX = 1024 * 1024;
const DEFAULT_PREFETCH = 4096;
/** No single decoded column may be larger than this (the Worker has 128 MB in all). */
const MAX_COLUMN_BYTES = 64 * 1024 * 1024;

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const utf8 = new TextDecoder("utf-8");

// ── directory ───────────────────────────────────────────────────────────────

class Short extends Error {}

function u64(dv: DataView, p: number): number {
  const lo = dv.getUint32(p, true);
  const hi = dv.getUint32(p + 4, true);
  if (hi >= 0x200000) throw new CellsError("a 64-bit offset or length in the directory is out of range");
  return hi * 4294967296 + lo;
}

type Parsed = { nRows: number; columns: CellsColumnInfo[] } | { need: number };

function parseDirectory(buf: Uint8Array, totalLen: number): Parsed {
  if (buf.length < 12) throw new CellsError("cells table is shorter than its 12-byte header");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf[0] !== 0x43 || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x32) throw new CellsError("not a cells table (bad magic)");
  const version = dv.getUint16(4, true);
  if (version !== 1) throw new CellsError(`unsupported cells table version ${version}`);
  const nCols = dv.getUint16(6, true);
  const nRows = dv.getUint32(8, true);
  if (nRows > MAX_ROWS) throw new CellsError(`cells table claims ${nRows} rows (limit ${MAX_ROWS})`);
  if (nCols > MAX_COLUMNS) throw new CellsError(`cells table claims ${nCols} columns (limit ${MAX_COLUMNS})`);

  const columns: CellsColumnInfo[] = [];
  const seen = new Set<string>();
  let p = 12;
  try {
    for (let i = 0; i < nCols; i++) {
      if (p + 2 > buf.length) throw new Short();
      const nl = dv.getUint16(p, true);
      p += 2;
      if (p + nl + FIXED > buf.length) throw new Short();
      const name = utf8.decode(buf.subarray(p, p + nl));
      p += nl;
      const dtype = buf[p];
      const enc = buf[p + 1];
      const off = u64(dv, p + 2);
      const len = u64(dv, p + 10);
      p += FIXED;
      if (seen.has(name)) throw new CellsError(`duplicate column '${name}'`);
      seen.add(name);
      if (dtype < 1 || dtype > 9) throw new CellsError(`column '${name}' has an unknown dtype ${dtype}`);
      if (enc > 2) throw new CellsError(`column '${name}' has an unknown encoding ${enc}`);
      if (enc === 2 && (dtype === DT_F32 || dtype === DT_F64 || dtype > DT_I32)) throw new CellsError(`column '${name}': delta encoding is for integer columns`);
      if (dtype === DT_BARCODE && enc !== 0) throw new CellsError(`barcode column '${name}' must have encoding 0`);
      if (off + len > totalLen) throw new CellsError(`column '${name}' runs past the end of the table`);
      const w = WIDTH[dtype];
      if (w !== undefined) {
        if (nRows * w > MAX_COLUMN_BYTES) throw new CellsError(`column '${name}' would decode to more than ${MAX_COLUMN_BYTES} bytes`);
        if (enc === 0 && len !== nRows * w) throw new CellsError(`column '${name}' is ${len} bytes, expected ${nRows * w}`);
      } else if (dtype === DT_BOOL && enc === 0 && len !== Math.ceil(nRows / 8)) {
        throw new CellsError(`column '${name}' is ${len} bytes, expected ${Math.ceil(nRows / 8)}`);
      }
      columns.push({ name, dtype, enc, off, len });
    }
  } catch (e) {
    if (e instanceof Short) {
      // The same bound the writer's reader uses: names of up to 255 bytes. A longer directory is refused after one extension.
      return { need: 12 + nCols * (2 + 255 + FIXED) };
    }
    throw e;
  }
  for (const c of columns) {
    if (c.len > 0 && c.off < p) throw new CellsError(`column '${c.name}' overlaps the directory`);
  }
  return { nRows, columns };
}

// ── zstd with a bounded output ──────────────────────────────────────────────

/** Frame_Content_Size of a zstd frame, or null when the frame does not state it. Rejects dictionaries and reserved bits. */
function zstdContentSize(buf: Uint8Array): number | null {
  if (buf.length < 6) throw new CellsError("truncated zstd frame");
  if (buf[0] !== 0x28 || buf[1] !== 0xb5 || buf[2] !== 0x2f || buf[3] !== 0xfd) throw new CellsError("column body is not a zstd frame");
  const flg = buf[4];
  const fcf = flg >> 6;
  const single = (flg >> 5) & 1;
  const dictFlag = flg & 3;
  if (flg & 8) throw new CellsError("zstd frame uses a reserved bit");
  if (dictFlag !== 0) throw new CellsError("zstd frame needs a dictionary");
  const p = 5 + (single ? 0 : 1);
  const fcsBytes = fcf === 0 ? (single ? 1 : 0) : 1 << fcf;
  if (fcsBytes === 0) return null;
  if (buf.length < p + fcsBytes) throw new CellsError("truncated zstd frame header");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let v: number;
  if (fcsBytes === 1) v = buf[p];
  else if (fcsBytes === 2) v = dv.getUint16(p, true) + 256;
  else if (fcsBytes === 4) v = dv.getUint32(p, true);
  else {
    const hi = dv.getUint32(p + 4, true);
    v = hi >= 0x200000 ? Number.POSITIVE_INFINITY : hi * 4294967296 + dv.getUint32(p, true);
  }
  return v;
}

function zstdExact(body: Uint8Array, expected: number, what: string): Uint8Array {
  const size = zstdContentSize(body);
  if (size === null) throw new CellsError(`column '${what}': zstd frame does not state its content size`);
  if (size !== expected) throw new CellsError(`column '${what}' holds ${size} bytes, expected ${expected}`);
  // fzstd sizes its output from the frame's content size, which was just checked against the row count, so the allocation is
  // bounded. Not passing an output buffer matters: with one, fzstd 0.1.1 takes a path that is about 10-40x slower.
  let out: Uint8Array;
  try {
    out = decompress(body);
  } catch (e) {
    throw new CellsError(`column '${what}': corrupt zstd data (${e instanceof Error ? e.message : String(e)})`);
  }
  if (out.length !== expected) throw new CellsError(`column '${what}': zstd data decoded to ${out.length} bytes, expected ${expected}`);
  // fzstd hands back a view 12 bytes into its buffer; typed-array views of 8-byte values need an aligned start.
  return out.byteOffset % 8 === 0 ? out : out.slice();
}

// ── table ───────────────────────────────────────────────────────────────────

export class CellsTable {
  readonly nRows: number;
  readonly columns: CellsColumnInfo[];
  /** Calls made to the range fetcher so far, including the ones that opened the table. */
  requests: number;
  private readonly byName = new Map<string, CellsColumnInfo>();
  private readonly cache = new Map<string, Promise<Float64Array | Uint8Array>>();

  /** Use `openCells`. `head` holds the bytes from offset 0 that were already read. */
  constructor(
    nRows: number,
    columns: CellsColumnInfo[],
    private readonly head: Uint8Array,
    private readonly fetchRange: RangeFetch,
    requests: number
  ) {
    this.nRows = nRows;
    this.columns = columns;
    this.requests = requests;
    for (const c of columns) this.byName.set(c.name, c);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  info(name: string): CellsColumnInfo | undefined {
    return this.byName.get(name);
  }

  private async body(c: CellsColumnInfo): Promise<Uint8Array> {
    if (c.len === 0) return new Uint8Array(0);
    if (c.off + c.len <= this.head.length) return this.head.subarray(c.off, c.off + c.len);
    this.requests++;
    const b = await this.fetchRange(c.off, c.len);
    if (b.length !== c.len) throw new CellsError(`short read of column '${c.name}' (${b.length} of ${c.len} bytes)`);
    return b;
  }

  private require(name: string): CellsColumnInfo {
    const c = this.byName.get(name);
    if (!c) throw new CellsError(`the cells table has no column '${name}'`);
    return c;
  }

  /** Any numeric column (dtype 1-6) widened to float64; u32 and i32 are exact. */
  numeric(name: string): Promise<Float64Array> {
    const c = this.require(name);
    if (WIDTH[c.dtype] === undefined) throw new CellsError(`column '${name}' is not numeric (dtype ${c.dtype})`);
    const key = "n:" + name;
    let p = this.cache.get(key);
    if (!p) {
      p = this.decodeNumeric(c);
      this.cache.set(key, p);
    }
    return p as Promise<Float64Array>;
  }

  /** A bool column (dtype 7) as 0/1 per row. */
  bool(name: string): Promise<Uint8Array> {
    const c = this.require(name);
    if (c.dtype !== DT_BOOL) throw new CellsError(`column '${name}' is not a bool column (dtype ${c.dtype})`);
    const key = "b:" + name;
    let p = this.cache.get(key);
    if (!p) {
      p = this.decodeBool(c);
      this.cache.set(key, p);
    }
    return p as Promise<Uint8Array>;
  }

  private async decodeNumeric(c: CellsColumnInfo): Promise<Float64Array> {
    if (!LITTLE_ENDIAN) throw new CellsError("big-endian runtimes are not supported");
    const n = this.nRows;
    const out = new Float64Array(n);
    if (n === 0) return out;
    const width = WIDTH[c.dtype];
    const body = await this.body(c);
    let raw: Uint8Array;
    if (c.enc === 0) {
      if (body.length !== n * width) throw new CellsError(`column '${c.name}' is ${body.length} bytes, expected ${n * width}`);
      raw = body.byteOffset % width === 0 ? body : body.slice();
    } else {
      raw = zstdExact(body, n * width, c.name);
    }
    const buf = raw.buffer as ArrayBuffer;
    const o = raw.byteOffset;
    switch (c.dtype) {
      case DT_U8: {
        const a = new Uint8Array(buf, o, n);
        if (c.enc === 2) for (let i = 1; i < n; i++) a[i] = a[i - 1] + a[i];
        for (let i = 0; i < n; i++) out[i] = a[i];
        break;
      }
      case DT_U16: {
        const a = new Uint16Array(buf, o, n);
        if (c.enc === 2) for (let i = 1; i < n; i++) a[i] = a[i - 1] + a[i];
        for (let i = 0; i < n; i++) out[i] = a[i];
        break;
      }
      case DT_U32: {
        const a = new Uint32Array(buf, o, n);
        if (c.enc === 2) for (let i = 1; i < n; i++) a[i] = a[i - 1] + a[i]; // the sum is below 2^33: exact, then wrapped by the typed-array store
        for (let i = 0; i < n; i++) out[i] = a[i];
        break;
      }
      case DT_I32: {
        const a = new Int32Array(buf, o, n);
        if (c.enc === 2) for (let i = 1; i < n; i++) a[i] = a[i - 1] + a[i];
        for (let i = 0; i < n; i++) out[i] = a[i];
        break;
      }
      case DT_F32: {
        const a = new Float32Array(buf, o, n);
        for (let i = 0; i < n; i++) out[i] = a[i];
        break;
      }
      default: {
        const a = new Float64Array(buf, o, n);
        out.set(a);
      }
    }
    return out;
  }

  private async decodeBool(c: CellsColumnInfo): Promise<Uint8Array> {
    const n = this.nRows;
    const out = new Uint8Array(n);
    if (n === 0) return out;
    const need = Math.ceil(n / 8);
    const body = await this.body(c);
    let raw: Uint8Array;
    if (c.enc === 0) {
      if (body.length !== need) throw new CellsError(`column '${c.name}' is ${body.length} bytes, expected ${need}`);
      raw = body;
    } else if (c.enc === 1) {
      raw = zstdExact(body, need, c.name);
    } else {
      throw new CellsError(`bool column '${c.name}' cannot be delta encoded`);
    }
    for (let i = 0; i < n; i++) out[i] = (raw[i >> 3] >> (i & 7)) & 1;
    return out;
  }
}

export async function openCells(
  fetchRange: RangeFetch,
  totalLen: number,
  opts: { wholeMax?: number; prefetch?: number } = {}
): Promise<CellsTable> {
  if (!Number.isSafeInteger(totalLen) || totalLen < 12) throw new CellsError("cells table is shorter than its 12-byte header");
  const wholeMax = opts.wholeMax ?? DEFAULT_WHOLE_MAX;
  const prefetch = Math.max(12, opts.prefetch ?? DEFAULT_PREFETCH);
  let requests = 0;
  const get = async (len: number): Promise<Uint8Array> => {
    requests++;
    const b = await fetchRange(0, len);
    if (b.length !== len) throw new CellsError(`short read of the cells table (${b.length} of ${len} bytes)`);
    return b;
  };
  const whole = totalLen <= wholeMax;
  let head = await get(whole ? totalLen : Math.min(totalLen, prefetch));
  let parsed = parseDirectory(head, totalLen);
  if ("need" in parsed) {
    const bound = Math.min(totalLen, parsed.need);
    if (bound <= head.length) throw new CellsError("the column directory is truncated");
    head = await get(bound); // extended once
    parsed = parseDirectory(head, totalLen);
    if ("need" in parsed) {
      throw new CellsError(head.length >= totalLen ? "the column directory is truncated" : "the column directory is longer than its bound");
    }
  }
  return new CellsTable(parsed.nRows, parsed.columns, head, fetchRange, requests);
}

export async function cellsSummary(table: CellsTable): Promise<{ nRows: number; columns: { name: string; dtype: number; enc: number }[] }> {
  return { nRows: table.nRows, columns: table.columns.map((c) => ({ name: c.name, dtype: c.dtype, enc: c.enc })) };
}

// ── filter ──────────────────────────────────────────────────────────────────

export type WhereOp = ">=" | "<=" | ">" | "<" | "==" | "!=";
export interface CellWhere {
  column: string;
  op: WhereOp;
  value: number;
}

/**
 * umi = n_umi_exon + n_umi_intron and features = max(n_feat_exon, n_feat_intron), the quantities `stats()` in cells.py takes
 * medians of. `called_only` defaults to true (column `called`). `where` clauses compare any numeric or bool column.
 */
export interface CellFilter {
  called_only?: boolean;
  min_umi?: number;
  max_umi?: number;
  min_features?: number;
  max_features?: number;
  where?: CellWhere[];
}

const FILTER_KEYS = new Set(["called_only", "min_umi", "max_umi", "min_features", "max_features", "where"]);
const OPS = new Set<string>([">=", "<=", ">", "<", "==", "!="]);
const COLUMN_RE = /^[A-Za-z0-9_.-]{1,64}$/;
export const MAX_WHERE = 6;

export function parseCellFilter(input: unknown): { filter: CellFilter } | { error: string } {
  if (input === undefined || input === null) return { filter: {} };
  if (typeof input !== "object" || Array.isArray(input)) return { error: "cell_filter must be an object" };
  const src = input as Record<string, unknown>;
  for (const k of Object.keys(src)) {
    if (!FILTER_KEYS.has(k)) return { error: `unknown cell_filter key '${k}' (allowed: ${[...FILTER_KEYS].join(", ")})` };
  }
  const filter: CellFilter = {};
  if (src.called_only !== undefined) {
    if (typeof src.called_only !== "boolean") return { error: "called_only must be true or false" };
    filter.called_only = src.called_only;
  }
  for (const k of ["min_umi", "max_umi", "min_features", "max_features"] as const) {
    const v = src[k];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) return { error: `${k} must be a finite number` };
    filter[k] = v;
  }
  if (src.where !== undefined) {
    if (!Array.isArray(src.where)) return { error: "where must be an array of {column, op, value}" };
    if (src.where.length > MAX_WHERE) return { error: `where takes at most ${MAX_WHERE} clauses` };
    const where: CellWhere[] = [];
    for (const [i, w] of src.where.entries()) {
      if (typeof w !== "object" || w === null || Array.isArray(w)) return { error: `where[${i}] must be an object` };
      const rec = w as Record<string, unknown>;
      for (const k of Object.keys(rec)) if (k !== "column" && k !== "op" && k !== "value") return { error: `where[${i}]: unknown key '${k}'` };
      if (typeof rec.column !== "string" || !COLUMN_RE.test(rec.column)) return { error: `where[${i}].column must match ${COLUMN_RE.source}` };
      if (typeof rec.op !== "string" || !OPS.has(rec.op)) return { error: `where[${i}].op must be one of ${[...OPS].join(" ")}` };
      if (typeof rec.value !== "number" || !Number.isFinite(rec.value)) return { error: `where[${i}].value must be a finite number` };
      where.push({ column: rec.column, op: rec.op as WhereOp, value: rec.value });
    }
    filter.where = where;
  }
  return { filter };
}

export interface FilterResult {
  nRows: number;
  /** Exact number of matching rows, whatever `maxRuns` is. */
  nMatch: number;
  /** Flat [start, length, start, length, ...] over ascending rows; at most `maxRuns` runs. */
  runs: number[];
  runsTruncated: boolean;
  columnsUsed: string[];
}

/** A flag or numeric column as float64 (bool and numeric dtypes). */
async function values(table: CellsTable, name: string, why: string): Promise<Float64Array> {
  const c = table.info(name);
  if (!c) throw new CellsError(`the cells table has no column '${name}' (needed by ${why})`);
  if (c.dtype === DT_BOOL) {
    const b = await table.bool(name);
    const out = new Float64Array(b.length);
    for (let i = 0; i < b.length; i++) out[i] = b[i];
    return out;
  }
  if (WIDTH[c.dtype] === undefined) throw new CellsError(`column '${name}' is not numeric (needed by ${why})`);
  return table.numeric(name);
}

function compare(op: WhereOp, a: number, b: number): boolean {
  switch (op) {
    case ">=":
      return a >= b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    case "<":
      return a < b;
    case "==":
      return a === b;
    default:
      return a !== b;
  }
}

export async function filterCells(table: CellsTable, filter: CellFilter, opts: { maxRuns?: number } = {}): Promise<FilterResult> {
  const maxRuns = Math.max(0, Math.floor(opts.maxRuns ?? 500));
  const n = table.nRows;
  const used: string[] = [];
  const need = (name: string, why: string) => {
    if (!table.has(name)) throw new CellsError(`the cells table has no column '${name}' (needed by ${why})`);
    if (!used.includes(name)) used.push(name);
  };

  const calledOnly = filter.called_only !== false;
  const wantUmi = filter.min_umi !== undefined || filter.max_umi !== undefined;
  const wantFeat = filter.min_features !== undefined || filter.max_features !== undefined;
  const where = filter.where ?? [];
  // Check every needed column before fetching any, so a missing one costs no request.
  if (calledOnly) need("called", "called_only");
  if (wantUmi) {
    need("n_umi_exon", "min_umi/max_umi");
    need("n_umi_intron", "min_umi/max_umi");
  }
  if (wantFeat) {
    need("n_feat_exon", "min_features/max_features");
    need("n_feat_intron", "min_features/max_features");
  }
  for (const w of where) need(w.column, `where ${w.column} ${w.op} ${w.value}`);

  const cols = new Map<string, Float64Array>();
  await Promise.all(used.map(async (name) => void cols.set(name, await values(table, name, "the filter"))));

  const mask = new Uint8Array(n).fill(1);
  if (calledOnly) {
    const c = cols.get("called")!;
    for (let i = 0; i < n; i++) if (c[i] === 0) mask[i] = 0;
  }
  if (wantUmi) {
    const e = cols.get("n_umi_exon")!;
    const t = cols.get("n_umi_intron")!;
    const lo = filter.min_umi ?? Number.NEGATIVE_INFINITY;
    const hi = filter.max_umi ?? Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const u = e[i] + t[i];
      if (!(u >= lo && u <= hi)) mask[i] = 0;
    }
  }
  if (wantFeat) {
    const e = cols.get("n_feat_exon")!;
    const t = cols.get("n_feat_intron")!;
    const lo = filter.min_features ?? Number.NEGATIVE_INFINITY;
    const hi = filter.max_features ?? Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const f = e[i] > t[i] ? e[i] : t[i];
      if (!(f >= lo && f <= hi)) mask[i] = 0;
    }
  }
  for (const w of where) {
    const c = cols.get(w.column)!;
    for (let i = 0; i < n; i++) if (mask[i] && !compare(w.op, c[i], w.value)) mask[i] = 0;
  }

  const runs: number[] = [];
  let nMatch = 0;
  let truncated = false;
  let prev = false;
  let start = -1;
  for (let i = 0; i < n; i++) {
    const ok = mask[i] === 1;
    if (ok) {
      nMatch++;
      if (!prev) {
        if (runs.length / 2 < maxRuns) start = i;
        else {
          truncated = true;
          start = -1;
        }
      }
    } else if (prev && start >= 0) {
      runs.push(start, i - start);
      start = -1;
    }
    prev = ok;
  }
  if (prev && start >= 0) runs.push(start, n - start);
  return { nRows: n, nMatch, runs, runsTruncated: truncated, columnsUsed: used };
}

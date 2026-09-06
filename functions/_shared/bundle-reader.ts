/**
 * Read inside a published `.singlet` bundle without downloading it.
 *
 * Every bundle is a zip64 archive served publicly at
 * `https://data.singlet.bio/data/<GSE>/<GSE>.singlet` with `Accept-Ranges:
 * bytes`, so the central directory (and any single small entry) can be pulled
 * with a couple of HTTP Range requests. There is no R2 binding wired into the
 * Pages project for reads (wrangler.toml binds SINGLET_DATA for writes only,
 * and Pages Functions here run without it in preview), so we always go through
 * the public HTTPS endpoint — Cloudflare serves it from cache.
 *
 * The parsed index is memoised per study in the D1 table `bundle_index`
 * (created on demand, once per isolate).
 */
import { bundleUrl } from "./study-core";

/** One central-directory entry, kept deliberately short — it is stored as JSON. */
export interface ZipEntry {
  /** path inside the archive */
  p: string;
  /** compression method: 0 = stored, 8 = deflate */
  n: number;
  /** compressed size */
  c: number;
  /** uncompressed size */
  u: number;
  /** local header offset */
  o: number;
}

export interface BundleIndex {
  gse_id: string;
  bytes: number;
  entries: ZipEntry[];
  indexed_at: string;
}

/** Never inflate anything bigger than this; hand back a range recipe instead. */
export const MAX_INFLATE_BYTES = 4 * 1024 * 1024;

const EOCD_SIG = 0x06054b50;
const ZIP64_LOC_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const CEN_SIG = 0x02014b50;
const TAIL_BYTES = 256 * 1024;

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ── HTTP range helpers ──────────────────────────────────────────────────────

async function headSize(url: string): Promise<number> {
  const res = await fetch(url, { method: "HEAD" });
  if (!res.ok) throw new Error(`HEAD ${res.status} for ${url}`);
  const len = Number(res.headers.get("content-length") ?? "0");
  if (!Number.isFinite(len) || len <= 0) throw new Error(`No content-length for ${url}`);
  return len;
}

/** Inclusive byte range. */
async function fetchRange(url: string, start: number, end: number): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (res.status !== 206 && res.status !== 200) throw new Error(`Range ${res.status} for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

export interface BundleByteSource {
  size(): Promise<number>;
  range(start: number, end: number): Promise<Uint8Array>;
}

export function httpBundleSource(url: string): BundleByteSource {
  return { size: () => headSize(url), range: (start, end) => fetchRange(url, start, end) };
}

export function r2BundleSource(bucket: R2Bucket, key: string): BundleByteSource {
  return {
    async size() {
      const head = await bucket.head(key);
      if (!head) throw new Error("File not found");
      return head.size;
    },
    async range(start, end) {
      const object = await bucket.get(key, { range: { offset: start, length: end - start + 1 } });
      if (!object) throw new Error("File not found");
      return new Uint8Array(await object.arrayBuffer());
    },
  };
}

// ── little-endian readers ───────────────────────────────────────────────────

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u64 = (b: Uint8Array, o: number) => Number(new DataView(b.buffer, b.byteOffset + o, 8).getBigUint64(0, true));

const decoder = new TextDecoder();

// ── central-directory parse ─────────────────────────────────────────────────

export async function parseZipSource(source: BundleByteSource): Promise<{ bytes: number; entries: ZipEntry[] }> {
  const bytes = await source.size();
  const tailLen = Math.min(TAIL_BYTES, bytes);
  const tail = await source.range(bytes - tailLen, bytes - 1);

  // EOCD: scan backwards for the signature.
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("End of central directory not found");

  let nEntries = u16(tail, eocd + 10);
  let cdSize = u32(tail, eocd + 12);
  let cdOffset = u32(tail, eocd + 16);

  const needsZip64 = nEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff;
  if (needsZip64) {
    const locAt = eocd - 20;
    if (locAt < 0 || u32(tail, locAt) !== ZIP64_LOC_SIG) throw new Error("zip64 locator not found");
    const z64Offset = u64(tail, locAt + 8);
    // The zip64 EOCD record may or may not be inside the tail we already have.
    const tailStart = bytes - tailLen;
    const rec =
      z64Offset >= tailStart ? tail.subarray(z64Offset - tailStart) : await source.range(z64Offset, z64Offset + 55);
    if (u32(rec, 0) !== ZIP64_EOCD_SIG) throw new Error("zip64 EOCD record not found");
    nEntries = u64(rec, 32);
    cdSize = u64(rec, 40);
    cdOffset = u64(rec, 48);
  }

  const cd = await source.range(cdOffset, cdOffset + cdSize - 1);
  const entries: ZipEntry[] = [];
  let p = 0;
  while (p + 46 <= cd.length && u32(cd, p) === CEN_SIG) {
    const method = u16(cd, p + 10);
    let csz = u32(cd, p + 20);
    let usz = u32(cd, p + 24);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    let off = u32(cd, p + 42);
    const name = decoder.decode(cd.subarray(p + 46, p + 46 + nameLen));

    if (usz === 0xffffffff || csz === 0xffffffff || off === 0xffffffff) {
      // zip64 extra field 0x0001: sizes appear in order uncompressed, compressed, offset,
      // and only for the fields that were 0xFFFFFFFF.
      let e = p + 46 + nameLen;
      const extraEnd = e + extraLen;
      while (e + 4 <= extraEnd) {
        const id = u16(cd, e);
        const size = u16(cd, e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (usz === 0xffffffff) {
            usz = u64(cd, q);
            q += 8;
          }
          if (csz === 0xffffffff) {
            csz = u64(cd, q);
            q += 8;
          }
          if (off === 0xffffffff) {
            off = u64(cd, q);
            q += 8;
          }
          break;
        }
        e += 4 + size;
      }
    }

    if (!name.endsWith("/")) entries.push({ p: name, n: method, c: csz, u: usz, o: off });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { bytes, entries };
}

export async function parseZipIndex(url: string): Promise<{ bytes: number; entries: ZipEntry[] }> {
  return parseZipSource(httpBundleSource(url));
}

// ── D1 index cache ──────────────────────────────────────────────────────────

let ensured = false;
let indexesEnsured = false;
async function ensureTables(db: D1Database): Promise<void> {
  if (ensured) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS bundle_index (
         gse_id TEXT PRIMARY KEY, bytes INTEGER, entries TEXT, indexed_at TEXT
       )`
    )
    .run();
  ensured = true;
}

export async function ensureSampleQcTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS sample_qc (
         gsm_id TEXT PRIMARY KEY, gse_id TEXT, protocol TEXT, reference_build TEXT,
         n_input_reads INTEGER, uniquely_mapped_pct REAL, n_cells_called INTEGER,
         median_umi REAL, median_genes REAL, mapping_rate REAL, exonic_fraction REAL,
         intronic_fraction REAL, sequencing_saturation REAL, median_mito_fraction REAL,
         fraction_reads_in_cells REAL, total_genes_detected INTEGER, singlet_version TEXT,
         updated_at TEXT
       )`
    )
    .run();
  if (!indexesEnsured) {
    indexesEnsured = true;
    await db.batch([
      db.prepare("CREATE INDEX IF NOT EXISTS idx_gse_meta_year ON gse_meta(year)"),
      db.prepare("CREATE INDEX IF NOT EXISTS idx_bundle_manifest_samples_reference ON bundle_manifest(n_gsms_in_bundle, reference_build)"),
      db.prepare("CREATE INDEX IF NOT EXISTS idx_sample_qc_gse_protocol ON sample_qc(gse_id, protocol)"),
    ]).catch(() => undefined);
  }
}

/** Parsed index for a study, from D1 when we have it, otherwise over the wire. */
export async function getBundleIndex(
  db: D1Database,
  gse: string,
  opts: { refresh?: boolean; waitUntil?: (p: Promise<unknown>) => void } = {}
): Promise<BundleIndex> {
  await ensureTables(db).catch(() => undefined);
  if (!opts.refresh) {
    const row = await db
      .prepare(`SELECT gse_id, bytes, entries, indexed_at FROM bundle_index WHERE gse_id = ?`)
      .bind(gse)
      .first<{ gse_id: string; bytes: number; entries: string; indexed_at: string }>()
      .catch(() => null);
    if (row?.entries) {
      try {
        return { gse_id: gse, bytes: Number(row.bytes ?? 0), entries: JSON.parse(row.entries), indexed_at: row.indexed_at };
      } catch {
        /* re-index */
      }
    }
  }

  const url = bundleUrl(gse);
  const { bytes, entries } = await parseZipIndex(url);
  const indexed_at = nowIso();
  const write = db
    .prepare(
      `INSERT INTO bundle_index (gse_id, bytes, entries, indexed_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(gse_id) DO UPDATE SET bytes = excluded.bytes, entries = excluded.entries, indexed_at = excluded.indexed_at`
    )
    .bind(gse, bytes, JSON.stringify(entries), indexed_at)
    .run()
    .catch(() => undefined);
  if (opts.waitUntil) opts.waitUntil(write);
  else await write;
  return { gse_id: gse, bytes, entries, indexed_at };
}

// ── entry reads ─────────────────────────────────────────────────────────────

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** Fetch + inflate one entry. Throws when it is larger than MAX_INFLATE_BYTES. */
export async function readEntryFromSource(source: BundleByteSource, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.u > MAX_INFLATE_BYTES) throw new Error(`Entry ${entry.p} is ${entry.u} bytes (limit ${MAX_INFLATE_BYTES})`);
  // One request covers the local header (30 + name + extra, extra ≤ 512 in practice) and the data.
  const start = entry.o;
  const end = entry.o + 30 + 512 + entry.c + 512;
  const blob = await source.range(start, end);
  const nameLen = u16(blob, 26);
  const extraLen = u16(blob, 28);
  const dataStart = 30 + nameLen + extraLen;
  const raw = blob.subarray(dataStart, dataStart + entry.c);
  return entry.n === 8 ? inflateRaw(raw) : raw;
}


export async function readEntry(gse: string, entry: ZipEntry): Promise<Uint8Array> {
  return readEntryFromSource(httpBundleSource(bundleUrl(gse)), entry);
}

export async function readEntryText(gse: string, entry: ZipEntry): Promise<string> {
  return decoder.decode(await readEntry(gse, entry));
}

/**
 * Byte range of an entry's *compressed* payload, for a caller that wants to
 * pull it themselves (the big `.1pz` matrices). Requires one small read of the
 * local header to learn its true length.
 */
export async function entryRange(gse: string, entry: ZipEntry): Promise<{ url: string; start: number; end: number }> {
  const url = bundleUrl(gse);
  const head = await fetchRange(url, entry.o, entry.o + 29);
  const start = entry.o + 30 + u16(head, 26) + u16(head, 28);
  return { url, start, end: start + entry.c - 1 };
}

export async function entryPayloadRange(source: BundleByteSource, entry: ZipEntry): Promise<{ start: number; end: number }> {
  const head = await source.range(entry.o, entry.o + 29);
  const start = entry.o + 30 + u16(head, 26) + u16(head, 28);
  return { start, end: start + entry.c - 1 };
}

// ── path helpers ────────────────────────────────────────────────────────────

export const SAMPLE_RE = /^samples\/(GSM\d+)\//;

export function sampleOf(path: string): string | null {
  const m = SAMPLE_RE.exec(path);
  return m ? m[1] : null;
}

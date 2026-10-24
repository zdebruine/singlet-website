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
 *
 * The object under a key can be overwritten in place (a repack, the 2026-10 restricted-sidecar
 * migration), which leaves every cached offset pointing into a different file. Three guards keep a
 * stale row from turning into wrong bytes (docs/v2-migration.md D13):
 *   1. each row stores the object's ETag and Last-Modified next to the offsets (schema/031);
 *   2. every ranged read sends `If-Match: <etag>` (a changed object answers 412) and accepts only
 *      206, never a 200 that would buffer the whole file;
 *   3. every entry read checks the zip local-header signature and name at the offset. A mismatch is
 *      a StaleBundleError; withIndexRetry re-reads the central directory once and retries once.
 */
import { bundleUrl } from "./data-urls";

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
  /** Strong ETag of the object the offsets were read from, quoted as HTTP sends it. Null for rows written before schema/031. */
  etag?: string | null;
  /** Last-Modified of that object. */
  last_modified?: string | null;
  /** When the offsets were last checked against the object (the time of the last central-directory read). */
  verified_at?: string | null;
}

/** What HEAD tells us about the object. */
export interface BundleHead {
  size: number;
  etag: string | null;
  lastModified: string | null;
}

/**
 * The cached index no longer matches the object: the key was overwritten, or an offset does not point at the
 * entry it should. Never a transport error: callers refresh the index and retry once (withIndexRetry).
 */
export class StaleBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleBundleError";
  }
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

/** "follow" for our own public bundles; "manual" for a user-registered URL, where any 3xx is an error. */
type RedirectMode = "follow" | "manual";

async function headInfo(url: string, redirect: RedirectMode = "follow", signal?: AbortSignal): Promise<BundleHead> {
  const res = await fetch(url, { method: "HEAD", redirect, ...(signal ? { signal } : {}) });
  if (!res.ok) throw new Error(`HEAD ${res.status} for ${url}`);
  const len = Number(res.headers.get("content-length") ?? "0");
  if (!Number.isFinite(len) || len <= 0) throw new Error(`No content-length for ${url}`);
  return { size: len, etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified") };
}

/** If-Match needs a strong validator; a weak ETag (`W/"…"`, e.g. after on-the-fly compression) cannot be sent. */
export function strongEtag(etag: string | null | undefined): string | null {
  const t = (etag ?? "").trim();
  return t && !t.startsWith("W/") ? t : null;
}

/**
 * Inclusive byte range. Only a 206 is a ranged answer: a 200 means the front ignored Range and is sending the
 * whole object (up to 29 GB), so it is refused and its body dropped unread. `etag` makes the read conditional:
 * an object that changed answers 412, and a range past the end of a shorter object answers 416; both mean the
 * cached offsets are stale.
 */
async function fetchRangeWithEtag(
  url: string,
  start: number,
  end: number,
  redirect: RedirectMode = "follow",
  etag?: string | null
): Promise<{ bytes: Uint8Array; etag: string | null }> {
  const headers: Record<string, string> = { Range: `bytes=${start}-${end}` };
  const ifMatch = strongEtag(etag);
  if (ifMatch) headers["If-Match"] = ifMatch;
  const res = await fetch(url, { headers, redirect });
  if (res.status !== 206) {
    await res.body?.cancel().catch(() => undefined);
    if (res.status === 412 || res.status === 416) {
      throw new StaleBundleError(`The file changed since it was indexed (range bytes=${start}-${end} answered ${res.status} for ${url})`);
    }
    throw new Error(`Range ${res.status} for ${url}`);
  }
  return { bytes: new Uint8Array(await res.arrayBuffer()), etag: res.headers.get("etag") };
}

async function fetchRange(url: string, start: number, end: number, redirect: RedirectMode = "follow", etag?: string | null): Promise<Uint8Array> {
  return (await fetchRangeWithEtag(url, start, end, redirect, etag)).bytes;
}

export interface BundleByteSource {
  size(): Promise<number>;
  range(start: number, end: number): Promise<Uint8Array>;
  /** Size plus identity (ETag, Last-Modified), when the source can tell. */
  head?(): Promise<BundleHead>;
}

/**
 * A user-registered host that ignores Range answers 200 with the whole file. We accept that for a small enough file by reading at most
 * `end + 1` bytes of the body and cancelling the rest; a range that would need more than this is refused (the isolate has 128 MB).
 */
export const USER_HOST_FULL_READ_MAX = 32 * 1024 * 1024;

/** At most `limit` bytes of a body, then cancel it. */
async function readAtMost(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  try {
    while (got < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(Math.min(got, limit));
  let o = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, out.length - o);
    if (take <= 0) break;
    out.set(c.subarray(0, take), o);
    o += take;
  }
  return out;
}

/**
 * Range reads over HTTPS.
 *
 * Our own host (the default): conditional on an ETag (the one in `opts.etag`, replaced by the live one whenever head() runs, so a file that
 * changes between the HEAD and the reads that follow is caught), and only a 206 counts as a ranged answer.
 *
 * `userHost` is for a URL a user registered (private-indexer.ts assertPublicBundleUrl vetted only that exact host) and goes with
 * `noRedirects`, so a redirect elsewhere fails the read instead of being followed. We do not control that server, so:
 *   - If-Match is sent only with a strong ETag that this host itself gave in a HEAD (`opts.etag` is ignored), and a 412 is treated as
 *     "the file changed or the host mishandles If-Match": HEAD again, adopt the new ETag, retry once, and only a second 412 is stale;
 *   - a 200 to a ranged request is accepted for ranges ending within USER_HOST_FULL_READ_MAX: read at most end + 1 bytes, cancel the body.
 */
export function httpBundleSource(url: string, opts: { noRedirects?: boolean; etag?: string | null; userHost?: boolean } = {}): BundleByteSource {
  const redirect: RedirectMode = opts.noRedirects ? "manual" : "follow";
  const user = opts.userHost === true;
  let pinned: string | null = user ? null : (opts.etag ?? null);
  const head = async () => {
    const h = await headInfo(url, redirect);
    pinned = user ? strongEtag(h.etag) : h.etag;
    return h;
  };
  const size = async () => (await head()).size;
  if (!user) return { head, size, range: (start, end) => fetchRange(url, start, end, redirect, pinned) };

  const attempt = async (start: number, end: number, etag: string | null): Promise<Uint8Array | "precondition-failed"> => {
    const headers: Record<string, string> = { Range: `bytes=${start}-${end}` };
    if (etag) headers["If-Match"] = etag;
    const res = await fetch(url, { headers, redirect });
    if (res.status === 206) return new Uint8Array(await res.arrayBuffer());
    if (res.status === 200) {
      if (end + 1 > USER_HOST_FULL_READ_MAX) {
        await res.body?.cancel().catch(() => undefined);
        throw new Error(`The host ignores Range requests and the file is too large to read without them (${url})`);
      }
      const all = await readAtMost(res.body, end + 1);
      if (all.length <= start) throw new Error(`The host answered 200 but its body ended before byte ${start} (${url})`);
      return all.slice(start, end + 1);
    }
    await res.body?.cancel().catch(() => undefined);
    if (res.status === 412) return "precondition-failed";
    if (res.status === 416) throw new StaleBundleError(`The file is shorter than it was (range bytes=${start}-${end} answered 416 for ${url})`);
    throw new Error(`Range ${res.status} for ${url}`);
  };
  const range = async (start: number, end: number) => {
    let r = await attempt(start, end, pinned);
    if (r === "precondition-failed") {
      await head(); // the file changed, or the host's If-Match is unreliable: learn its current ETag and ask once more
      r = await attempt(start, end, pinned);
    }
    if (r === "precondition-failed") throw new StaleBundleError(`The file changed while it was being read (range bytes=${start}-${end} answered 412 for ${url})`);
    return r;
  };
  return { head, size, range };
}

export function r2BundleSource(bucket: R2Bucket, key: string): BundleByteSource {
  const head = async (): Promise<BundleHead> => {
    const h = await bucket.head(key);
    if (!h) throw new Error("File not found");
    return { size: h.size, etag: h.httpEtag ?? null, lastModified: h.uploaded ? h.uploaded.toUTCString() : null };
  };
  return {
    head,
    async size() {
      return (await head()).size;
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
const encoder = new TextEncoder();
const LOCAL_SIG = 0x04034b50;

// ── central-directory parse ─────────────────────────────────────────────────

export interface ParsedZip {
  bytes: number;
  entries: ZipEntry[];
  /** Identity of the object the entries were read from (null when the source cannot tell). */
  etag: string | null;
  last_modified: string | null;
}

export async function parseZipSource(source: BundleByteSource): Promise<ParsedZip> {
  const head = source.head ? await source.head() : { size: await source.size(), etag: null, lastModified: null };
  const bytes = head.size;
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
  return { bytes, entries, etag: head.etag, last_modified: head.lastModified };
}

export async function parseZipIndex(url: string): Promise<ParsedZip> {
  return parseZipSource(httpBundleSource(url));
}

// ── D1 index cache ──────────────────────────────────────────────────────────

let indexesEnsured = false;

/** Create bundle_index when a statement found it missing (a fresh database). The identity columns are part of a fresh table. */
async function ensureTables(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS bundle_index (
         gse_id TEXT PRIMARY KEY, bytes INTEGER, entries TEXT, indexed_at TEXT,
         etag TEXT, last_modified TEXT, verified_at TEXT
       )`
    )
    .run();
}

/**
 * Whether bundle_index lacks the identity columns of schema/031_bundle_index_identity.sql. Nothing is probed up front: statements use the
 * columns, and the first "no such column" is remembered for a minute (per database binding), during which the old statements are used;
 * after the minute the columns are tried again, so applying 031 takes effect without a redeploy and the happy path pays nothing.
 */
const identityAbsent = new WeakMap<object, number>();
const identityKnownAbsent = (db: D1Database) => Date.now() - (identityAbsent.get(db) ?? -Infinity) < 60_000;
const isNoColumn = (e: unknown) => /no such column/i.test(String(e));
const isNoTable = (e: unknown) => /no such table/i.test(String(e));

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

interface IndexRow {
  gse_id: string;
  bytes: number;
  entries: string;
  indexed_at: string;
  etag?: string | null;
  last_modified?: string | null;
  verified_at?: string | null;
}

/** How long the HEAD that verifies a cached index may take; past it the cached row stands. */
export const HEAD_TIMEOUT_MS = 5000;

/** Index reads in flight per study, so a burst of requests for one stale study re-reads its central directory once. */
const reindexing = new Map<string, Promise<BundleIndex>>();

async function readAndStoreIndex(db: D1Database, gse: string, waitUntil?: (p: Promise<unknown>) => void): Promise<BundleIndex> {
  const url = bundleUrl(gse);
  let parsed: ParsedZip;
  try {
    parsed = await parseZipIndex(url);
  } catch (e) {
    // The object changed between the HEAD and a ranged read (412): the next attempt starts from a new HEAD.
    if (!(e instanceof StaleBundleError)) throw e;
    parsed = await parseZipIndex(url);
  }
  const { bytes, entries, etag, last_modified } = parsed;
  const indexed_at = nowIso();
  const json = JSON.stringify(entries);
  const withIdentity = () =>
    db
      .prepare(
        `INSERT INTO bundle_index (gse_id, bytes, entries, indexed_at, etag, last_modified, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(gse_id) DO UPDATE SET bytes = excluded.bytes, entries = excluded.entries, indexed_at = excluded.indexed_at,
           etag = excluded.etag, last_modified = excluded.last_modified, verified_at = excluded.verified_at`
      )
      .bind(gse, bytes, json, indexed_at, etag, last_modified, indexed_at)
      .run();
  const legacy = () =>
    db
      .prepare(
        `INSERT INTO bundle_index (gse_id, bytes, entries, indexed_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(gse_id) DO UPDATE SET bytes = excluded.bytes, entries = excluded.entries, indexed_at = excluded.indexed_at`
      )
      .bind(gse, bytes, json, indexed_at)
      .run();
  const attempt = async () => {
    if (identityKnownAbsent(db)) return legacy();
    try {
      return await withIdentity();
    } catch (e) {
      if (!isNoColumn(e)) throw e;
      identityAbsent.set(db, Date.now());
      return legacy();
    }
  };
  // A failed write is not an error: the index is rebuilt on the next read. A missing table (a fresh database) is created and tried once more.
  const write = attempt()
    .catch(async (e) => {
      if (!isNoTable(e)) return undefined;
      await ensureTables(db);
      return attempt();
    })
    .catch(() => undefined);
  if (waitUntil) waitUntil(write);
  else await write;
  return { gse_id: gse, bytes, entries, indexed_at, etag, last_modified, verified_at: indexed_at };
}

/**
 * Parsed index for a study, from D1 when we have it, otherwise over the wire.
 *
 * `verify` spends one HEAD to compare the cached row with the live object (size, and ETag when the row has
 * one) and re-reads the central directory when they differ. It is for callers that report the file size or
 * listing and are edge-cached or rare; entry reads do not need it, they carry their own guard (see the header).
 */
export async function getBundleIndex(
  db: D1Database,
  gse: string,
  opts: { refresh?: boolean; verify?: boolean; waitUntil?: (p: Promise<unknown>) => void } = {}
): Promise<BundleIndex> {
  if (!opts.refresh) {
    const select = (identity: boolean) =>
      db
        .prepare(`SELECT gse_id, bytes, entries, indexed_at${identity ? ", etag, last_modified, verified_at" : ""} FROM bundle_index WHERE gse_id = ?`)
        .bind(gse)
        .first<IndexRow>();
    let row: IndexRow | null = null;
    try {
      row = await (identityKnownAbsent(db) ? select(false) : select(true).catch(async (e) => {
        if (!isNoColumn(e)) throw e;
        identityAbsent.set(db, Date.now());
        return select(false);
      }));
    } catch (e) {
      // No table yet (a fresh database): create it so the index read below can be stored. Any other failure: read the file.
      if (isNoTable(e)) await ensureTables(db).catch(() => undefined);
    }
    if (row?.entries) {
      try {
        const cached: BundleIndex = {
          gse_id: gse,
          bytes: Number(row.bytes ?? 0),
          entries: JSON.parse(row.entries),
          indexed_at: row.indexed_at,
          etag: row.etag ?? null,
          last_modified: row.last_modified ?? null,
          verified_at: row.verified_at ?? null,
        };
        if (!opts.verify || !(await indexIsStale(cached, bundleUrl(gse)))) return cached;
      } catch {
        /* re-index */
      }
    }
  }

  const running = reindexing.get(gse);
  if (running) return running;
  const p = readAndStoreIndex(db, gse, opts.waitUntil).finally(() => reindexing.delete(gse));
  reindexing.set(gse, p);
  return p;
}

/** True when the live object is not the one the row was read from. A failed HEAD proves nothing, so the row stands. */
async function indexIsStale(cached: BundleIndex, url: string): Promise<boolean> {
  const live = await headInfo(url, "follow", AbortSignal.timeout(HEAD_TIMEOUT_MS)).catch(() => null);
  if (!live) return false;
  if (live.size !== cached.bytes) return true;
  const was = strongEtag(cached.etag);
  return !!was && !!live.etag && live.etag !== was;
}

/**
 * Run `run` against the cached index; if it throws StaleBundleError, re-read the central directory once and
 * run it again. A second StaleBundleError is rethrown as is. `run` includes the entry lookup, because the
 * entry may be gone from the refreshed listing.
 */
export async function withIndexRetry<T>(
  db: D1Database,
  gse: string,
  opts: { waitUntil?: (p: Promise<unknown>) => void },
  run: (index: BundleIndex) => Promise<T>
): Promise<T> {
  const first = await getBundleIndex(db, gse, { waitUntil: opts.waitUntil });
  try {
    return await run(first);
  } catch (e) {
    if (!(e instanceof StaleBundleError)) throw e;
  }
  const fresh = await getBundleIndex(db, gse, { refresh: true, waitUntil: opts.waitUntil });
  return run(fresh);
}

// ── entry reads ─────────────────────────────────────────────────────────────

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * The local file header at an entry's offset must be a header (PK 03 04) for that very entry. Offsets from a
 * cached index are otherwise believed blindly: after the object is overwritten they point into other bytes.
 * Returns the offset of the payload from the start of the header.
 */
function payloadOffset(head: Uint8Array, entry: ZipEntry): number {
  if (head.length < 30 || u32(head, 0) !== LOCAL_SIG) {
    throw new StaleBundleError(`No zip local header at offset ${entry.o} for '${entry.p}': the cached index does not match the file`);
  }
  const nameLen = u16(head, 26);
  if (head.length < 30 + nameLen || decoder.decode(head.subarray(30, 30 + nameLen)) !== entry.p) {
    throw new StaleBundleError(`The zip entry at offset ${entry.o} is not '${entry.p}': the cached index does not match the file`);
  }
  return 30 + nameLen + u16(head, 28);
}

/** Fetch + inflate one entry. Throws when it is larger than MAX_INFLATE_BYTES. */
export async function readEntryFromSource(source: BundleByteSource, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.u > MAX_INFLATE_BYTES) throw new Error(`Entry ${entry.p} is ${entry.u} bytes (limit ${MAX_INFLATE_BYTES})`);
  // One request covers the local header (30 + name + extra, extra ≤ 512 in practice) and the data.
  const start = entry.o;
  const end = entry.o + 30 + 512 + entry.c + 512;
  const blob = await source.range(start, end);
  const dataStart = payloadOffset(blob, entry);
  let raw = blob.subarray(dataStart, dataStart + entry.c);
  if (raw.length < entry.c) {
    // An unusually long extra field pushed the payload past the bytes we asked for.
    raw = await source.range(entry.o + dataStart, entry.o + dataStart + entry.c - 1);
  }
  return entry.n === 8 ? inflateRaw(raw) : raw;
}

/** `identity` carries the ETag the offsets were read from, so the read is conditional on the file being unchanged. */
export async function readEntry(gse: string, entry: ZipEntry, identity?: { etag?: string | null }): Promise<Uint8Array> {
  return readEntryFromSource(httpBundleSource(bundleUrl(gse), { etag: identity?.etag }), entry);
}

export async function readEntryText(gse: string, entry: ZipEntry, identity?: { etag?: string | null }): Promise<string> {
  return decoder.decode(await readEntry(gse, entry, identity));
}

/**
 * Byte range of an entry's *compressed* payload, for a caller that wants to
 * pull it themselves (the big `.1pz` matrices). Reads the local header (30 bytes plus the name) to learn the
 * payload start and to check that it is the entry the index says it is.
 */
export async function entryRange(
  gse: string,
  entry: ZipEntry,
  identity?: { etag?: string | null }
): Promise<{ url: string; start: number; end: number; etag: string | null }> {
  const url = bundleUrl(gse);
  const { bytes, etag } = await fetchRangeWithEtag(url, entry.o, entry.o + 29 + encoder.encode(entry.p).length, "follow", identity?.etag);
  const start = entry.o + payloadOffset(bytes, entry);
  // `etag` is the live object's: the header just checked belongs to it, so the range is valid for exactly that object.
  return { url, start, end: start + entry.c - 1, etag };
}

export async function entryPayloadRange(source: BundleByteSource, entry: ZipEntry): Promise<{ start: number; end: number }> {
  const head = await source.range(entry.o, entry.o + 29 + encoder.encode(entry.p).length);
  const start = entry.o + payloadOffset(head, entry);
  return { start, end: start + entry.c - 1 };
}

// ── path helpers ────────────────────────────────────────────────────────────

export const SAMPLE_RE = /^samples\/(GSM\d+)\//;

export function sampleOf(path: string): string | null {
  const m = SAMPLE_RE.exec(path);
  return m ? m[1] : null;
}

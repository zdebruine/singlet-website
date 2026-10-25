/**
 * Read side of the store side-information packs (docs/format-store.md section 6), ported from the reference implementation
 * `python/singlet/store/packs.py` in the singlet-bio repository: row-vocabulary packs (feature names) and barcode
 * whitelists, resolved for a handful of row indices at a time, the way the MCP tool `resolve_features` needs them.
 *
 * Nothing here expands a whole name list. A vocabulary pack decodes to per-gene and per-exon typed arrays (about
 * 310k exons for the human build) and a name is assembled from them on demand; a whitelist walks its gap stream up
 * to the largest index asked for. No Node APIs: `fzstd` for zstd, Web Crypto for the pack id.
 *
 * Pack file (`SPK2`): "SPK2" u16 version=1 u16 kind u32 header_len, header JSON, body. kind 1 row vocabulary, 2 barcode
 * whitelist, 3 composite. The pack id is the first 16 bytes of the SHA-256 of the whole file (32 hex characters); a
 * matrix stores the first 8 bytes. Every fetched pack is checked against the id it was asked for.
 *
 *  - kind 1, coder SVP0 (member "exon"): gene table + per-exon lengths and gaps. Exon names are
 *    `<gene id>_<symbol>_<chrom>:<start>-<end>`; the symbol is empty (kind 0), the gene id (kind 1) or explicit (kind 2).
 *  - kind 1, coder SVPD (member "intron"): the body is the id of the exon pack it derives from. Intron names are the
 *    gaps between consecutive exons of a gene: `<gene id>_<symbol>_intron_<chrom>:<end of exon>-<start of next>`.
 *  - kind 3 (composite, e.g. the barnyard build): parts, each a vocabulary pack with a species tag that is inserted
 *    before the chromosome (after `intron_` for introns); rows are numbered across the parts in order.
 *  - kind 2: k, n, mode 0, then a zstd frame of LEB128 gaps between the sorted 2-bit barcode codes (A0 C1 G2 T3,
 *    first base most significant).
 */
import { decompress } from "fzstd";

export class PackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackError";
  }
}

/** Returns the bytes of `store/ref/<id>.pack`; the id is 32 lowercase hex characters. The reader verifies it. */
export type PackFetcher = (idHex32: string) => Promise<Uint8Array>;

export interface PackIndexEntry {
  id: string;
  kind: string;
  build?: string;
  member?: string;
  protocol?: string;
  n?: number;
  bytes?: number;
  sha256?: string;
  [k: string]: unknown;
}

export interface FeaturePackInfo {
  id: string;
  kind: "vocab" | "composite";
  build: string;
  member: "exon" | "intron";
  n: number;
}

export interface BarcodePackInfo {
  id: string;
  kind: "whitelist";
  k: number;
  n: number;
  protocol: string | null;
}

/** Most indices one call resolves. */
export const MAX_INDICES = 5000;

const KIND_VOCAB = 1;
const KIND_WHITELIST = 2;
const KIND_COMPOSITE = 3;
const ID_RE = /^[0-9a-f]{32}$/;

const decoder = new TextDecoder();

// ── bytes ───────────────────────────────────────────────────────────────────

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function toHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

/** The pack id: first 16 bytes of the SHA-256 of the file, as 32 hex characters. */
export async function packIdOf(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return toHex(digest.subarray(0, 16));
}

function unzstd(frame: Uint8Array, what: string): Uint8Array {
  try {
    return decompress(frame);
  } catch (e) {
    throw new PackError(`corrupt zstd data in ${what}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── SPK2 wrapper ────────────────────────────────────────────────────────────

interface Wrapper {
  kind: number;
  header: Record<string, unknown>;
  body: Uint8Array;
}

function parseWrapper(buf: Uint8Array): Wrapper {
  if (buf.length < 12 || buf[0] !== 0x53 || buf[1] !== 0x50 || buf[2] !== 0x4b || buf[3] !== 0x32) throw new PackError("not an SPK2 pack");
  const version = u16(buf, 4);
  if (version !== 1) throw new PackError(`unsupported pack version ${version}`);
  const kind = u16(buf, 6);
  const hl = u32(buf, 8);
  if (12 + hl > buf.length) throw new PackError("truncated pack header");
  let header: unknown;
  try {
    header = JSON.parse(decoder.decode(buf.subarray(12, 12 + hl)));
  } catch {
    throw new PackError("pack header is not JSON");
  }
  if (typeof header !== "object" || header === null || Array.isArray(header)) throw new PackError("pack header is not an object");
  return { kind, header: header as Record<string, unknown>, body: buf.subarray(12 + hl) };
}

async function fetchVerified(fetchPack: PackFetcher, id: string): Promise<Uint8Array> {
  if (!ID_RE.test(id)) throw new PackError("pack id must be 32 lowercase hex characters");
  let data: Uint8Array;
  try {
    data = await fetchPack(id);
  } catch (e) {
    if (e instanceof PackError) throw e;
    throw new PackError(`could not fetch pack ${id}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const got = await packIdOf(data);
  if (got !== id) throw new PackError(`pack ${id} does not match its id (the file hashes to ${got})`);
  return data;
}

// ── integer streams ─────────────────────────────────────────────────────────

class Cursor {
  p = 0;
  constructor(readonly b: Uint8Array) {}
  need(n: number, what: string): void {
    if (this.p + n > this.b.length) throw new PackError(`truncated pack body (${what})`);
  }
  u8(what: string): number {
    this.need(1, what);
    return this.b[this.p++];
  }
  u32(what: string): number {
    this.need(4, what);
    const v = u32(this.b, this.p);
    this.p += 4;
    return v;
  }
  bytes(n: number, what: string): Uint8Array {
    this.need(n, what);
    const v = this.b.subarray(this.p, this.p + n);
    this.p += n;
    return v;
  }
}

/** n unsigned LEB128 values; they must be exact doubles (below 2^53), which every coordinate and gene number is. */
function leb128Decode(raw: Uint8Array, n: number, what: string): Float64Array {
  if (n > raw.length) throw new PackError(`LEB128 stream in ${what} is shorter than its ${n} values`);
  const out = new Float64Array(n);
  let p = 0;
  for (let i = 0; i < n; i++) {
    let v = 0;
    let scale = 1;
    for (let k = 0; ; k++) {
      if (p >= raw.length) throw new PackError(`truncated LEB128 stream in ${what}`);
      if (k >= 10) throw new PackError(`LEB128 value longer than 10 bytes in ${what}`);
      const byte = raw[p++];
      v += (byte & 0x7f) * scale;
      if (byte < 0x80) break;
      scale *= 128;
    }
    if (!Number.isSafeInteger(v)) throw new PackError(`value too large in ${what}`);
    out[i] = v;
  }
  if (p !== raw.length) throw new PackError(`LEB128 stream in ${what} holds more than ${n} values`);
  return out;
}

/** u8 mode (0 LEB128, 1 four byte planes), u32 n, u32 clen, zstd frame. */
function unpackStream(c: Cursor, what: string): Float64Array {
  const mode = c.u8(what);
  const n = c.u32(what);
  const clen = c.u32(what);
  const raw = unzstd(c.bytes(clen, what), what);
  if (mode === 0) return leb128Decode(raw, n, what);
  if (mode === 1) {
    if (raw.length !== 4 * n) throw new PackError(`byte-plane stream in ${what} has the wrong length`);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = (raw[i] | (raw[n + i] << 8) | (raw[2 * n + i] << 16) | (raw[3 * n + i] << 24)) >>> 0;
    return out;
  }
  throw new PackError(`unknown stream mode ${mode} in ${what}`);
}

/** u32 clen, zstd frame. */
function unpackBlob(c: Cursor, what: string): Uint8Array {
  const clen = c.u32(what);
  return unzstd(c.bytes(clen, what), what);
}

function splitNul(blob: Uint8Array): string[] {
  return decoder.decode(blob).split("\0");
}

// ── SVP0 gene table ─────────────────────────────────────────────────────────

/** Decoded exon pack: per gene and per exon typed arrays, enough to assemble any exon or intron name. */
interface GeneStruct {
  build: string;
  prefix: string;
  width: number;
  nums: Float64Array;
  kind: Uint8Array;
  syms: string[];
  /** For a kind 2 gene, its index in `syms`. */
  symIndex: Int32Array;
  chroms: string[];
  gch: Float64Array;
  nExons: number;
  nIntrons: number;
  /** Gene of every exon. */
  gidx: Int32Array;
  exStart: Float64Array;
  exEnd: Float64Array;
  /** The exon every intron follows, and the intron's length (gap to the next exon). */
  inExon: Int32Array;
  inGap: Float64Array;
}

function decodeStruct(body: Uint8Array): GeneStruct {
  if (body.length < 20 || decoder.decode(body.subarray(0, 4)) !== "SVP0") throw new PackError("not an SVP0 body");
  const prefixLen = body[8];
  const width = body[9];
  const nChrom = u16(body, 10);
  const nGenes = u32(body, 12);
  const nExons = u32(body, 16);
  const c = new Cursor(body);
  c.p = 20;
  const buildLen = c.u8("build");
  const build = decoder.decode(c.bytes(buildLen, "build"));
  const prefix = decoder.decode(c.bytes(prefixLen, "prefix"));
  c.bytes(8, "schema");

  const d = unpackStream(c, "gene numbers");
  const nums = new Float64Array(d.length);
  let acc = 0;
  for (let g = 0; g < d.length; g++) {
    acc += g === 0 ? d[0] : d[g] + 1;
    nums[g] = acc;
  }
  const kind = unpackBlob(c, "symbol kinds");
  const symBlob = unpackBlob(c, "symbols");
  const chromBlob = unpackBlob(c, "chromosomes");
  const gch = unpackStream(c, "gene chromosomes");
  const nx = unpackStream(c, "exons per gene");
  const gstart = unpackStream(c, "first exon starts");
  const elen = unpackStream(c, "exon lengths");
  const egap = unpackStream(c, "exon gaps");
  if (c.p !== body.length) throw new PackError("trailing bytes in the SVP0 body");

  let nKind2 = 0;
  const symIndex = new Int32Array(nGenes);
  for (let g = 0; g < kind.length; g++) if (kind[g] === 2) symIndex[g] = nKind2++;
  const syms = nKind2 ? splitNul(symBlob) : [];
  const chroms = splitNul(chromBlob);
  if (nums.length !== nGenes || kind.length !== nGenes || gch.length !== nGenes || nx.length !== nGenes || gstart.length !== nGenes) {
    throw new PackError("SVP0 gene counts do not match the header");
  }
  if (elen.length !== nExons || chroms.length !== nChrom || syms.length !== nKind2) throw new PackError("SVP0 counts do not match the header");

  // Exon coordinates: the first exon of a gene starts at gstart; each next one at the previous end plus the gap.
  const first = new Int32Array(nGenes);
  const gidx = new Int32Array(nExons);
  const exStart = new Float64Array(nExons);
  const exEnd = new Float64Array(nExons);
  let nIntrons = 0;
  let e = 0;
  for (let g = 0; g < nGenes; g++) {
    const nex = nx[g] + 1;
    first[g] = e;
    if (e + nex > nExons) throw new PackError("SVP0 exon counts exceed the header");
    e += nex;
    nIntrons += nex - 1;
  }
  if (e !== nExons) throw new PackError("SVP0 exon counts do not match the header");
  if (egap.length !== nIntrons) throw new PackError("SVP0 gap count does not match the exon counts");
  const inExon = new Int32Array(nIntrons);
  const inGap = new Float64Array(nIntrons);
  let gi = 0;
  for (let g = 0; g < nGenes; g++) {
    const nex = nx[g] + 1;
    let pos = gstart[g];
    for (let j = 0; j < nex; j++) {
      const x = first[g] + j;
      gidx[x] = g;
      exStart[x] = pos;
      exEnd[x] = pos + elen[x];
      if (j < nex - 1) {
        inExon[gi] = x;
        inGap[gi] = egap[gi];
        pos = exEnd[x] + egap[gi];
        gi++;
      }
    }
  }
  return { build, prefix, width, nums, kind, syms, symIndex, chroms, gch, nExons, nIntrons, gidx, exStart, exEnd, inExon, inGap };
}

function geneHead(s: GeneStruct, g: number): string {
  const gid = s.prefix + String(s.nums[g]).padStart(s.width, "0");
  const k = s.kind[g];
  const sym = k === 0 ? "" : k === 1 ? gid : s.syms[s.symIndex[g]];
  return `${gid}_${sym}_`;
}

function exonName(s: GeneStruct, i: number, tag: string): string {
  const g = s.gidx[i];
  return `${geneHead(s, g)}${tag}${s.chroms[s.gch[g]]}:${s.exStart[i]}-${s.exEnd[i]}`;
}

function intronName(s: GeneStruct, i: number, tag: string): string {
  const x = s.inExon[i];
  const g = s.gidx[x];
  const start = s.exEnd[x];
  return `${geneHead(s, g)}intron_${tag}${s.chroms[s.gch[g]]}:${start}-${start + s.inGap[i]}`;
}

// ── vocabulary packs ────────────────────────────────────────────────────────

interface VocabPart {
  s: GeneStruct;
  member: "exon" | "intron";
  tag: string;
  start: number;
  n: number;
}

interface Vocab {
  info: FeaturePackInfo;
  parts: VocabPart[];
}

/** At most three entries, oldest evicted first. Values are promises, so concurrent callers share one decode. */
class BoundedCache<V> {
  private map = new Map<string, Promise<V>>();
  constructor(private readonly max: number) {}
  get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.map.get(key);
    if (hit) return hit;
    const p = load();
    this.map.set(key, p);
    p.catch(() => {
      if (this.map.get(key) === p) this.map.delete(key);
    });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
    return p;
  }
  clear(): void {
    this.map.clear();
  }
}

const MAX_CACHED = 3;
const structCache = new BoundedCache<GeneStruct>(MAX_CACHED);
const vocabCache = new BoundedCache<Vocab>(MAX_CACHED);
const whitelistCache = new BoundedCache<Whitelist>(MAX_CACHED);

/** Drop every decoded pack (tests; a long-lived isolate never needs it). */
export function clearPackCache(): void {
  structCache.clear();
  vocabCache.clear();
  whitelistCache.clear();
}

function headerString(h: Record<string, unknown>, key: string): string {
  const v = h[key];
  return typeof v === "string" ? v : "";
}

function headerCount(h: Record<string, unknown>, key: string): number {
  const v = h[key];
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new PackError(`pack header has no valid '${key}'`);
  return v;
}

/** The decoded gene table of an exon pack; `parsed` is the pack when the caller already holds it (no second fetch). */
function loadStruct(fetchPack: PackFetcher, exonId: string, parsed?: Wrapper): Promise<GeneStruct> {
  return structCache.get(exonId, async () => {
    const w = parsed ?? parseWrapper(await fetchVerified(fetchPack, exonId));
    if (w.kind !== KIND_VOCAB || w.header.coder !== "SVP0") throw new PackError(`pack ${exonId} is not an SVP0 exon pack`);
    return decodeStruct(w.body);
  });
}

/** One non-composite vocabulary pack (SVP0 exon, or SVPD intron derived from an exon pack). */
async function loadPart(fetchPack: PackFetcher, id: string, w: Wrapper, tag: string, start: number): Promise<VocabPart> {
  const member = headerString(w.header, "member");
  const n = headerCount(w.header, "n");
  if (w.header.coder === "SVP0") {
    if (member !== "exon") throw new PackError(`SVP0 pack ${id} must hold the exon member`);
    const s = await loadStruct(fetchPack, id, w);
    if (s.nExons !== n) throw new PackError(`pack ${id}: header says ${n} rows, the gene table has ${s.nExons}`);
    return { s, member: "exon", tag, start, n };
  }
  if (w.header.coder === "SVPD") {
    if (member !== "intron") throw new PackError(`SVPD pack ${id} must hold the intron member`);
    if (w.body.length !== 16) throw new PackError(`SVPD pack ${id} has a body of ${w.body.length} bytes, expected 16`);
    const s = await loadStruct(fetchPack, toHex(w.body));
    if (s.nIntrons !== n) throw new PackError(`pack ${id}: header says ${n} rows, the gene table has ${s.nIntrons} introns`);
    return { s, member: "intron", tag, start, n };
  }
  throw new PackError(`unknown pack coder '${String(w.header.coder)}'`);
}

function loadVocab(fetchPack: PackFetcher, id: string): Promise<Vocab> {
  return vocabCache.get(id, async () => {
    const w = parseWrapper(await fetchVerified(fetchPack, id));
    if (w.kind === KIND_WHITELIST) throw new PackError(`pack ${id} is a barcode whitelist, not a feature vocabulary`);
    if (w.kind === KIND_VOCAB) {
      const part = await loadPart(fetchPack, id, w, "", 0);
      return { info: { id, kind: "vocab", build: headerString(w.header, "build") || part.s.build, member: part.member, n: part.n }, parts: [part] };
    }
    if (w.kind !== KIND_COMPOSITE) throw new PackError(`pack ${id} has unknown kind ${w.kind}`);
    const member = headerString(w.header, "member");
    if (member !== "exon" && member !== "intron") throw new PackError(`composite pack ${id} has no member`);
    const c = new Cursor(w.body);
    const nParts = c.u8("parts");
    const parts: VocabPart[] = [];
    let start = 0;
    for (let i = 0; i < nParts; i++) {
      const cid = toHex(c.bytes(16, "component id"));
      const tag = decoder.decode(c.bytes(c.u8("tag length"), "tag"));
      const cw = parseWrapper(await fetchVerified(fetchPack, cid));
      if (cw.kind !== KIND_VOCAB) throw new PackError(`component ${cid} of composite ${id} is not a plain vocabulary pack`);
      const part = await loadPart(fetchPack, cid, cw, tag, start);
      if (part.member !== member) throw new PackError(`component ${cid} holds ${part.member}, the composite holds ${member}`);
      parts.push(part);
      start += part.n;
    }
    if (c.p !== w.body.length) throw new PackError("trailing bytes in the composite body");
    const declared = w.header.n;
    if (typeof declared === "number" && declared !== start) throw new PackError(`composite ${id}: header says ${declared} rows, the parts hold ${start}`);
    return { info: { id, kind: "composite", build: headerString(w.header, "build"), member, n: start }, parts };
  });
}

function nameAt(v: Vocab, i: number): string | null {
  for (const part of v.parts) {
    if (i >= part.start && i < part.start + part.n) {
      const local = i - part.start;
      return part.member === "exon" ? exonName(part.s, local, part.tag) : intronName(part.s, local, part.tag);
    }
  }
  return null;
}

function checkIndices(indices: unknown): number[] {
  if (!Array.isArray(indices)) throw new PackError("indices must be an array");
  if (indices.length > MAX_INDICES) throw new PackError(`at most ${MAX_INDICES} indices per call`);
  for (const i of indices) {
    if (typeof i !== "number" || !Number.isSafeInteger(i) || i < 0) throw new PackError("indices must be non-negative integers");
  }
  return indices as number[];
}

function normalizeId(id: string): string {
  const v = String(id).trim().toLowerCase();
  if (!ID_RE.test(v)) throw new PackError("pack id must be 32 hex characters (resolve a 16-character prefix with resolvePackId first)");
  return v;
}

/**
 * Row names for `indices` of a vocabulary pack (a matrix's `row_names` pack: exon, intron or composite). An index past
 * the end gives null. `packId32` is the full pack id; use `resolvePackId` with `store/ref/index.json` to get it from the
 * 8-byte prefix a matrix stores.
 */
export async function resolveFeatureNames(
  fetchPack: PackFetcher,
  packId32: string,
  indices: number[]
): Promise<{ names: (string | null)[]; pack: FeaturePackInfo }> {
  const idx = checkIndices(indices);
  const v = await loadVocab(fetchPack, normalizeId(packId32));
  return { names: idx.map((i) => (i < v.info.n ? nameAt(v, i) : null)), pack: v.info };
}

// ── whitelists ──────────────────────────────────────────────────────────────

interface Whitelist {
  info: BarcodePackInfo;
  /** The decompressed LEB128 gap stream: n values, the first absolute. */
  gaps: Uint8Array;
}

function loadWhitelist(fetchPack: PackFetcher, id: string): Promise<Whitelist> {
  return whitelistCache.get(id, async () => {
    const w = parseWrapper(await fetchVerified(fetchPack, id));
    if (w.kind !== KIND_WHITELIST) throw new PackError(`pack ${id} is not a barcode whitelist`);
    if (w.body.length < 6) throw new PackError("truncated whitelist body");
    const k = w.body[0];
    const n = u32(w.body, 1);
    if (w.body[5] !== 0) throw new PackError(`unknown whitelist mode ${w.body[5]}`);
    if (k < 1 || k > 32) throw new PackError(`whitelist barcode length ${k} is outside 1-32`);
    const gaps = unzstd(w.body.subarray(6), "whitelist");
    let values = 0;
    for (let i = 0; i < gaps.length; i++) if (gaps[i] < 0x80) values++;
    if (values !== n || (gaps.length > 0 && gaps[gaps.length - 1] >= 0x80)) throw new PackError("whitelist gap stream does not hold n values");
    const protocol = headerString(w.header, "protocol");
    return { info: { id, kind: "whitelist", k, n, protocol: protocol || null }, gaps };
  });
}

const ALPHA = "ACGT";

function barcodeOf(hi: number, lo: number, k: number): string {
  let s = "";
  for (let i = 0; i < k; i++) {
    const shift = 2 * (k - 1 - i);
    s += ALPHA[(shift >= 32 ? hi >>> (shift - 32) : lo >>> shift) & 3];
  }
  return s;
}

/** Barcodes at `indices` of a whitelist pack, in the sorted order the pack stores. An index past the end gives null. */
export async function resolveBarcodeNames(
  fetchPack: PackFetcher,
  packId32: string,
  indices: number[]
): Promise<{ names: (string | null)[]; pack: BarcodePackInfo }> {
  const idx = checkIndices(indices);
  const wl = await loadWhitelist(fetchPack, normalizeId(packId32));
  const { k, n } = wl.info;
  const wanted = [...new Set(idx.filter((i) => i < n))].sort((a, b) => a - b);
  const found = new Map<number, string>();
  if (wanted.length) {
    // One pass over the gap stream up to the largest index, keeping the running 64-bit code as two 32-bit halves.
    let hi = 0;
    let lo = 0;
    let p = 0;
    let next = 0;
    const g = wl.gaps;
    for (let i = 0; next < wanted.length; i++) {
      let gLo = 0;
      let gHi = 0;
      for (let shift = 0; ; shift += 7) {
        const b = g[p++];
        const v = b & 0x7f;
        if (shift < 32) {
          gLo |= v << shift;
          if (shift + 7 > 32) gHi |= v >>> (32 - shift);
        } else {
          gHi |= v << (shift - 32);
        }
        if (b < 0x80) break;
      }
      gLo >>>= 0;
      gHi >>>= 0;
      const sum = (lo + gLo) >>> 0;
      hi = (hi + gHi + (sum < gLo ? 1 : 0)) >>> 0;
      lo = sum;
      if (i === wanted[next]) {
        found.set(i, barcodeOf(hi, lo, k));
        next++;
      }
    }
  }
  return { names: idx.map((i) => found.get(i) ?? null), pack: wl.info };
}

// ── pack index ──────────────────────────────────────────────────────────────

/**
 * The full 32-hex pack id for an id or an 8-byte prefix (16 hex characters) as a matrix stores it, looked up in
 * `store/ref/index.json` (the document or its `packs` list). Throws when no pack, or more than one, matches.
 */
export function resolvePackId(index: { packs?: PackIndexEntry[] } | PackIndexEntry[], idOrPrefix: string): string {
  const q = String(idOrPrefix).trim().toLowerCase();
  if (!/^[0-9a-f]{16,32}$/.test(q)) throw new PackError("a pack id is 16 to 32 hex characters");
  const list = Array.isArray(index) ? index : (index?.packs ?? []);
  const hits = [...new Set(list.filter((e) => e && typeof e.id === "string" && e.id.startsWith(q)).map((e) => e.id))];
  if (hits.length === 0) throw new PackError(`pack ${q} is not in the pack index`);
  if (hits.length > 1) throw new PackError(`pack id prefix ${q} is ambiguous (${hits.length} packs)`);
  return hits[0];
}

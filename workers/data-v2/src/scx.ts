/**
 * SCX1 cell-index shard reader (singlet-bio docs/format-v2-cell-index.md section 4; writer: python/singlet/v2/atlas.py).
 *
 *   FileHeader 64 B   "SCX1" u16 version=1 u16 n_cols u32 n_groups u64 n_rows u32 group_rows u32 header_len, 40 B zero
 *   n_cols   x 32 B   name[24] (ASCII, NUL padded), u8 dtype (1 u8, 2 u16, 3 u32), 7 B zero
 *   n_groups x 16 B   u64 first_row, u32 n_rows, 4 B zero
 *   n_groups x n_cols x 24 B   u64 off (from file start), u32 len, u8 enc, u8 bits, u16 0, u32 min, u32 max
 *   (zero padding to header_len, a multiple of 64), then the chunk bodies, each at a multiple of 8
 *
 * Encodings: 0 CONST (every value = min, no body), 1 FOR (value - min, `bits` bits each, LSB first in little-endian u32 words),
 * 2 RLE (u32 value, u32 run length pairs). All values are unsigned and below 2^32.
 */

export const SCX_HEADER_BYTES = 64;
export const ENC_CONST = 0;
export const ENC_FOR = 1;
export const ENC_RLE = 2;

export class ScxError extends Error {}

export interface ScxChunk {
  off: number;
  len: number;
  enc: number;
  bits: number;
  min: number;
  max: number;
}

export interface ScxHeader {
  nCols: number;
  nGroups: number;
  nRows: number;
  groupRows: number;
  headerLen: number;
  names: string[];
  dtypes: number[];
  groupFirst: number[];
  groupRowsN: number[];
  /** chunks[g][c] */
  chunks: ScxChunk[][];
}

/** Bytes needed to parse the header: read the first 64 B, then `headerLen(first64)`. */
export function scxHeaderLen(first: Uint8Array): number {
  if (first.length < SCX_HEADER_BYTES) throw new ScxError("shard header truncated");
  const dv = new DataView(first.buffer, first.byteOffset, first.byteLength);
  if (dv.getUint32(0, true) !== 0x31584353) throw new ScxError("not an SCX1 shard");
  return dv.getUint32(24, true);
}

export function parseScxHeader(buf: Uint8Array): ScxHeader {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < SCX_HEADER_BYTES || dv.getUint32(0, true) !== 0x31584353) throw new ScxError("not an SCX1 shard");
  if (dv.getUint16(4, true) !== 1) throw new ScxError("unsupported SCX version");
  const nCols = dv.getUint16(6, true);
  const nGroups = dv.getUint32(8, true);
  const nRows = Number(dv.getBigUint64(12, true));
  const groupRows = dv.getUint32(20, true);
  const headerLen = dv.getUint32(24, true);
  const need = SCX_HEADER_BYTES + nCols * 32 + nGroups * 16 + nGroups * nCols * 24;
  if (headerLen < need || buf.length < need) throw new ScxError("shard header truncated");
  let p = SCX_HEADER_BYTES;
  const names: string[] = [];
  const dtypes: number[] = [];
  const dec = new TextDecoder();
  for (let c = 0; c < nCols; c++) {
    let e = p;
    while (e < p + 24 && buf[e] !== 0) e++;
    names.push(dec.decode(buf.subarray(p, e)));
    dtypes.push(buf[p + 24]);
    p += 32;
  }
  const groupFirst: number[] = [];
  const groupRowsN: number[] = [];
  for (let g = 0; g < nGroups; g++) {
    groupFirst.push(Number(dv.getBigUint64(p, true)));
    groupRowsN.push(dv.getUint32(p + 8, true));
    p += 16;
  }
  const chunks: ScxChunk[][] = [];
  for (let g = 0; g < nGroups; g++) {
    const row: ScxChunk[] = [];
    for (let c = 0; c < nCols; c++) {
      row.push({
        off: Number(dv.getBigUint64(p, true)),
        len: dv.getUint32(p + 8, true),
        enc: buf[p + 12],
        bits: buf[p + 13],
        min: dv.getUint32(p + 16, true),
        max: dv.getUint32(p + 20, true),
      });
      p += 24;
    }
    chunks.push(row);
  }
  return { nCols, nGroups, nRows, groupRows, headerLen, names, dtypes, groupFirst, groupRowsN, chunks };
}

/** Decode one column chunk of `n` rows into `out` (length >= n). `body` holds exactly the chunk's bytes. */
export function decodeChunk(ch: ScxChunk, n: number, body: Uint8Array | null, out: Uint32Array): Uint32Array {
  if (ch.enc === ENC_CONST) {
    out.fill(ch.min, 0, n);
    return out;
  }
  if (!body || body.length < ch.len) throw new ScxError("chunk body missing");
  // align to 4 bytes (bodies start at multiples of 8 in the file, but a caller's slice may not be aligned in memory)
  const words =
    body.byteOffset % 4 === 0 ? new Uint32Array(body.buffer, body.byteOffset, ch.len >>> 2) : new Uint32Array(body.slice(0, ch.len).buffer);
  if (ch.enc === ENC_RLE) {
    let k = 0;
    for (let i = 0; i + 1 < words.length; i += 2) {
      const v = words[i];
      const r = words[i + 1];
      if (k + r > n) throw new ScxError("RLE runs exceed the group");
      out.fill(v, k, k + r);
      k += r;
    }
    if (k !== n) throw new ScxError("RLE runs do not add up to the group size");
    return out;
  }
  if (ch.enc === ENC_FOR) {
    const b = ch.bits;
    const lo = ch.min;
    if (b === 0 || b > 32) throw new ScxError("bad bit width");
    if (words.length * 32 < n * b) throw new ScxError("FOR body too short");
    const mask = b === 32 ? 0xffffffff : (1 << b) - 1;
    let pos = 0;
    for (let i = 0; i < n; i++, pos += b) {
      const w = pos >>> 5;
      const s = pos & 31;
      let v = words[w] >>> s;
      if (s + b > 32) v |= words[w + 1] << (32 - s);
      out[i] = ((v & mask) >>> 0) + lo;
    }
    return out;
  }
  throw new ScxError(`unknown encoding ${ch.enc}`);
}

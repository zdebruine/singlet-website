// Minimal zip / zip64 central-directory reader: member names and the byte span each member occupies in the file.
// A member's span runs from its local header to the next member's local header (or the central directory), so a
// byte range can be mapped to the members it touches without reading any member data.

export interface Member {
  name: string;
  start: number; // local header offset
  end: number; // exclusive: next local header, or the central directory offset
}

export interface ZipIndex {
  size: number;
  cdStart: number; // central directory offset; bytes from here to the end hold names and offsets only
  members: Member[]; // sorted by start
}

export type RangeReader = (start: number, endInclusive: number) => Promise<Uint8Array>;

const EOCD = 0x06054b50;
const Z64_LOCATOR = 0x07064b50;
const Z64_EOCD = 0x06064b50;
const CDH = 0x02014b50;

function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
}
function u64(b: Uint8Array, o: number): number {
  return u32(b, o) + u32(b, o + 4) * 0x100000000;
}

export async function readZipIndex(size: number, read: RangeReader): Promise<ZipIndex> {
  const tailLen = Math.min(size, 65557 + 20 + 56);
  const tailStart = size - tailLen;
  const tail = await read(tailStart, size - 1);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === EOCD) {
      e = i;
      break;
    }
  }
  if (e < 0) throw new Error("zip: end of central directory not found");
  let cdSize = u32(tail, e + 12);
  let cdOff = u32(tail, e + 16);
  let count = u16(tail, e + 10);
  if (cdOff === 0xffffffff || cdSize === 0xffffffff || count === 0xffff) {
    const l = e - 20;
    if (l < 0 || u32(tail, l) !== Z64_LOCATOR) throw new Error("zip: zip64 locator missing");
    const z64Off = u64(tail, l + 8);
    let rec: Uint8Array;
    let r: number;
    if (z64Off >= tailStart) {
      rec = tail;
      r = z64Off - tailStart;
    } else {
      rec = await read(z64Off, z64Off + 55);
      r = 0;
    }
    if (u32(rec, r) !== Z64_EOCD) throw new Error("zip: zip64 end record missing");
    count = u64(rec, r + 32);
    cdSize = u64(rec, r + 40);
    cdOff = u64(rec, r + 48);
  }
  const cd = cdOff >= tailStart ? tail.subarray(cdOff - tailStart, cdOff - tailStart + cdSize) : await read(cdOff, cdOff + cdSize - 1);
  const dec = new TextDecoder();
  const starts: { name: string; start: number }[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (u32(cd, p) !== CDH) throw new Error("zip: bad central directory entry");
    const csize = u32(cd, p + 20);
    const usize = u32(cd, p + 24);
    const nlen = u16(cd, p + 28);
    const xlen = u16(cd, p + 30);
    const clen = u16(cd, p + 32);
    let off = u32(cd, p + 42);
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nlen));
    if (off === 0xffffffff) {
      // zip64 extra: uncompressed, compressed, offset, in that order, each present only if its field overflowed
      let x = p + 46 + nlen;
      const xend = x + xlen;
      while (x + 4 <= xend) {
        const id = u16(cd, x);
        const len = u16(cd, x + 2);
        if (id === 0x0001) {
          let q = x + 4;
          if (usize === 0xffffffff) q += 8;
          if (csize === 0xffffffff) q += 8;
          off = u64(cd, q);
          break;
        }
        x += 4 + len;
      }
    }
    starts.push({ name, start: off });
    p += 46 + nlen + xlen + clen;
  }
  starts.sort((a, b) => a.start - b.start);
  const members = starts.map((m, i) => ({ name: m.name, start: m.start, end: i + 1 < starts.length ? starts[i + 1].start : cdOff }));
  return { size, cdStart: cdOff, members };
}

/** Members whose span overlaps [start, endInclusive]. */
export function membersInRange(idx: ZipIndex, start: number, endInclusive: number): Member[] {
  const out: Member[] = [];
  for (const m of idx.members) {
    if (m.start > endInclusive) break;
    if (m.end > start) out.push(m);
  }
  return out;
}

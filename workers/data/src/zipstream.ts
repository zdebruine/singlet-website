/**
 * A streaming zip writer for the cell export: entries are stored (method 0) because their contents are gzip files already, each is
 * followed by a data descriptor (general purpose bit 3) so its CRC and size are written after the bytes, and the central directory
 * comes last. No zip64: an export is far below 4 GiB (the caller caps it). Readers that check the central directory (Python zipfile,
 * R unzip, Windows Explorer, macOS Archive Utility, Info-ZIP) all accept this layout.
 */
import { crc32 } from "./pz2";

const enc = new TextEncoder();

interface Entry {
  name: Uint8Array;
  offset: number;
  crc: number;
  size: number;
}

// 1980-01-01 00:00 in DOS time: entries carry no meaningful timestamp
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

export class ZipWriter {
  private entries: Entry[] = [];
  private offset = 0;
  private open: Entry | null = null;
  constructor(private readonly write: (b: Uint8Array) => Promise<void>) {}

  private async out(b: Uint8Array): Promise<void> {
    this.offset += b.length;
    await this.write(b);
  }

  async begin(name: string): Promise<void> {
    if (this.open) throw new Error("zip: previous entry still open");
    const nb = enc.encode(name);
    const h = new Uint8Array(30 + nb.length);
    const dv = new DataView(h.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true); // version needed
    dv.setUint16(6, 0x0808, true); // bit 3: data descriptor; bit 11: UTF-8 names
    dv.setUint16(8, 0, true); // stored
    dv.setUint16(10, DOS_TIME, true);
    dv.setUint16(12, DOS_DATE, true);
    // crc, sizes 0: in the data descriptor
    dv.setUint16(26, nb.length, true);
    h.set(nb, 30);
    this.open = { name: nb, offset: this.offset, crc: 0, size: 0 };
    await this.out(h);
  }

  async data(b: Uint8Array): Promise<void> {
    const e = this.open;
    if (!e) throw new Error("zip: no open entry");
    if (!b.length) return;
    e.crc = crc32(b, e.crc);
    e.size += b.length;
    await this.out(b);
  }

  async end(): Promise<void> {
    const e = this.open;
    if (!e) throw new Error("zip: no open entry");
    if (e.size > 0xfffffffe || this.offset > 0xfffffffe) throw new Error("zip: entry too large (zip64 is not written)");
    const d = new Uint8Array(16);
    const dv = new DataView(d.buffer);
    dv.setUint32(0, 0x08074b50, true);
    dv.setUint32(4, e.crc, true);
    dv.setUint32(8, e.size, true);
    dv.setUint32(12, e.size, true);
    await this.out(d);
    this.entries.push(e);
    this.open = null;
  }

  async file(name: string, b: Uint8Array): Promise<void> {
    await this.begin(name);
    await this.data(b);
    await this.end();
  }

  async finish(): Promise<void> {
    if (this.open) throw new Error("zip: entry still open");
    const start = this.offset;
    for (const e of this.entries) {
      const c = new Uint8Array(46 + e.name.length);
      const dv = new DataView(c.buffer);
      dv.setUint32(0, 0x02014b50, true);
      dv.setUint16(4, 20, true); // made by
      dv.setUint16(6, 20, true);
      dv.setUint16(8, 0x0808, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, DOS_TIME, true);
      dv.setUint16(14, DOS_DATE, true);
      dv.setUint32(16, e.crc, true);
      dv.setUint32(20, e.size, true);
      dv.setUint32(24, e.size, true);
      dv.setUint16(28, e.name.length, true);
      dv.setUint32(42, e.offset, true);
      c.set(e.name, 46);
      await this.out(c);
    }
    const size = this.offset - start;
    const z = new Uint8Array(22);
    const dv = new DataView(z.buffer);
    dv.setUint32(0, 0x06054b50, true);
    dv.setUint16(8, this.entries.length, true);
    dv.setUint16(10, this.entries.length, true);
    dv.setUint32(12, size, true);
    dv.setUint32(16, start, true);
    await this.out(z);
  }
}

/** gzip of `chunks` (one gzip member), through the platform's CompressionStream. */
export async function gzip(chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, sink: (b: Uint8Array) => Promise<void>): Promise<void> {
  const cs = new CompressionStream("gzip");
  const w = cs.writable.getWriter();
  const pump = (async () => {
    const r = cs.readable.getReader();
    for (;;) {
      const { value, done } = await r.read();
      if (done) break;
      if (value?.length) await sink(value);
    }
  })();
  for await (const c of chunks as AsyncIterable<Uint8Array>) await w.write(c);
  await w.close();
  await pump;
}

export const gzipBytes = async (b: Uint8Array): Promise<Uint8Array> => {
  const parts: Uint8Array[] = [];
  await gzip([b], async (x) => {
    parts.push(x);
  });
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

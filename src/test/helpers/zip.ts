/**
 * Test doubles for reading a `.singlet` bundle over HTTP: a minimal zip writer (stored and deflated entries,
 * optionally with the zip64 local-header extra that the 2026-10 migration wrote) and a fake object host that
 * answers HEAD and ranged GETs like data.singlet.bio (R2): 206 with ETag, 412 on a failed If-Match, 416 past the
 * end, and optionally a front that ignores Range and answers 200.
 */
import { deflateRawSync } from "node:zlib";

export interface ZipFile {
  name: string;
  data: Uint8Array;
  /** Compress with raw deflate (method 8); default is stored (method 0), like the .1pz members. */
  deflate?: boolean;
  /** Local header with 0xFFFFFFFF sizes and a 20-byte zip64 extra, as `force_zip64=True` writes it. */
  zip64Local?: boolean;
  /** Name written into the local header when it should differ from the central directory's (a corrupt file). */
  localName?: string;
}

export interface BuiltZip {
  bytes: Uint8Array;
  /** Central-directory view of each file, in order: what bundle-reader's ZipEntry holds. */
  entries: { p: string; n: number; c: number; u: number; o: number }[];
}

const enc = new TextEncoder();

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function le(width: 2 | 4 | 8, value: number): Uint8Array {
  const b = new Uint8Array(width);
  const dv = new DataView(b.buffer);
  if (width === 2) dv.setUint16(0, value, true);
  else if (width === 4) dv.setUint32(0, value, true);
  else dv.setBigUint64(0, BigInt(value), true);
  return b;
}

export function buildZip(files: ZipFile[]): BuiltZip {
  const chunks: Uint8Array[] = [];
  const entries: BuiltZip["entries"] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const method = f.deflate ? 8 : 0;
    const payload = f.deflate ? new Uint8Array(deflateRawSync(f.data)) : f.data;
    const c = payload.length;
    const u = f.data.length;
    const name = enc.encode(f.localName ?? f.name);
    const extra = f.zip64Local ? concat([le(2, 1), le(2, 16), le(8, u), le(8, c)]) : new Uint8Array(0);
    const local = concat([
      le(4, 0x04034b50), le(2, 45), le(2, 0), le(2, method), le(2, 0), le(2, 0), le(4, 0),
      le(4, f.zip64Local ? 0xffffffff : c), le(4, f.zip64Local ? 0xffffffff : u),
      le(2, name.length), le(2, extra.length), name, extra,
    ]);
    chunks.push(local, payload);
    entries.push({ p: f.name, n: method, c, u, o: offset });
    const cname = enc.encode(f.name);
    central.push(
      concat([
        le(4, 0x02014b50), le(2, 45), le(2, 45), le(2, 0), le(2, method), le(2, 0), le(2, 0), le(4, 0),
        le(4, c), le(4, u), le(2, cname.length), le(2, 0), le(2, 0), le(2, 0), le(2, 0), le(4, 0), le(4, offset), cname,
      ])
    );
    offset += local.length + payload.length;
  }
  const cd = concat(central);
  const eocd = concat([le(4, 0x06054b50), le(2, 0), le(2, 0), le(2, files.length), le(2, files.length), le(4, cd.length), le(4, offset), le(2, 0)]);
  return { bytes: concat([...chunks, cd, eocd]), entries };
}

export interface HostObject {
  bytes: Uint8Array;
  etag: string | null;
  lastModified?: string;
  /** Answer a Range request with 200 and the whole body, like a front that ignores Range. */
  ignoreRange?: boolean;
}

export interface LoggedRequest {
  method: string;
  url: string;
  range: string | null;
  ifMatch: string | null;
  status: number;
}

/** A stand-in for `fetch` against data.singlet.bio. Objects are keyed by full URL. */
export class FakeHost {
  objects = new Map<string, HostObject>();
  log: LoggedRequest[] = [];
  /** Fail HEAD with this status (to test callers that must not trust a failed HEAD). */
  failHead: number | null = null;

  put(url: string, object: HostObject): void {
    this.objects.set(url, object);
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const range = headers.get("range");
    const ifMatch = headers.get("if-match");
    const done = (res: Response) => {
      this.log.push({ method, url, range, ifMatch, status: res.status });
      return res;
    };
    const o = this.objects.get(url);
    if (!o) return done(new Response("not found", { status: 404 }));
    const meta: Record<string, string> = {};
    if (o.etag) meta.etag = o.etag;
    if (o.lastModified) meta["last-modified"] = o.lastModified;
    if (method === "HEAD") {
      if (this.failHead) return done(new Response(null, { status: this.failHead }));
      return done(new Response(null, { status: 200, headers: { ...meta, "content-length": String(o.bytes.length), "accept-ranges": "bytes" } }));
    }
    if (ifMatch && o.etag && ifMatch !== o.etag) return done(new Response("precondition failed", { status: 412 }));
    const m = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
    if (!m || o.ignoreRange) return done(new Response(o.bytes.slice(), { status: 200, headers: meta }));
    const start = Number(m[1]);
    const end = Math.min(m[2] === "" ? o.bytes.length - 1 : Number(m[2]), o.bytes.length - 1);
    if (start >= o.bytes.length) return done(new Response(null, { status: 416, headers: { "content-range": `bytes */${o.bytes.length}` } }));
    return done(
      new Response(o.bytes.slice(start, end + 1), {
        status: 206,
        headers: { ...meta, "content-range": `bytes ${start}-${end}/${o.bytes.length}` },
      })
    );
  };

  get ranged(): LoggedRequest[] {
    return this.log.filter((r) => r.method === "GET");
  }
  get heads(): LoggedRequest[] {
    return this.log.filter((r) => r.method === "HEAD");
  }
}

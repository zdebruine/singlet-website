/**
 * Minimal D1Database implementation over bun:sqlite, for running the Pages
 * Functions locally (scripts/dev-api/serve.ts) and in tests.
 */
import type { Database } from "bun:sqlite";

type Param = string | number | null | boolean | ArrayBuffer;

export function makeD1(db: Database): D1Database {
  const prepare = (sql: string): D1PreparedStatement => {
    let params: Param[] = [];
    const stmt = {
      bind(...p: Param[]) {
        params = p.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v));
        return stmt;
      },
      async all<T = Record<string, unknown>>() {
        const results = db.query(sql).all(...(params as never[])) as T[];
        return { results, success: true, meta: { rows_read: 0, rows_written: 0, duration: 0 } } as unknown as D1Result<T>;
      },
      async first<T = Record<string, unknown>>(col?: string) {
        const row = db.query(sql).get(...(params as never[])) as Record<string, unknown> | null;
        if (!row) return null;
        return (col ? (row[col] as T) : (row as T)) ?? null;
      },
      async run<T = Record<string, unknown>>() {
        db.query(sql).run(...(params as never[]));
        return { results: [] as T[], success: true, meta: { rows_read: 0, rows_written: 0, duration: 0 } } as unknown as D1Result<T>;
      },
      async raw<T = unknown[]>() {
        const rows = db.query(sql).values(...(params as never[])) as T[];
        return rows;
      },
    };
    return stmt as unknown as D1PreparedStatement;
  };

  return {
    prepare,
    async batch<T = unknown>(statements: D1PreparedStatement[]) {
      const out: D1Result<T>[] = [];
      for (const s of statements) out.push((await s.run()) as D1Result<T>);
      return out;
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
    withSession() {
      throw new Error("withSession not supported in the local shim");
    },
  } as unknown as D1Database;
}

/** In-memory stand-in for the Cloudflare Cache API (`caches.default`). */
export function installCacheShim(): void {
  const store = new Map<string, { body: string; headers: [string, string][]; status: number; expires: number }>();
  const keyOf = (req: RequestInfo | URL) => (typeof req === "string" ? req : req instanceof URL ? req.toString() : req.url);
  const cache = {
    async match(req: RequestInfo | URL) {
      const k = keyOf(req);
      const hit = store.get(k);
      if (!hit) return undefined;
      if (hit.expires < Date.now()) {
        store.delete(k);
        return undefined;
      }
      return new Response(hit.body, { status: hit.status, headers: hit.headers });
    },
    async put(req: RequestInfo | URL, res: Response) {
      const cc = res.headers.get("Cache-Control") ?? "";
      const m = /max-age=(\d+)/.exec(cc);
      const ttl = m ? parseInt(m[1], 10) : 60;
      store.set(keyOf(req), {
        body: await res.text(),
        headers: [...res.headers.entries()],
        status: res.status,
        expires: Date.now() + ttl * 1000,
      });
    },
    async delete(req: RequestInfo | URL) {
      return store.delete(keyOf(req));
    },
  };
  (globalThis as unknown as { caches: unknown }).caches = { default: cache, open: async () => cache };
}

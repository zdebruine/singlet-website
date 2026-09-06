/**
 * Run the Cloudflare Pages Functions locally against the seeded SQLite mirror.
 *
 *   bun scripts/dev-api/seed.ts            # once (fetches from singlet.bio)
 *   bun scripts/dev-api/serve.ts           # http://localhost:8788/api/... and /mcp
 *
 * Point the Vite dev server at it with VITE_API_PROXY_TARGET=http://localhost:8788.
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { installCacheShim, makeD1 } from "./d1-shim";

const PORT = parseInt(process.env.PORT ?? "8788", 10);
const DB_PATH = process.env.CATALOG_DB ?? new URL("./catalog.sqlite", import.meta.url).pathname;
if (!existsSync(DB_PATH)) {
  console.error(`No local catalog at ${DB_PATH}. Run: bun scripts/dev-api/seed.ts`);
  process.exit(1);
}

installCacheShim();
const sqlite = new Database(DB_PATH);
const DB = makeD1(sqlite);
const env = { DB } as { DB: D1Database };

type Handler = (ctx: EventContext<typeof env, string, Record<string, unknown>>) => Promise<Response> | Response;
interface Route {
  pattern: RegExp;
  paramNames: string[];
  mod: () => Promise<Record<string, Handler | undefined>>;
}

const routes: Route[] = [
  { pattern: /^\/api\/stats\/?$/, paramNames: [], mod: () => import("../../functions/api/stats") },
  { pattern: /^\/api\/facets\/?$/, paramNames: [], mod: () => import("../../functions/api/facets") },
  { pattern: /^\/api\/search\/?$/, paramNames: [], mod: () => import("../../functions/api/search") },
  { pattern: /^\/api\/nl-search\/?$/, paramNames: [], mod: () => import("../../functions/api/nl-search") },
  { pattern: /^\/api\/gse\/?$/, paramNames: [], mod: () => import("../../functions/api/gse/index") },
  { pattern: /^\/api\/manifest\/?$/, paramNames: [], mod: () => import("../../functions/api/manifest") },
  { pattern: /^\/api\/bundle\/([^/]+)\/([^/]+)\/?$/, paramNames: ["gse", "action"], mod: () => import("../../functions/api/bundle/[gse]/[action]") },
  { pattern: /^\/api\/gse\/([^/]+)\/related\/?$/, paramNames: ["id"], mod: () => import("../../functions/api/gse/[id]/related") },
  { pattern: /^\/api\/gse\/([^/]+)\/?$/, paramNames: ["id"], mod: () => import("../../functions/api/gse/[id]") },
  { pattern: /^\/api\/gsm\/?$/, paramNames: [], mod: () => import("../../functions/api/gsm/index") },
  { pattern: /^\/api\/gsm\/([^/]+)\/?$/, paramNames: ["id"], mod: () => import("../../functions/api/gsm/[id]") },
  { pattern: /^\/mcp\/?$/, paramNames: [], mod: () => import("../../functions/mcp") },
  { pattern: /^\/auth\/github\/callback\/?$/, paramNames: [], mod: () => import("../../functions/auth/github/callback") },
];

const pending = new Set<Promise<unknown>>();

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    const started = performance.now();
    for (const r of routes) {
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.paramNames.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
      const mod = await r.mod();
      const handler =
        request.method === "OPTIONS"
          ? mod.onRequestOptions
          : request.method === "POST"
            ? (mod.onRequestPost ?? mod.onRequest)
            : (mod.onRequestGet ?? mod.onRequest);
      if (!handler) return new Response("Method not allowed", { status: 405 });
      try {
        const res = await handler({
          request,
          env,
          params,
          waitUntil: (p: Promise<unknown>) => {
            pending.add(p);
            p.finally(() => pending.delete(p)).catch(() => undefined);
          },
          passThroughOnException: () => undefined,
          next: async () => new Response("not found", { status: 404 }),
          data: {},
          functionPath: url.pathname,
        } as unknown as EventContext<typeof env, string, Record<string, unknown>>);
        const ms = (performance.now() - started).toFixed(0);
        console.log(`${request.method} ${url.pathname}${url.search} → ${res.status} ${res.headers.get("X-Edge-Cache") ?? ""} ${ms}ms`);
        return res;
      } catch (e) {
        console.error(e);
        return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`dev-api listening on http://localhost:${PORT} (db: ${DB_PATH})`);

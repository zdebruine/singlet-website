/**
 * Who is asking, and how much they may take (singlet-bio docs/format-v2-cell-index.md section 8).
 *
 * Subjects: `key:<api key id>` for a valid singlet.bio API key (`Authorization: Bearer <key>`, checked read-only against D1
 * `api_keys` by SHA-256 hash, memoised 60 s per isolate), else `anon:<hash of the client address>`. Three layers:
 *   1. per-request caps (10,000 cells, 10 studies, planned bytes and reads, rows scanned, $0.01 worst case): always on, no state;
 *   2. request rate per subject: the Workers Rate Limiting bindings CIDX_RL_ANON / CIDX_RL_KEY (per location, approximate) when bound;
 *   3. daily cells, bytes, scanned rows and worst-case dollars per subject: the `CidxQuota` Durable Object (one per subject, strictly
 *      consistent) when bound.
 *      Gathers reserve their planned cells and bytes before streaming; a row-scan query checks that the day's row budget is not used up,
 *      then adds the rows it scanned (off the latency path), so a subject can overshoot by at most one request's row cap.
 * Missing bindings switch their layer off (local tests, first deploy); the caps in (1) still bound every request.
 */
import { CidxError } from "./cidx";

/**
 * Per-request caps hold for every caller: whatever one request asks, its worst-case Cloudflare cost stays under `maxCostUsd`
 * (every read missing the cache and starting a fill; singlet-bio docs/format-v2-cell-index-costs.md section 3). Request rates are not
 * here: they are the `simple.limit` of the CIDX_RL_ANON / CIDX_RL_KEY bindings in wrangler.toml.
 */
export interface TierLimits {
  /** cells per query answer and per gather (a sample when more match) */
  maxCellsPerRequest: number;
  /** studies one request's cells may come from (the most relevant ones when more match) */
  maxStudiesPerRequest: number;
  maxSamplesPerGather: number;
  maxBytesPerGather: number;
  maxReadsPerRequest: number;
  maxRowsScanned: number;
  maxCostUsd: number;
  cellsPerDay: number;
  bytesPerDay: number;
  /** index rows decoded by row-scan queries (summary counts are free): bounds the CPU one subject can spend per day */
  rowsPerDay: number;
  /** worst-case Cloudflare cost per UTC day, USD: every gather is charged its estimate, every row scan the estimate of what it read */
  usdPerDay: number;
}

const PER_REQUEST = {
  maxCellsPerRequest: 10_000,
  maxStudiesPerRequest: 10,
  maxSamplesPerGather: 2_000,
  maxBytesPerGather: 1024 * 1024 * 1024,
  maxReadsPerRequest: 4_000,
  maxCostUsd: 0.01,
};

export const DEFAULT_LIMITS: Record<"anon" | "key", TierLimits> = {
  anon: { ...PER_REQUEST, maxRowsScanned: 8_000_000, cellsPerDay: 200_000, bytesPerDay: 4 * 1024 ** 3, rowsPerDay: 200_000_000, usdPerDay: 0.05 },
  key: { ...PER_REQUEST, maxRowsScanned: 32_000_000, cellsPerDay: 2_000_000, bytesPerDay: 200 * 1024 ** 3, rowsPerDay: 5_000_000_000, usdPerDay: 1.0 },
};

/** `CIDX_LIMITS` (a JSON var: {"anon": {...}, "key": {...}}) overrides any field. */
export function limitsFor(tier: "anon" | "key", override?: string | null): TierLimits {
  const base = { ...DEFAULT_LIMITS[tier] };
  if (!override) return base;
  try {
    const o = JSON.parse(override) as Record<string, Partial<TierLimits>>;
    for (const [k, v] of Object.entries(o[tier] ?? {})) {
      if (k in base && Number.isFinite(Number(v)) && Number(v) >= 0) (base as Record<string, number>)[k] = Number(v);
    }
  } catch {
    /* a bad override keeps the defaults */
  }
  return base;
}

export interface Subject {
  id: string;
  tier: "anon" | "key";
}

export interface D1Like {
  prepare(sql: string): { bind(...args: unknown[]): { first<T>(): Promise<T | null> } };
}

async function sha256Hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const keyMemo = new Map<string, { at: number; id: string | null }>();

export async function identify(request: Request, db: D1Like | null, now = Date.now()): Promise<Subject> {
  const auth = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S{8,200})$/i.exec(auth);
  const key = m ? m[1] : request.headers.get("x-singlet-key");
  if (key) {
    if (!db) throw new CidxError(503, "keys_unavailable", "API keys cannot be checked here; send the request without a key for the anonymous allowance.");
    const hash = await sha256Hex(key);
    let hit = keyMemo.get(hash);
    if (!hit || now - hit.at > 60_000) {
      let id: string | null = null;
      try {
        const row = await db.prepare("SELECT id, expires_at, revoked_at FROM api_keys WHERE key_hash = ?1").bind(hash).first<{ id: string; expires_at: string | null; revoked_at: string | null }>();
        if (row && !row.revoked_at && !(row.expires_at && Date.parse(row.expires_at) <= now)) id = row.id;
      } catch {
        throw new CidxError(503, "keys_unavailable", "API keys cannot be checked right now. Try again in a minute.");
      }
      hit = { at: now, id };
      if (keyMemo.size > 5000) keyMemo.clear();
      keyMemo.set(hash, hit);
    }
    if (!hit.id) throw new CidxError(401, "bad_key", "Unknown, revoked or expired API key. Create one at https://singlet.bio/account.");
    return { id: `key:${hit.id}`, tier: "key" };
  }
  const ip = request.headers.get("cf-connecting-ip") ?? "0.0.0.0";
  return { id: `anon:${(await sha256Hex("singlet-cidx-v1|" + ip)).slice(0, 24)}`, tier: "anon" };
}

export interface RateLimiterLike {
  limit(o: { key: string }): Promise<{ success: boolean }>;
}

export async function rateLimit(rl: { anon?: RateLimiterLike | null; key?: RateLimiterLike | null } | null | undefined, subject: Subject): Promise<void> {
  const b = rl ? (subject.tier === "key" ? rl.key : rl.anon) : null;
  if (!b) return;
  try {
    const { success } = await b.limit({ key: subject.id });
    if (!success) throw new CidxError(429, "rate_limited", "Too many cell-index requests; wait a minute.");
  } catch (e) {
    if (e instanceof CidxError) throw e;
    // fail open: the per-request caps still hold
  }
}

// ── daily quota (Durable Object) ────────────────────────────────────────────

export interface QuotaNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> };
}

export interface Usage {
  cells: number;
  bytes: number;
  rows: number;
  /** worst-case USD */
  usd: number;
}

async function quotaCall(ns: QuotaNamespaceLike, subject: Subject, limits: TierLimits, op: "charge" | "add", u: Partial<Usage>): Promise<Response | null> {
  try {
    return await ns.get(ns.idFromName(subject.id)).fetch(`https://quota/${op}`, {
      method: "POST",
      body: JSON.stringify({
        cells: u.cells ?? 0,
        bytes: u.bytes ?? 0,
        rows: u.rows ?? 0,
        usd: u.usd ?? 0,
        cellsPerDay: limits.cellsPerDay,
        bytesPerDay: limits.bytesPerDay,
        rowsPerDay: limits.rowsPerDay,
        usdPerDay: limits.usdPerDay,
      }),
    });
  } catch {
    return null; // fail open: the per-request caps still hold
  }
}

/** Reserve `cells`/`bytes`/`rows` against the day's allowance; throws CidxError(429) when it would be exceeded. */
export async function charge(ns: QuotaNamespaceLike | null | undefined, subject: Subject, limits: TierLimits, cells: number, bytes: number, rows = 0, usd = 0): Promise<void> {
  if (!ns) return;
  const res = await quotaCall(ns, subject, limits, "charge", { cells, bytes, rows, usd });
  if (res && res.status === 429) {
    const j = (await res.json()) as { used: Usage; resets_at: string };
    throw new CidxError(
      429,
      "quota_exceeded",
      `Daily allowance used (${j.used.cells} cells, ${j.used.bytes} bytes, ${j.used.rows} rows scanned, $${(j.used.usd ?? 0).toFixed(4)} worst case; resets ${j.resets_at}).${subject.tier === "anon" ? " An API key from https://singlet.bio/account raises it." : ""}`
    );
  }
}

/** Add usage without checking (the rows a query actually scanned). */
export async function addUsage(ns: QuotaNamespaceLike | null | undefined, subject: Subject, limits: TierLimits, u: Partial<Usage>): Promise<void> {
  if (!ns) return;
  await quotaCall(ns, subject, limits, "add", u);
}

interface DurableObjectStateLike {
  storage: { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void> };
  blockConcurrencyWhile?<T>(f: () => Promise<T>): Promise<T>;
}

/** One instance per subject. Requests to one object run one at a time, so check-and-add is atomic. */
export class CidxQuota {
  constructor(private state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const op = new URL(request.url).pathname;
    const b = (await request.json()) as Usage & { cellsPerDay: number; bytesPerDay: number; rowsPerDay?: number; usdPerDay?: number; now?: number };
    const now = b.now ?? Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const cur = (await this.state.storage.get<Usage & { day: string }>("u")) ?? { day, cells: 0, bytes: 0, rows: 0, usd: 0 };
    const u = cur.day === day ? { ...cur, rows: cur.rows ?? 0, usd: cur.usd ?? 0 } : { day, cells: 0, bytes: 0, rows: 0, usd: 0 };
    const next = new Date(now);
    next.setUTCHours(24, 0, 0, 0);
    const add = { cells: b.cells ?? 0, bytes: b.bytes ?? 0, rows: b.rows ?? 0, usd: b.usd ?? 0 };
    // a row check asks whether today's row budget still has room (the request then scans at most its own cap)
    const over =
      u.cells + add.cells > b.cellsPerDay ||
      u.bytes + add.bytes > b.bytesPerDay ||
      (b.rowsPerDay !== undefined && add.rows > 0 && u.rows >= b.rowsPerDay) ||
      (b.usdPerDay !== undefined && u.usd + add.usd > b.usdPerDay);
    if (op !== "/add" && over) return Response.json({ ok: false, used: u, resets_at: next.toISOString() }, { status: 429 });
    u.cells += add.cells;
    u.bytes += add.bytes;
    if (op === "/add") u.rows += add.rows;
    u.usd += add.usd;
    // a pure check (a row-scan query asking whether the row budget has room) writes nothing: storage writes are billed per row
    if (op === "/add" || add.cells || add.bytes || add.usd || cur.day !== day) await this.state.storage.put("u", u);
    return Response.json({ ok: true, used: u, resets_at: next.toISOString() });
  }
}

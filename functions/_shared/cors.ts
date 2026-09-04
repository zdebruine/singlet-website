export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  // Authorization carries the optional user session (or `sk_live_…` key) for
  // AI-search budgets; X-API-Key is the alternative spelling for scripts.
  // MCP clients send Mcp-Session-Id / MCP-Protocol-Version.
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, Accept, Mcp-Session-Id, MCP-Protocol-Version",
  // Per-request budget + cache diagnostics, readable from cross-origin previews.
  "Access-Control-Expose-Headers": "X-Singlet-Quota, X-Edge-Cache, X-Total-Count, X-Export-Limit",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json",
};

export function corsOk(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { ...CORS_HEADERS, ...(init.headers ?? {}) },
  });
}

export function corsErr(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: CORS_HEADERS,
  });
}

export function handleOptions(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Parse integer query param, return fallback if absent/invalid. */
export function intParam(url: URL, key: string, fallback: number): number {
  const v = url.searchParams.get(key);
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

/** Clamp page_size to D1 10k-row cap. */
export function clampPageSize(n: number): number {
  return Math.min(Math.max(1, n), 500);
}

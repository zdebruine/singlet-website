/**
 * Defensive parsers for D1 text columns that *may* hold JSON, a delimited
 * string, or plain free-text. A non-JSON value must never 500 an endpoint.
 */
export function safeJson(v: unknown, fallback: unknown = null): unknown {
  if (v == null) return fallback;
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (!s) return fallback;
  if (s[0] === "{" || s[0] === "[" || s[0] === '"') {
    try { return JSON.parse(s); } catch { /* fall through */ }
  }
  return fallback;
}

/** Parse to a string[] — JSON array, or comma/semicolon-delimited string. */
export function safeList(v: unknown): string[] {
  const parsed = safeJson(v, null);
  if (Array.isArray(parsed)) return parsed.map(String);
  if (typeof v === "string" && v.trim()) {
    return v.split(/[,;]\s*/).map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

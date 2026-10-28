/**
 * Result helpers shared by the MCP tools (mcp-tools.ts) and the s1 tools (mcp-s1.ts). Kept apart so the two do not import each other.
 */
export const SITE = "https://singlet.bio";
export const ACCOUNT_URL = `${SITE}/account`;
export const GSM_RE = /^GSM\d+$/;

export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: Record<string, unknown>;
  /** Internal: the text already carries all of structuredContent (withDataText reads and strips it; never sent). */
  textHasData?: true;
}

export function toolResult(text: string, structured: unknown, meta?: Record<string, unknown>, opts?: { textHasData?: boolean }): ToolResult {
  return { content: [{ type: "text", text }], structuredContent: structured, ...(meta ? { _meta: meta } : {}), ...(opts?.textHasData ? { textHasData: true as const } : {}) };
}

/** Longest JSON copy of structuredContent added to the text content. */
export const DATA_TEXT_MAX_CHARS = 16000;

/**
 * JSON of `v` within `max` characters: arrays are cut to fewer items (each cut array ends with a "... N more" string) until it fits, so
 * the shape and the first rows survive. The full value stays in structuredContent.
 */
export function compactJson(v: unknown, max = DATA_TEXT_MAX_CHARS): string {
  const full = JSON.stringify(v);
  if (full.length <= max) return full;
  const cut = (x: unknown, k: number): unknown => {
    if (Array.isArray(x)) {
      const head = x.slice(0, k).map((y) => cut(y, k));
      return x.length > k ? [...head, `... ${x.length - k} more`] : head;
    }
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([a, b]) => [a, cut(b, k)]));
    return typeof x === "string" && x.length > 2000 ? x.slice(0, 2000) + "..." : x;
  };
  for (const k of [50, 25, 12, 6, 3, 1]) {
    const s = JSON.stringify(cut(v, k));
    if (s.length <= max) return s;
  }
  return full.slice(0, max) + "...";
}

/**
 * The MCP specification asks a tool that returns structured content to return it serialized in a text block too, for clients that pass
 * only text to the model (the Anthropic API's MCP connector among them). Without it, data such as find_cells' column runs, slice_cells'
 * byte ranges and get_cells_page's cursor never reach the model. Results whose text already carries the data are left as they are.
 */
export function withDataText(result: ToolResult): ToolResult {
  const { textHasData, ...r } = result;
  if (r.isError || r.structuredContent === undefined || textHasData) return r;
  return { ...r, content: [...r.content, { type: "text", text: `Data (JSON; the same as structuredContent${JSON.stringify(r.structuredContent).length > DATA_TEXT_MAX_CHARS ? ", long lists shortened" : ""}):
${compactJson(r.structuredContent)}` }] };
}

export function toolError(text: string, extra?: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], isError: true, ...(extra ? { _meta: extra } : {}) };
}

export const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));

export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

// R uses singlet::load — attaching the package masks base::load, so a bare
// load() in a user's script is ambiguous.
export const LOADERS = (gse: string) => ({
  python: `import singlet\nadata = singlet.load("${gse}")   # AnnData`,
  r: `library(singlet)\nsce <- singlet::load("${gse}")   # SingleCellExperiment`,
});

/**
 * The response diet (w4_cf section 6, step 5): tool results carry their data in `structuredContent`, and the text, which repeats it, is
 * shortened. It is OFF. DEFAULT_VERBOSE is true and the whole diet sits behind the environment variable MCP_DIET=1, because a client that reads
 * only `content[0].text` loses the data when the text is shortened. With MCP_DIET=1 the default flips to the short text, and a call can still
 * ask for the full one with `verbose: true`; without it the `verbose` argument is ignored and every answer keeps its full text.
 */
export const DEFAULT_VERBOSE = true;
/** Longest shortened text: lines, characters per line, characters in all. */
export const SUMMARY_MAX_LINES = 100;
export const SUMMARY_LINE_CHARS = 400;
export const SUMMARY_TOTAL_CHARS = 9000;

export const dietEnabled = (env: { MCP_DIET?: string } | null | undefined): boolean => env?.MCP_DIET === "1";

export function wantsVerbose(args: Record<string, unknown>, env?: { MCP_DIET?: string } | null): boolean {
  if (!dietEnabled(env)) return true;
  return typeof args.verbose === "boolean" ? args.verbose : DEFAULT_VERBOSE && !dietEnabled(env);
}

/**
 * The short text for a result whose full text is `text`: its lines in order, each clipped to SUMMARY_LINE_CHARS, up to SUMMARY_MAX_LINES lines
 * and SUMMARY_TOTAL_CHARS characters, so a list-shaped answer (search results, per-sample QC, a manifest) keeps its first entries and a
 * count of the rest. Lines are not trimmed unless they are cut (a TSV row keeps its trailing empty columns); the limit is wide enough for a manifest row. A text that fits whole is returned as it is: nothing is cut that the data does not already say.
 */
export function summarize(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let chars = 0;
  let clipped = false;
  let i = 0;
  for (; i < lines.length; i++) {
    if (out.length >= SUMMARY_MAX_LINES || chars >= SUMMARY_TOTAL_CHARS) break;
    let l = lines[i];
    if (l.length > SUMMARY_LINE_CHARS) {
      l = l.slice(0, SUMMARY_LINE_CHARS).replace(/\s+\S*$/, "") + "…";
      clipped = true;
    }
    out.push(l);
    chars += l.length + 1;
  }
  const dropped = lines.slice(i).filter((l) => l.trim()).length;
  if (!dropped && !clipped) return text;
  return out.join("\n").trimEnd() + (dropped ? `\n… ${dropped} more lines.` : "") + "\n(Shortened; the full data is in structuredContent. Pass verbose=true for the full text.)";
}

/** Apply the response diet to a finished result. Off unless MCP_DIET=1; errors, results without structured data and verbose calls pass through. */
export function diet(result: ToolResult, args: Record<string, unknown>, env?: { MCP_DIET?: string } | null): ToolResult {
  if (result.isError || result.structuredContent === undefined || wantsVerbose(args, env)) return result;
  const text = result.content[0]?.text ?? "";
  const short = summarize(text);
  return short === text ? result : { ...result, content: [{ type: "text", text: short }] };
}

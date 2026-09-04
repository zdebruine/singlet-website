/**
 * Per-study "conditions" summary derived from GEO sample characteristics.
 *
 * `gsm.characteristics` is stored as "key: value ;; key: value" (older rows may
 * hold a JSON object). A condition is a characteristics key whose values split
 * the study's samples into a small number of groups (2–12 distinct values) and
 * are not sample identifiers. The result powers the amber condition pills on
 * study cards and the conditions table on the study page.
 */

export interface Condition {
  key: string;
  values: string[];
  counts: number[];
}

export interface ConditionSummary {
  conditions: Condition[];
  /** One-line label for cards, e.g. "age: 6 month vs 24 month". Empty when none. */
  label: string;
  /** Samples that carried any characteristics at all. */
  n_with_characteristics: number;
}

/** Keys that identify a sample rather than describe a condition. */
const ID_KEY_RE =
  /(^|\s)(id|identifier|donor|subject|patient|replicate|rep|barcode|library|sample name|sample|name|index|run|lane|batch|well)($|\s)/i;

const MISSING_VALUES = new Set(["", "n/a", "na", "none", "null", "unknown", "not applicable", "-", "--", "nan"]);
const MAX_VALUE_LEN = 80;
const MIN_DISTINCT = 2;
const MAX_DISTINCT = 12;

/** Parse one characteristics cell into key → value (keys lowercased, whitespace-normalised). */
export function parseCharacteristics(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw == null) return out;

  if (typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const key = normKey(k);
      if (key && v != null) out[key] = normValue(String(v));
    }
    return out;
  }

  const text = String(raw).trim();
  if (!text) return out;

  if (text.startsWith("{")) {
    try {
      return parseCharacteristics(JSON.parse(text));
    } catch {
      /* fall through to delimited parse */
    }
  }

  for (const part of text.split(";;")) {
    const seg = part.trim();
    if (!seg) continue;
    const idx = seg.indexOf(":");
    if (idx <= 0) continue;
    const key = normKey(seg.slice(0, idx));
    const value = normValue(seg.slice(idx + 1));
    if (key) out[key] = value;
  }
  return out;
}

function normKey(k: string): string {
  return k
    .trim()
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/:$/, "")
    .trim();
}

function normValue(v: string): string {
  return v.trim().replace(/\s+/g, " ").replace(/\.$/, "");
}

/** Numeric-aware ordering so "6 month" sorts before "24 month". */
function compareValues(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

export function summarizeConditions(
  samples: { characteristics?: unknown }[]
): ConditionSummary {
  const n = samples.length;
  const parsed = samples.map((s) => parseCharacteristics(s.characteristics));
  const nWith = parsed.filter((p) => Object.keys(p).length > 0).length;

  // key → (lowercased value → { display, count })
  const byKey = new Map<string, Map<string, { display: string; count: number }>>();
  const keyCoverage = new Map<string, number>();

  for (const p of parsed) {
    for (const [key, value] of Object.entries(p)) {
      if (ID_KEY_RE.test(key)) continue;
      const lv = value.toLowerCase();
      if (MISSING_VALUES.has(lv) || value.length > MAX_VALUE_LEN) continue;
      let vals = byKey.get(key);
      if (!vals) {
        vals = new Map();
        byKey.set(key, vals);
      }
      const hit = vals.get(lv);
      if (hit) hit.count += 1;
      else vals.set(lv, { display: value, count: 1 });
      keyCoverage.set(key, (keyCoverage.get(key) ?? 0) + 1);
    }
  }

  const conditions: Condition[] = [];
  for (const [key, vals] of byKey) {
    const distinct = vals.size;
    if (distinct < MIN_DISTINCT || distinct > MAX_DISTINCT) continue;
    // Unique per sample → an identifier in disguise.
    if (n > 1 && distinct === (keyCoverage.get(key) ?? 0) && distinct >= n) continue;
    if (n > 1 && distinct === n) continue;
    const entries = [...vals.values()].sort(
      (a, b) => compareValues(a.display, b.display) || b.count - a.count
    );
    conditions.push({
      key,
      values: entries.map((e) => e.display),
      counts: entries.map((e) => e.count),
    });
  }

  conditions.sort((a, b) => a.values.length - b.values.length || a.key.localeCompare(b.key));

  return { conditions, label: conditionsLabel(conditions), n_with_characteristics: nWith };
}

/** "age: 6 month vs 24 month" (first condition; extra values summarised). */
export function conditionsLabel(conditions: Condition[]): string {
  if (!conditions.length) return "";
  const c = conditions[0];
  const shown = c.values.slice(0, 3);
  const more = c.values.length - shown.length;
  return `${c.key}: ${shown.join(" vs ")}${more > 0 ? ` (+${more} more)` : ""}`;
}

/**
 * D1-specific SQL limits that plain SQLite does not enforce. Shared by the
 * local D1 shim (which emulates them) and the facet builder (which stays
 * under them by construction).
 */

/** D1 rejects compound SELECTs with more than this many terms. */
export const D1_MAX_COMPOUND_TERMS = 5;

/**
 * Count the terms of the largest compound SELECT in `sql`. Approximation:
 * string literals are stripped, then the number of UNION / UNION ALL /
 * INTERSECT / EXCEPT keywords + 1 — good enough to trip the same statements D1
 * trips on (every UNION in this codebase belongs to a single compound).
 */
export function compoundTerms(sql: string): number {
  const noStrings = sql.replace(/'(?:[^']|'')*'/g, "''");
  const m = noStrings.match(/\b(UNION(\s+ALL)?|INTERSECT|EXCEPT)\b/gi);
  return (m?.length ?? 0) + 1;
}

export function assertD1Limits(sql: string): void {
  if (compoundTerms(sql) > D1_MAX_COMPOUND_TERMS) {
    throw new Error("D1_ERROR: too many terms in compound SELECT: SQLITE_ERROR");
  }
}

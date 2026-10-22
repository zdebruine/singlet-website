/**
 * Where the legacy single-file bundles live. Kept apart from study-core so the modules that decide whether such a URL may be named at all
 * (file-facts) and the ones that read it (bundle-reader) can both import it without a cycle.
 *
 * A study has this file only until its migration is retired (v2_migration.status = 'retired', see isLegacyAlive in v2-catalog); callers that
 * emit the URL ask file-facts first.
 */

/** Public base for per-study bundles; one `.singlet` file per GSE. */
export const DATA_BASE = "https://data.singlet.bio";

export function bundleUrl(gse: string): string {
  return `${DATA_BASE}/data/${gse}/${gse}.singlet`;
}

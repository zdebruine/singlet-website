/**
 * Where a study's files are, for every response that names a download.
 *
 * A study has the legacy single file (`data/<GSE>/<GSE>.singlet`) until its migration is retired. Once it is served from store it also has
 * a manifest and one object per sample. After retirement the legacy URL is dead (the object is deleted), so nothing may emit it: every
 * URL for a study's file goes through `legacyUrl` / `downloadUrl` here, and every list of studies is annotated with `attachFileFacts`.
 *
 * The legacy catalog rows (`gse.r2_bundle_key`, `bundle_manifest`, `bundle_index`, `sample_qc`) are left in place by a retirement: they are
 * what the search, the statistics and the sample QC are computed from. Only the file itself is gone.
 */
import { bundleUrl } from "./data-urls";
import { isLegacyAlive, storeServedStudies, type StoreState } from "./store-catalog";
import { storeManifestUrl } from "./store-urls";

/** A study stored in the per-sample layout (schema/032): the manifest, its revision, and whether the old single file still exists. */
export interface StudyStore {
  format: "singlet-store";
  rev: string;
  manifest_url: string;
  n_samples: number;
  bytes: number | null;
  legacy_available: boolean;
}

export function studyStore(gse: string, state: StoreState): StudyStore {
  return {
    format: "singlet-store",
    rev: state.study.rev,
    manifest_url: storeManifestUrl(gse),
    n_samples: state.study.n_samples,
    bytes: state.study.bytes,
    legacy_available: isLegacyAlive(state.migration),
  };
}

/** The legacy file's URL, or null when the study is retired (its file is deleted) or has no file at all. */
export function legacyUrl(gse: string, store: StudyStore | null | undefined, hasLegacy = true): string | null {
  if (!hasLegacy) return null;
  return store && !store.legacy_available ? null : bundleUrl(gse);
}

/** The URL a visitor fetches for the study: the legacy file while it exists, the store manifest after it is retired. Null when neither exists. */
export function downloadUrl(gse: string, store: StudyStore | null | undefined, hasLegacy = true): string | null {
  return legacyUrl(gse, store, hasLegacy) ?? store?.manifest_url ?? null;
}

/** Which of these studies are served from store, as the block a response carries. Two reads per 90 studies, none when no study is migrated. */
export async function studyStoreMap(db: D1Database, gses: string[]): Promise<Map<string, StudyStore>> {
  const out = new Map<string, StudyStore>();
  for (const [gse, state] of await storeServedStudies(db, gses)) out.set(gse, studyStore(gse, state));
  return out;
}

export interface FileRow {
  gse_id: string;
  bundle_key?: string | null;
  bundle_bytes?: number | null;
  store?: StudyStore | null;
  /** DUAL: alias of `store`. */
  v2?: StudyStore | null;
}

/**
 * Put the store block on each row. For a retired study the legacy key is dropped (the object is gone) and `bundle_bytes` becomes the size
 * of the store files, so a client that only looks at `bundle_key`/`bundle_bytes` is never pointed at a deleted file.
 */
export async function attachFileFacts<T extends FileRow>(db: D1Database, rows: T[]): Promise<T[]> {
  if (!rows.length) return rows;
  const facts = await studyStoreMap(db, rows.map((r) => r.gse_id));
  for (const r of rows) {
    const store = facts.get(r.gse_id) ?? null;
    r.store = store;
    r.v2 = store; // DUAL: old name of the block (same object), removed in the cleanup
    if (store && !store.legacy_available) {
      r.bundle_key = null;
      if (store.bytes != null) r.bundle_bytes = store.bytes;
    }
  }
  return rows;
}

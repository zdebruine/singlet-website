/**
 * Where a study's files are, for every response that names a download.
 *
 * A study has the legacy single file (`data/<GSE>/<GSE>.singlet`) until its migration is retired. Once it is served from v2 it also has
 * a manifest and one object per sample. After retirement the legacy URL is dead (the object is deleted), so nothing may emit it: every
 * URL for a study's file goes through `legacyUrl` / `downloadUrl` here, and every list of studies is annotated with `attachFileFacts`.
 *
 * The legacy catalog rows (`gse.r2_bundle_key`, `bundle_manifest`, `bundle_index`, `sample_qc`) are left in place by a retirement: they are
 * what the search, the statistics and the sample QC are computed from. Only the file itself is gone.
 */
import { bundleUrl } from "./data-urls";
import { isLegacyAlive, v2ServedStudies, type V2State } from "./v2-catalog";
import { v2ManifestUrl } from "./v2-urls";

/** A study stored in the v2 per-sample layout (schema/032): the manifest, its revision, and whether the old single file still exists. */
export interface StudyV2 {
  format: "singlet-v2";
  rev: string;
  manifest_url: string;
  n_samples: number;
  bytes: number | null;
  legacy_available: boolean;
}

export function studyV2(gse: string, state: V2State): StudyV2 {
  return {
    format: "singlet-v2",
    rev: state.study.rev,
    manifest_url: v2ManifestUrl(gse),
    n_samples: state.study.n_samples,
    bytes: state.study.bytes,
    legacy_available: isLegacyAlive(state.migration),
  };
}

/** The legacy file's URL, or null when the study is retired (its file is deleted) or has no file at all. */
export function legacyUrl(gse: string, v2: StudyV2 | null | undefined, hasLegacy = true): string | null {
  if (!hasLegacy) return null;
  return v2 && !v2.legacy_available ? null : bundleUrl(gse);
}

/** The URL a visitor fetches for the study: the legacy file while it exists, the v2 manifest after it is retired. Null when neither exists. */
export function downloadUrl(gse: string, v2: StudyV2 | null | undefined, hasLegacy = true): string | null {
  return legacyUrl(gse, v2, hasLegacy) ?? v2?.manifest_url ?? null;
}

/** Which of these studies are served from v2, as the block a response carries. Two reads per 90 studies, none when no study is migrated. */
export async function studyV2Map(db: D1Database, gses: string[]): Promise<Map<string, StudyV2>> {
  const out = new Map<string, StudyV2>();
  for (const [gse, state] of await v2ServedStudies(db, gses)) out.set(gse, studyV2(gse, state));
  return out;
}

export interface FileRow {
  gse_id: string;
  bundle_key?: string | null;
  bundle_bytes?: number | null;
  v2?: StudyV2 | null;
}

/**
 * Put the v2 block on each row. For a retired study the legacy key is dropped (the object is gone) and `bundle_bytes` becomes the size
 * of the v2 files, so a client that only looks at `bundle_key`/`bundle_bytes` is never pointed at a deleted file.
 */
export async function attachFileFacts<T extends FileRow>(db: D1Database, rows: T[]): Promise<T[]> {
  if (!rows.length) return rows;
  const facts = await studyV2Map(db, rows.map((r) => r.gse_id));
  for (const r of rows) {
    const v2 = facts.get(r.gse_id) ?? null;
    r.v2 = v2;
    if (v2 && !v2.legacy_available) {
      r.bundle_key = null;
      if (v2.bytes != null) r.bundle_bytes = v2.bytes;
    }
  }
  return rows;
}

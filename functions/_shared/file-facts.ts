/**
 * Where a study's files are, for every response that names a download.
 *
 * A study has the legacy single file (`data/<GSE>/<GSE>.singlet`) until its migration is retired. Once it is served from s1 it also has
 * a manifest and one object per sample. After retirement the legacy URL is dead (the object is deleted), so nothing may emit it: every
 * URL for a study's file goes through `legacyUrl` / `downloadUrl` here, and every list of studies is annotated with `attachFileFacts`.
 *
 * The legacy catalog rows (`gse.r2_bundle_key`, `bundle_manifest`, `bundle_index`, `sample_qc`) are left in place by a retirement: they are
 * what the search, the statistics and the sample QC are computed from. Only the file itself is gone.
 */
import { bundleUrl } from "./data-urls";
import { isLegacyAlive, s1ServedStudies, type S1State } from "./s1-catalog";
import { s1ManifestUrl } from "./s1-urls";

/** A study stored in the per-sample layout (schema/032): the manifest, its revision, and whether the old single file still exists. */
export interface StudyS1 {
  format: "singlet-s1";
  rev: string;
  manifest_url: string;
  n_samples: number;
  bytes: number | null;
  legacy_available: boolean;
}

export function studyS1(gse: string, state: S1State): StudyS1 {
  return {
    format: "singlet-s1",
    rev: state.study.rev,
    manifest_url: s1ManifestUrl(gse),
    n_samples: state.study.n_samples,
    bytes: state.study.bytes,
    legacy_available: isLegacyAlive(state.migration),
  };
}

/** The legacy file's URL, or null when the study is retired (its file is deleted) or has no file at all. */
export function legacyUrl(gse: string, s1: StudyS1 | null | undefined, hasLegacy = true): string | null {
  if (!hasLegacy) return null;
  return s1 && !s1.legacy_available ? null : bundleUrl(gse);
}

/** The URL a visitor fetches for the study: the legacy file while it exists, the s1 manifest after it is retired. Null when neither exists. */
export function downloadUrl(gse: string, s1: StudyS1 | null | undefined, hasLegacy = true): string | null {
  return legacyUrl(gse, s1, hasLegacy) ?? s1?.manifest_url ?? null;
}

/** Which of these studies are served from s1, as the block a response carries. Two reads per 90 studies, none when no study is migrated. */
export async function studyS1Map(db: D1Database, gses: string[]): Promise<Map<string, StudyS1>> {
  const out = new Map<string, StudyS1>();
  for (const [gse, state] of await s1ServedStudies(db, gses)) out.set(gse, studyS1(gse, state));
  return out;
}

export interface FileRow {
  gse_id: string;
  bundle_key?: string | null;
  bundle_bytes?: number | null;
  s1?: StudyS1 | null;
  /** DUAL: alias of `s1`. */
  v2?: StudyS1 | null;
}

/**
 * Put the s1 block on each row. For a retired study the legacy key is dropped (the object is gone) and `bundle_bytes` becomes the size
 * of the s1 files, so a client that only looks at `bundle_key`/`bundle_bytes` is never pointed at a deleted file.
 */
export async function attachFileFacts<T extends FileRow>(db: D1Database, rows: T[]): Promise<T[]> {
  if (!rows.length) return rows;
  const facts = await studyS1Map(db, rows.map((r) => r.gse_id));
  for (const r of rows) {
    const s1 = facts.get(r.gse_id) ?? null;
    r.s1 = s1;
    r.v2 = s1; // DUAL: old name of the block (same object), removed in the cleanup
    if (s1 && !s1.legacy_available) {
      r.bundle_key = null;
      if (s1.bytes != null) r.bundle_bytes = s1.bytes;
    }
  }
  return rows;
}

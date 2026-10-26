/**
 * The catalog in D1 (schema/032_v2_catalog.sql, renamed by schema/038_s1_catalog.sql): one row per migrated study (`s1_study`), one per sample
 * object (`s1_sample`), one per study for migration state (`s1_migration`). Format: docs/format-s1.md in the
 * singlet-bio repository, sections 2, 7, 8 and 10.
 *
 * Two halves:
 *   - ingest: parseStudyManifest validates a posted study manifest (s1/m/<GSE>.json) and ingestStatements turns it
 *     into upserts (POST /api/ingest/s1-study);
 *   - reads: small typed helpers that never scan JSON across studies. The big JSON columns (members_json,
 *     cell_stats_json) come back for one sample, or for an explicit page of samples, never for a whole study.
 *
 * A study is served from s1 when it has a s1_study row AND its migration row says verified or retired (`isServedFromS1`).
 * There is no implicit live: a manifest posted without a migration block is recorded as `uploaded`, and `verified` /
 * `retired` need `verify_ok`. Sample rows are keyed (gse_id, rev, gsm_id) (schema/033) so a new rev is written beside the
 * served one and s1_study.rev flips last. Every reader tolerates missing tables: before schema/032 is applied, everything
 * is "not migrated" and the legacy path answers.
 */
import { isRestrictedMember, isUnofferedMember } from "./restricted";
import { sampleServedSql } from "./alpha";
import { resolveModalities } from "./modalities";

export const GSE_RE = /^GSE\d+$/;
export const GSM_RE = /^GSM\d+$/;
/** s1/s/<GSM>/<digest16 hex>.s1 — the key of an immutable sample object. DUAL: the old v2/s/....s2 form is still accepted (removed in the cleanup). */
export const SAMPLE_KEY_RE = /^(?:s1|v2)\/s\/(GSM\d+)\/([0-9a-f]{32})\.(?:s1|s2)$/;
const REV_RE = /^[0-9a-f]{16}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

/** Limits on one POST. A study with more samples than MAX_SAMPLES_PER_POST is sent in slices (`final: false` until the last). */
export const MAX_SAMPLES_PER_POST = 400;
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_MEMBERS_JSON = 128 * 1024;
const MAX_STATS_JSON = 16 * 1024;
const MAX_SMALL_JSON = 8 * 1024;

export const MIGRATION_STATUSES = ["pending", "running", "uploaded", "verified", "failed", "retired"] as const;
export type MigrationStatus = (typeof MIGRATION_STATUSES)[number];
/** Statuses under which the study is answered from s1. */
const SERVED_STATUSES: readonly string[] = ["verified", "retired"];

export const manifestKey = (gse: string) => `s1/m/${gse}.json`;
/** DUAL: the key of a manifest written before the rename. */
export const legacyManifestKey = (gse: string) => `v2/m/${gse}.json`;
/** Manifest formats accepted on ingest; writers emit only "singlet-s1". DUAL: "singlet-v2". */
const MANIFEST_FORMATS: readonly unknown[] = ["singlet-s1", "singlet-v2"];

// ── rows ────────────────────────────────────────────────────────────────────

export interface S1StudyRow {
  gse_id: string;
  manifest_key: string;
  rev: string;
  bytes: number | null;
  n_samples: number;
  created_at: string | null;
  legacy_bytes: number | null;
  manifest_bytes: number | null;
  manifest_sha256: string | null;
  n_cells_called: number | null;
  reference_build: string | null;
  packs_json: string | null;
  pipeline_json: string | null;
  updated_at: string;
}

export interface S1MigrationRow {
  gse_id: string;
  status: MigrationStatus;
  legacy_key: string | null;
  legacy_etag: string | null;
  legacy_bytes: number | null;
  s1_bytes: number | null;
  n_samples: number | null;
  members_by_kind: string | null;
  verify_ok: number | null;
  commit_sha: string | null;
  migrated_at: string | null;
  verified_at: string | null;
  ledger_key: string | null;
  error: string | null;
  updated_at: string;
}

const STUDY_COLUMNS =
  "gse_id, manifest_key, rev, bytes, n_samples, created_at, legacy_bytes, manifest_bytes, manifest_sha256, n_cells_called, reference_build, packs_json, pipeline_json, updated_at";
/**
 * The legacy-bundle retirement switch (schema/038, `s1_flags.legacy_bundles`). While it says 'retired', a study whose migration is
 * `verified` is read as `retired`: no legacy URL is named, nothing reads its legacy file, and the data-guard Worker refuses it. One
 * UPDATE flips it for every verified study at once and one flips it back (no deploy); the stored status is never changed.
 */
export const LEGACY_RETIRED_FLAG_SQL = `EXISTS (SELECT 1 FROM s1_flags f WHERE f.name = 'legacy_bundles' AND f.value = 'retired')`;
/** SQL: the migration row `alias` counts as retired (its legacy file is not offered or read). */
export const legacyRetiredSql = (alias: string): string =>
  `(${alias}.status = 'retired' OR (${alias}.status = 'verified' AND ${LEGACY_RETIRED_FLAG_SQL}))`;
/** The status readers see: `verified` reads as `retired` while the switch is on. */
const EFFECTIVE_STATUS = `CASE WHEN status = 'verified' AND ${LEGACY_RETIRED_FLAG_SQL} THEN 'retired' ELSE status END AS status`;

const MIGRATION_COLUMNS =
  `gse_id, ${EFFECTIVE_STATUS}, legacy_key, legacy_etag, legacy_bytes, s1_bytes, n_samples, members_by_kind, verify_ok, commit_sha, migrated_at, verified_at, ledger_key, error, updated_at`;

/** The columns of a sample row that are cheap to read for many samples. */
export interface S1SampleLight {
  gse_id: string;
  gsm_id: string;
  key: string;
  bytes: number | null;
  sha256: string | null;
  n_columns: number | null;
  n_called: number | null;
  n_members: number | null;
  median_umi: number | null;
  median_genes: number | null;
  modalities: string | null;
  rev: string;
}

export interface S1SampleFull extends S1SampleLight {
  members_json: string | null;
  cell_stats_json: string | null;
}

/** One member of a sample object as the manifest records it. Extra fields (codec, codec version, row_order, meta) pass through untouched. */
export interface S1Member {
  kind: number;
  off: number;
  len: number;
  digest?: string;
  chunk_cols?: number;
  chunk_index?: [number, number];
  nnz?: number;
  [extra: string]: unknown;
}

const LIGHT_COLUMNS = "gse_id, gsm_id, key, bytes, sha256, n_columns, n_called, n_members, median_umi, median_genes, modalities, rev";

// ── ingest: validation ──────────────────────────────────────────────────────

/** A problem with the posted content. `status` is the HTTP status to answer with. */
export class S1ManifestError extends Error {
  constructor(
    message: string,
    readonly status: number = 400
  ) {
    super(message);
    this.name = "S1ManifestError";
  }
}

export interface ParsedSample {
  gsm: string;
  key: string;
  bytes: number;
  sha256: string | null;
  n_columns: number | null;
  n_called: number | null;
  members: Record<string, S1Member>;
  members_json: string;
  stats_json: string | null;
  median_umi: number | null;
  median_genes: number | null;
  modalities: string[];
}

export interface ParsedMigration {
  status: MigrationStatus;
  legacy_key: string | null;
  legacy_etag: string | null;
  legacy_bytes: number | null;
  s1_bytes: number | null;
  n_samples: number | null;
  members_by_kind: string | null;
  verify_ok: number | null;
  commit_sha: string | null;
  migrated_at: string | null;
  verified_at: string | null;
  ledger_key: string | null;
  error: string | null;
}

export interface ParsedStudy {
  gse: string;
  /** The key the manifest lives at: s1/m/<GSE>.json, or v2/m/<GSE>.json when the manifest is in the old form. */
  manifest_key: string;
  rev: string;
  bytes: number | null;
  n_samples: number;
  created_at: string | null;
  legacy_bytes: number | null;
  manifest_bytes: number | null;
  manifest_sha256: string | null;
  n_cells_called: number | null;
  reference_build: string | null;
  packs_json: string | null;
  pipeline_json: string | null;
  samples: ParsedSample[];
}

export interface ParsedIngest {
  study: ParsedStudy | null;
  /** Always set. When the body had none it is the default `uploaded` (see `migrationImplicit`). */
  migration: ParsedMigration | null;
  /** The body carried no migration block: the default row is only written when the study's rev changes. */
  migrationImplicit: boolean;
  /** Rewrite rows even when this rev is already stored (default: an already stored rev is left alone). */
  force: boolean;
  gse: string;
  /** false on every slice but the last of a sliced post: the older-rev rows are removed only on the final one. */
  final: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const optCount = (v: unknown, what: string): number | null => {
  if (v === undefined || v === null) return null;
  if (!isCount(v)) throw new S1ManifestError(`${what} must be a non-negative integer`);
  return v;
};
const optNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const optStr = (v: unknown, what: string, max = 512): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || v.length > max) throw new S1ManifestError(`${what} must be a string of at most ${max} characters`);
  return v;
};

function sha256Field(v: unknown): string {
  if (typeof v !== "string" || !SHA256_RE.test(v)) throw new S1ManifestError("manifest_sha256 must be 64 lowercase hex characters");
  return v;
}

function smallJson(v: unknown, what: string, max: number): string | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) throw new S1ManifestError(`${what} must be an object`);
  const s = JSON.stringify(v);
  if (s.length > max) throw new S1ManifestError(`${what} is over ${max} bytes`);
  return s;
}

function parseSample(raw: unknown, i: number, gse: string): ParsedSample {
  if (!isObj(raw)) throw new S1ManifestError(`samples[${i}] is not an object`);
  const gsm = raw.gsm;
  if (typeof gsm !== "string" || !GSM_RE.test(gsm)) throw new S1ManifestError(`samples[${i}].gsm must look like GSM123`);
  const where = `samples[${i}] (${gsm})`;
  const key = raw.key;
  const km = typeof key === "string" ? SAMPLE_KEY_RE.exec(key) : null;
  if (!km || km[1] !== gsm) throw new S1ManifestError(`${where}: key must be s1/s/${gsm}/<32 hex>.s1`);
  if (!isCount(raw.bytes)) throw new S1ManifestError(`${where}: bytes must be a non-negative integer`);
  const sha = raw.sha256;
  if (sha !== undefined && sha !== null && (typeof sha !== "string" || !SHA256_RE.test(sha))) throw new S1ManifestError(`${where}: sha256 must be 64 lowercase hex characters`);
  if (!isObj(raw.members)) throw new S1ManifestError(`${where}: members must be an object`);

  const members: Record<string, S1Member> = {};
  const restricted: string[] = [];
  for (const [name, m] of Object.entries(raw.members)) {
    if (!name || name.length > 256 || name.startsWith("/") || name.includes("..")) throw new S1ManifestError(`${where}: bad member name '${name.slice(0, 80)}'`);
    // Restricted members (per-donor genotype layers) must not be in a public object at all: refuse, do not just hide them.
    if (isRestrictedMember(name)) {
      restricted.push(name);
      continue;
    }
    if (!isObj(m) || !isCount(m.kind) || m.kind < 1 || m.kind > 5 || !isCount(m.off) || !isCount(m.len)) {
      throw new S1ManifestError(`${where}: member '${name}' needs integer kind (1-5), off and len`);
    }
    members[name] = m as S1Member;
  }
  if (restricted.length) {
    throw new S1ManifestError(`${where}: restricted members must not be in a public sample object: ${restricted.slice(0, 5).join(", ")}`, 422);
  }
  const membersJson = JSON.stringify(members);
  if (membersJson.length > MAX_MEMBERS_JSON) throw new S1ManifestError(`${where}: members is over ${MAX_MEMBERS_JSON} bytes`);
  const statsJson = smallJson(raw.stats, `${where}: stats`, MAX_STATS_JSON);
  const stats = isObj(raw.stats) ? raw.stats : {};

  return {
    gsm,
    key: key as string,
    bytes: raw.bytes,
    sha256: typeof sha === "string" ? sha : null,
    n_columns: optCount(raw.n_columns, `${where}: n_columns`),
    n_called: optCount(raw.n_called, `${where}: n_called`),
    members,
    members_json: membersJson,
    stats_json: statsJson,
    median_umi: optNum(stats.median_umi),
    median_genes: optNum(stats.median_genes),
    modalities: resolveModalities(Object.keys(members)).map((r) => r.modality.name),
  };
}

function parseMigration(raw: unknown, legacy: Record<string, unknown> | null): ParsedMigration {
  if (!isObj(raw)) throw new S1ManifestError("migration must be an object");
  const status = raw.status;
  if (typeof status !== "string" || !(MIGRATION_STATUSES as readonly string[]).includes(status)) {
    throw new S1ManifestError(`migration.status must be one of ${MIGRATION_STATUSES.join(", ")}`);
  }
  const verify = raw.verify_ok;
  const verified = verify === true || verify === 1;
  if (SERVED_STATUSES.includes(status) && !verified) {
    throw new S1ManifestError(`migration.status '${status}' makes the study public and needs verify_ok: true (the bit-for-bit verification passed)`, 422);
  }
  return {
    status: status as MigrationStatus,
    legacy_key: optStr(raw.legacy_key ?? legacy?.key, "migration.legacy_key", 256),
    legacy_etag: optStr(raw.legacy_etag ?? legacy?.etag, "migration.legacy_etag", 128),
    legacy_bytes: optCount(raw.legacy_bytes ?? legacy?.bytes, "migration.legacy_bytes"),
    s1_bytes: optCount(raw.s1_bytes, "migration.s1_bytes"),
    n_samples: optCount(raw.n_samples, "migration.n_samples"),
    members_by_kind: smallJson(raw.members_by_kind, "migration.members_by_kind", MAX_SMALL_JSON),
    verify_ok: verify === undefined || verify === null ? null : verify === true || verify === 1 ? 1 : 0,
    commit_sha: optStr(raw.commit_sha, "migration.commit_sha", 64),
    migrated_at: optStr(raw.migrated_at ?? legacy?.migrated_at, "migration.migrated_at", 40),
    verified_at: optStr(raw.verified_at, "migration.verified_at", 40),
    ledger_key: optStr(raw.ledger_key, "migration.ledger_key", 256),
    error: optStr(raw.error, "migration.error", 2000),
  };
}

/**
 * Body: `{ manifest, final?, force?, migration?, manifest_bytes?, manifest_sha256? }` (a study manifest, format-s1.md section 7; `study_files`
 * and anything else not named here is ignored, so a poster should drop it to keep the body small) or `{ gse_id, migration }` (state only).
 * A manifest may carry a slice of the samples when it also carries `n_samples` and, if the sum of bytes is not
 * derivable from the slice, `bytes`; send `final: false` on every slice but the last.
 */
export function parseIngestBody(body: unknown): ParsedIngest {
  if (!isObj(body)) throw new S1ManifestError("Body must be a JSON object");
  const final = body.final === undefined ? true : body.final === true;
  if (body.final !== undefined && typeof body.final !== "boolean") throw new S1ManifestError("final must be true or false");

  if (body.manifest === undefined) {
    const gse = body.gse_id;
    if (typeof gse !== "string" || !GSE_RE.test(gse)) throw new S1ManifestError("Send { manifest } or { gse_id, migration }");
    if (body.migration === undefined) throw new S1ManifestError("Nothing to write: migration is missing");
    return { study: null, migration: parseMigration(body.migration, null), migrationImplicit: false, force: false, gse, final };
  }

  const m = body.manifest;
  if (!isObj(m)) throw new S1ManifestError("manifest must be an object");
  if (!MANIFEST_FORMATS.includes(m.format)) throw new S1ManifestError("manifest.format must be 'singlet-s1' (or the old 'singlet-v2')");
  if (m.manifest_version !== 1) throw new S1ManifestError("manifest.manifest_version must be 1");
  const gse = m.gse;
  if (typeof gse !== "string" || !GSE_RE.test(gse)) throw new S1ManifestError("manifest.gse must look like GSE123");
  if (typeof m.rev !== "string" || !REV_RE.test(m.rev)) throw new S1ManifestError("manifest.rev must be 16 lowercase hex characters");
  if (m.manifest_key !== undefined && m.manifest_key !== manifestKey(gse) && m.manifest_key !== legacyManifestKey(gse)) throw new S1ManifestError(`manifest.manifest_key must be ${manifestKey(gse)}`);
  if (!Array.isArray(m.samples) || m.samples.length === 0) throw new S1ManifestError("manifest.samples must be a non-empty array");
  if (m.samples.length > MAX_SAMPLES_PER_POST) {
    throw new S1ManifestError(`At most ${MAX_SAMPLES_PER_POST} samples per post; send slices with n_samples, bytes and final: false until the last`, 413);
  }
  const samples = m.samples.map((s, i) => parseSample(s, i, gse));
  const seen = new Set<string>();
  for (const s of samples) {
    if (seen.has(s.gsm)) throw new S1ManifestError(`${s.gsm} appears twice`);
    seen.add(s.gsm);
  }

  const nSamples = m.n_samples === undefined ? samples.length : m.n_samples;
  if (!isCount(nSamples) || nSamples < samples.length) throw new S1ManifestError("manifest.n_samples must be an integer of at least the samples sent");
  const sliced = nSamples !== samples.length;
  if (sliced && m.bytes === undefined) throw new S1ManifestError("A slice of a study needs manifest.bytes (the total over all samples)");
  const legacy = isObj(m.legacy) ? m.legacy : null;
  const packs = smallJson(m.packs, "manifest.packs", MAX_SMALL_JSON);
  const pipeline = smallJson(m.pipeline, "manifest.pipeline", MAX_SMALL_JSON);

  return {
    gse,
    final,
    study: {
      gse,
      manifest_key: typeof m.manifest_key === "string" ? m.manifest_key : m.format === "singlet-v2" ? legacyManifestKey(gse) : manifestKey(gse),
      rev: m.rev,
      bytes: m.bytes === undefined ? samples.reduce((n, s) => n + s.bytes, 0) : optCount(m.bytes, "manifest.bytes"),
      n_samples: nSamples,
      created_at: optStr(m.created_at, "manifest.created_at", 40),
      legacy_bytes: optCount(legacy?.bytes, "manifest.legacy.bytes"),
      manifest_bytes: optCount(body.manifest_bytes, "manifest_bytes"),
      manifest_sha256: body.manifest_sha256 === undefined || body.manifest_sha256 === null ? null : sha256Field(body.manifest_sha256),
      n_cells_called:
        m.n_cells_called !== undefined ? optCount(m.n_cells_called, "manifest.n_cells_called") : sliced ? null : samples.reduce((n, s) => n + (s.n_called ?? 0), 0),
      reference_build: optStr(m.reference_build, "manifest.reference_build", 128),
      packs_json: packs,
      pipeline_json: pipeline,
      samples,
    },
    // No implicit live: a manifest posted without a migration block is only `uploaded`.
    migration: body.migration === undefined ? parseMigration({ status: "uploaded" }, legacy) : parseMigration(body.migration, legacy),
    migrationImplicit: body.migration === undefined,
    force: body.force === true,
  };
}

// ── ingest: statements ──────────────────────────────────────────────────────

export interface IngestPlan {
  batches: D1PreparedStatement[][];
  tail: D1PreparedStatement[];
  /** The posted rev is the one already stored: sample and study rows are not rewritten. */
  unchanged: boolean;
}

/**
 * The writes for one post, in the order that keeps every reader on one revision:
 *   1. the new rev's sample rows (primary key gse_id, rev, gsm_id, so they sit beside the stored rev's rows and nobody reads them yet);
 *   2. in one atomic batch, on the final post: the s1_study row (this flips the rev), the removal of the older revs' sample rows, the
 *      migration row.
 * `storedRev` is the rev s1_study holds now (null when the study is new). When it equals the posted rev, nothing of the study is rewritten (rows
 * written: only the migration row, and only when the body carried one) unless the body says `force`.
 * Rows written, D1 counting table and index rows: a new sample 3 (row, primary-key index, gsm_id index), a deleted sample 3, the study row 1,
 * the migration row 1 or 2.
 */
export function ingestStatements(db: D1Database, p: ParsedIngest, stamp: string, storedRev: string | null = null): IngestPlan {
  const batches: D1PreparedStatement[][] = [];
  const tail: D1PreparedStatement[] = [];
  const study = p.study;
  const unchanged = !!study && storedRev === study.rev && !p.force;
  if (study && !unchanged) {
    let batch: D1PreparedStatement[] = [];
    for (const s of study.samples) {
      batch.push(
        db
          .prepare(
            `INSERT INTO s1_sample (gse_id, gsm_id, key, bytes, sha256, n_columns, n_called, n_members, median_umi, median_genes, modalities, members_json, cell_stats_json, rev, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(gse_id, rev, gsm_id) DO ${
               p.force
                 ? `UPDATE SET key = excluded.key, bytes = excluded.bytes, sha256 = excluded.sha256,
               n_columns = excluded.n_columns, n_called = excluded.n_called, n_members = excluded.n_members,
               median_umi = excluded.median_umi, median_genes = excluded.median_genes, modalities = excluded.modalities,
               members_json = excluded.members_json, cell_stats_json = excluded.cell_stats_json, updated_at = excluded.updated_at`
                 : "NOTHING"
             }`
          )
          .bind(
            study.gse, s.gsm, s.key, s.bytes, s.sha256, s.n_columns, s.n_called, Object.keys(s.members).length,
            s.median_umi, s.median_genes, JSON.stringify(s.modalities), s.members_json, s.stats_json, study.rev, stamp
          )
      );
      if (batch.length === 50) {
        batches.push(batch);
        batch = [];
      }
    }
    if (batch.length) batches.push(batch);

    if (p.final) {
      tail.push(
        db
          .prepare(
            `INSERT INTO s1_study (gse_id, manifest_key, rev, bytes, n_samples, created_at, legacy_bytes, manifest_bytes, manifest_sha256, n_cells_called, reference_build, packs_json, pipeline_json, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(gse_id) DO UPDATE SET manifest_key = excluded.manifest_key, rev = excluded.rev, bytes = excluded.bytes,
               n_samples = excluded.n_samples, created_at = excluded.created_at, legacy_bytes = excluded.legacy_bytes,
               manifest_bytes = excluded.manifest_bytes, manifest_sha256 = excluded.manifest_sha256, n_cells_called = excluded.n_cells_called,
               reference_build = excluded.reference_build, packs_json = excluded.packs_json, pipeline_json = excluded.pipeline_json,
               updated_at = excluded.updated_at`
          )
          .bind(
            study.gse, study.manifest_key, study.rev, study.bytes, study.n_samples, study.created_at, study.legacy_bytes,
            study.manifest_bytes, study.manifest_sha256, study.n_cells_called, study.reference_build, study.packs_json, study.pipeline_json, stamp
          )
      );
      // After the flip, in the same transaction: the sample rows of every other rev. Indexed by the primary key prefix (gse_id).
      tail.push(db.prepare(`DELETE FROM s1_sample WHERE gse_id = ? AND rev != ?`).bind(study.gse, study.rev));
    }
  }
  const mg = p.migration;
  // A body without a migration block must not touch the migration row of a rev that is already stored (it would demote a verified study).
  // The migration row changes together with the flip, so only on the final post (a slice of a new rev must not demote the served one).
  if (mg && p.final && !(p.migrationImplicit && unchanged)) {
    tail.push(
      db
        .prepare(
          `INSERT INTO s1_migration (gse_id, status, legacy_key, legacy_etag, legacy_bytes, s1_bytes, n_samples, members_by_kind, verify_ok, commit_sha, migrated_at, verified_at, ledger_key, error, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(gse_id) DO UPDATE SET status = excluded.status,
             legacy_key = COALESCE(excluded.legacy_key, s1_migration.legacy_key),
             legacy_etag = COALESCE(excluded.legacy_etag, s1_migration.legacy_etag),
             legacy_bytes = COALESCE(excluded.legacy_bytes, s1_migration.legacy_bytes),
             s1_bytes = COALESCE(excluded.s1_bytes, s1_migration.s1_bytes),
             n_samples = COALESCE(excluded.n_samples, s1_migration.n_samples),
             members_by_kind = COALESCE(excluded.members_by_kind, s1_migration.members_by_kind),
             verify_ok = excluded.verify_ok,
             commit_sha = COALESCE(excluded.commit_sha, s1_migration.commit_sha),
             migrated_at = COALESCE(excluded.migrated_at, s1_migration.migrated_at),
             verified_at = COALESCE(excluded.verified_at, s1_migration.verified_at),
             ledger_key = COALESCE(excluded.ledger_key, s1_migration.ledger_key),
             error = excluded.error, updated_at = excluded.updated_at`
        )
        .bind(
          p.gse, mg.status, mg.legacy_key, mg.legacy_etag, mg.legacy_bytes, mg.s1_bytes, mg.n_samples, mg.members_by_kind, mg.verify_ok,
          mg.commit_sha, mg.migrated_at, mg.verified_at, mg.ledger_key, mg.error, stamp
        )
    );
  }
  return { batches, tail, unchanged };
}

// ── reads ───────────────────────────────────────────────────────────────────

/**
 * The s1 tables may not exist yet (schema/032 not applied). Nothing is probed up front: the first statement that finds a table missing
 * is remembered for a minute (per database binding), during which every read answers "not migrated" without touching D1, and after which
 * the tables are tried again, so applying the schema takes effect without a redeploy and the happy path pays nothing.
 */
const tablesMissing = new WeakMap<object, number>();
const missingNow = (db: D1Database) => Date.now() - (tablesMissing.get(db) ?? -Infinity) < 60_000;

async function guarded<T>(db: D1Database, fallback: T, run: () => Promise<T>): Promise<T> {
  if (missingNow(db)) return fallback;
  try {
    return await run();
  } catch (e) {
    if (/no such table/i.test(String(e))) tablesMissing.set(db, Date.now());
    return fallback;
  }
}

/** Whether the s1 tables exist (one zero-row statement unless a recent answer is remembered). */
export async function s1Available(db: D1Database): Promise<boolean> {
  return guarded(db, false, async () => {
    await db.prepare(`SELECT gse_id FROM s1_study LIMIT 0`).all();
    return true;
  });
}

export async function getS1Study(db: D1Database, gse: string): Promise<S1StudyRow | null> {
  return guarded(db, null, () => db.prepare(`SELECT ${STUDY_COLUMNS} FROM s1_study WHERE gse_id = ?`).bind(gse).first<S1StudyRow>());
}

export async function getS1Migration(db: D1Database, gse: string): Promise<S1MigrationRow | null> {
  return guarded(db, null, () => db.prepare(`SELECT ${MIGRATION_COLUMNS} FROM s1_migration WHERE gse_id = ?`).bind(gse).first<S1MigrationRow>());
}

export interface S1State {
  study: S1StudyRow;
  migration: S1MigrationRow | null;
}

/** True when a study with this migration state is answered from s1. */
export function isServedFromS1(migration: Pick<S1MigrationRow, "status"> | null): boolean {
  return migration !== null && SERVED_STATUSES.includes(migration.status);
}

/**
 * Whether the legacy single-file bundle (`data/<GSE>/<GSE>.singlet`) still exists for a study with this migration state. It is gone
 * once the migration is `retired`; every place that names the legacy URL, reads the legacy file or counts on its index asks this.
 * No migration row at all means the study was never moved: the legacy file is the only file.
 */
export function isLegacyAlive(migration: Pick<S1MigrationRow, "status"> | null): boolean {
  return migration?.status !== "retired";
}

/** The study's s1 state when it is served from s1, otherwise null (not migrated, still migrating, failed). Two primary-key reads. */
export async function getS1State(db: D1Database, gse: string): Promise<S1State | null> {
  const study = await getS1Study(db, gse);
  if (!study) return null;
  const migration = await getS1Migration(db, gse);
  return isServedFromS1(migration) ? { study, migration } : null;
}

/** What the catalog holds for a study, served or not: for callers that also need to know the study is being moved. Two keyed reads. */
export interface S1Presence {
  study: S1StudyRow | null;
  migration: S1MigrationRow | null;
}

export async function getS1Presence(db: D1Database, gse: string): Promise<S1Presence> {
  const [study, migration] = await Promise.all([getS1Study(db, gse), getS1Migration(db, gse)]);
  return { study, migration };
}

/** The served state, if the presence says the study is served from s1. */
export function servedState(p: S1Presence): S1State | null {
  return p.study && p.migration && isServedFromS1(p.migration) ? { study: p.study, migration: p.migration } : null;
}

/** Which of these studies are served from s1 (chunks of 90 ids, two reads per chunk). */
export async function s1ServedStudies(db: D1Database, gses: string[]): Promise<Map<string, S1State>> {
  const out = new Map<string, S1State>();
  if (!gses.length) return out;
  const ids = [...new Set(gses)];
  return guarded(db, out, async () => {
    for (let i = 0; i < ids.length; i += 90) {
      const part = ids.slice(i, i + 90);
      const marks = part.map(() => "?").join(",");
      const studies = await db.prepare(`SELECT ${STUDY_COLUMNS} FROM s1_study WHERE gse_id IN (${marks})`).bind(...part).all<S1StudyRow>();
      if (!studies.results?.length) continue;
      const migrations = await db.prepare(`SELECT ${MIGRATION_COLUMNS} FROM s1_migration WHERE gse_id IN (${marks})`).bind(...part).all<S1MigrationRow>();
      const byGse = new Map<string, S1MigrationRow>((migrations.results ?? []).map((m): [string, S1MigrationRow] => [m.gse_id, m]));
      for (const st of studies.results) {
        const migration = byGse.get(st.gse_id) ?? null;
        if (isServedFromS1(migration)) out.set(st.gse_id, { study: st, migration });
      }
    }
    return out;
  });
}

/**
 * One sample with its members and stats under the study's revision (`rev`, or the one s1_study holds now); null when the study has no such
 * sample. One keyed read.
 */
export async function getS1Sample(db: D1Database, gse: string, gsm: string, rev?: string): Promise<S1SampleFull | null> {
  return guarded(db, null, () =>
    db
      .prepare(
        `SELECT ${LIGHT_COLUMNS}, members_json, cell_stats_json FROM s1_sample
          WHERE gse_id = ? AND gsm_id = ? AND rev = ${rev ? "?" : "(SELECT rev FROM s1_study WHERE gse_id = ?)"} AND ${sampleServedSql("s1_sample.gsm_id")}`
      )
      .bind(gse, gsm, rev ?? gse)
      .first<S1SampleFull>()
  );
}

/**
 * A page of a study's samples without the JSON columns, in gsm order, under the study's current `rev` (rows written
 * by a slice that has not been finalised yet are not listed). `after` is the last gsm_id of the previous page.
 * `limit` is capped at 500.
 */
export async function listS1Samples(db: D1Database, gse: string, rev: string, opts: { limit?: number; after?: string } = {}): Promise<S1SampleLight[]> {
  const limit = Math.min(500, Math.max(1, Math.floor(opts.limit ?? 500)));
  return guarded(db, [] as S1SampleLight[], async () => {
    const rs = await db
      .prepare(`SELECT ${LIGHT_COLUMNS} FROM s1_sample WHERE gse_id = ? AND rev = ? AND gsm_id > ? AND ${sampleServedSql("s1_sample.gsm_id")} ORDER BY gsm_id LIMIT ?`)
      .bind(gse, rev, opts.after ?? "", limit)
      .all<S1SampleLight>();
    return rs.results ?? [];
  });
}

/** Several samples of one study with members_json under its revision, at most 50 at a time (the caller pages). */
export async function getS1Samples(db: D1Database, gse: string, gsms: string[], rev?: string): Promise<S1SampleFull[]> {
  if (!gsms.length) return [];
  const ids = [...new Set(gsms)].slice(0, 50);
  return guarded(db, [] as S1SampleFull[], async () => {
    const rs = await db
      .prepare(
        `SELECT ${LIGHT_COLUMNS}, members_json, cell_stats_json FROM s1_sample
          WHERE gse_id = ? AND rev = ${rev ? "?" : "(SELECT rev FROM s1_study WHERE gse_id = ?)"} AND gsm_id IN (${ids.map(() => "?").join(",")}) AND ${sampleServedSql("s1_sample.gsm_id")} ORDER BY gsm_id`
      )
      .bind(gse, rev ?? gse, ...ids)
      .all<S1SampleFull>();
    return rs.results ?? [];
  });
}

/** Parse members_json defensively. */
export function parseMembers(json: string | null | undefined): Record<string, S1Member> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return isObj(v) ? (v as Record<string, S1Member>) : {};
  } catch {
    return {};
  }
}

export function parseJsonObject(json: string | null | undefined): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

/** The members a visitor may see (restricted ones are refused at ingest; this is the second line; layers Alpha does not offer are not listed). */
export function publicMemberNames(members: Record<string, unknown>): string[] {
  return Object.keys(members).filter((n) => !isUnofferedMember(n)).sort();
}

/** Studies' modality names per sample, parsed from the compact `modalities` column. */
export function parseModalities(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * The catalog in D1 (schema/032_v2_catalog.sql, renamed by schema/036_store_rename.sql): one row per migrated study (`store_study`), one per sample
 * object (`store_sample`), one per study for migration state (`store_migration`). Format: docs/format-store.md in the
 * singlet-bio repository, sections 2, 7, 8 and 10.
 *
 * Two halves:
 *   - ingest: parseStudyManifest validates a posted study manifest (store/m/<GSE>.json) and ingestStatements turns it
 *     into upserts (POST /api/ingest/store-study);
 *   - reads: small typed helpers that never scan JSON across studies. The big JSON columns (members_json,
 *     cell_stats_json) come back for one sample, or for an explicit page of samples, never for a whole study.
 *
 * A study is served from store when it has a store_study row AND its migration row says verified or retired (`isServedFromStore`).
 * There is no implicit live: a manifest posted without a migration block is recorded as `uploaded`, and `verified` /
 * `retired` need `verify_ok`. Sample rows are keyed (gse_id, rev, gsm_id) (schema/033) so a new rev is written beside the
 * served one and store_study.rev flips last. Every reader tolerates missing tables: before schema/032 is applied, everything
 * is "not migrated" and the legacy path answers.
 */
import { isRestrictedMember } from "./restricted";
import { resolveModalities } from "./modalities";

export const GSE_RE = /^GSE\d+$/;
export const GSM_RE = /^GSM\d+$/;
/** store/s/<GSM>/<digest16 hex>.s1 — the key of an immutable sample object. DUAL: the old v2/s/....s2 form is still accepted (removed in the cleanup). */
export const SAMPLE_KEY_RE = /^(?:store|v2)\/s\/(GSM\d+)\/([0-9a-f]{32})\.(?:s1|s2)$/;
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
/** Statuses under which the study is answered from store. */
const SERVED_STATUSES: readonly string[] = ["verified", "retired"];

export const manifestKey = (gse: string) => `store/m/${gse}.json`;
/** DUAL: the key of a manifest written before the rename. */
export const legacyManifestKey = (gse: string) => `v2/m/${gse}.json`;
/** Manifest formats accepted on ingest; writers emit only "singlet-store". DUAL: "singlet-v2". */
const MANIFEST_FORMATS: readonly unknown[] = ["singlet-store", "singlet-v2"];

// ── rows ────────────────────────────────────────────────────────────────────

export interface StoreStudyRow {
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

export interface StoreMigrationRow {
  gse_id: string;
  status: MigrationStatus;
  legacy_key: string | null;
  legacy_etag: string | null;
  legacy_bytes: number | null;
  store_bytes: number | null;
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
const MIGRATION_COLUMNS =
  "gse_id, status, legacy_key, legacy_etag, legacy_bytes, store_bytes, n_samples, members_by_kind, verify_ok, commit_sha, migrated_at, verified_at, ledger_key, error, updated_at";

/** The columns of a sample row that are cheap to read for many samples. */
export interface StoreSampleLight {
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

export interface StoreSampleFull extends StoreSampleLight {
  members_json: string | null;
  cell_stats_json: string | null;
}

/** One member of a sample object as the manifest records it. Extra fields (codec, codec version, row_order, meta) pass through untouched. */
export interface StoreMember {
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
export class StoreManifestError extends Error {
  constructor(
    message: string,
    readonly status: number = 400
  ) {
    super(message);
    this.name = "StoreManifestError";
  }
}

export interface ParsedSample {
  gsm: string;
  key: string;
  bytes: number;
  sha256: string | null;
  n_columns: number | null;
  n_called: number | null;
  members: Record<string, StoreMember>;
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
  store_bytes: number | null;
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
  /** The key the manifest lives at: store/m/<GSE>.json, or v2/m/<GSE>.json when the manifest is in the old form. */
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
  if (!isCount(v)) throw new StoreManifestError(`${what} must be a non-negative integer`);
  return v;
};
const optNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const optStr = (v: unknown, what: string, max = 512): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || v.length > max) throw new StoreManifestError(`${what} must be a string of at most ${max} characters`);
  return v;
};

function sha256Field(v: unknown): string {
  if (typeof v !== "string" || !SHA256_RE.test(v)) throw new StoreManifestError("manifest_sha256 must be 64 lowercase hex characters");
  return v;
}

function smallJson(v: unknown, what: string, max: number): string | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) throw new StoreManifestError(`${what} must be an object`);
  const s = JSON.stringify(v);
  if (s.length > max) throw new StoreManifestError(`${what} is over ${max} bytes`);
  return s;
}

function parseSample(raw: unknown, i: number, gse: string): ParsedSample {
  if (!isObj(raw)) throw new StoreManifestError(`samples[${i}] is not an object`);
  const gsm = raw.gsm;
  if (typeof gsm !== "string" || !GSM_RE.test(gsm)) throw new StoreManifestError(`samples[${i}].gsm must look like GSM123`);
  const where = `samples[${i}] (${gsm})`;
  const key = raw.key;
  const km = typeof key === "string" ? SAMPLE_KEY_RE.exec(key) : null;
  if (!km || km[1] !== gsm) throw new StoreManifestError(`${where}: key must be store/s/${gsm}/<32 hex>.s1`);
  if (!isCount(raw.bytes)) throw new StoreManifestError(`${where}: bytes must be a non-negative integer`);
  const sha = raw.sha256;
  if (sha !== undefined && sha !== null && (typeof sha !== "string" || !SHA256_RE.test(sha))) throw new StoreManifestError(`${where}: sha256 must be 64 lowercase hex characters`);
  if (!isObj(raw.members)) throw new StoreManifestError(`${where}: members must be an object`);

  const members: Record<string, StoreMember> = {};
  const restricted: string[] = [];
  for (const [name, m] of Object.entries(raw.members)) {
    if (!name || name.length > 256 || name.startsWith("/") || name.includes("..")) throw new StoreManifestError(`${where}: bad member name '${name.slice(0, 80)}'`);
    // Restricted members (per-donor genotype layers) must not be in a public object at all: refuse, do not just hide them.
    if (isRestrictedMember(name)) {
      restricted.push(name);
      continue;
    }
    if (!isObj(m) || !isCount(m.kind) || m.kind < 1 || m.kind > 5 || !isCount(m.off) || !isCount(m.len)) {
      throw new StoreManifestError(`${where}: member '${name}' needs integer kind (1-5), off and len`);
    }
    members[name] = m as StoreMember;
  }
  if (restricted.length) {
    throw new StoreManifestError(`${where}: restricted members must not be in a public sample object: ${restricted.slice(0, 5).join(", ")}`, 422);
  }
  const membersJson = JSON.stringify(members);
  if (membersJson.length > MAX_MEMBERS_JSON) throw new StoreManifestError(`${where}: members is over ${MAX_MEMBERS_JSON} bytes`);
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
  if (!isObj(raw)) throw new StoreManifestError("migration must be an object");
  const status = raw.status;
  if (typeof status !== "string" || !(MIGRATION_STATUSES as readonly string[]).includes(status)) {
    throw new StoreManifestError(`migration.status must be one of ${MIGRATION_STATUSES.join(", ")}`);
  }
  const verify = raw.verify_ok;
  const verified = verify === true || verify === 1;
  if (SERVED_STATUSES.includes(status) && !verified) {
    throw new StoreManifestError(`migration.status '${status}' makes the study public and needs verify_ok: true (the bit-for-bit verification passed)`, 422);
  }
  return {
    status: status as MigrationStatus,
    legacy_key: optStr(raw.legacy_key ?? legacy?.key, "migration.legacy_key", 256),
    legacy_etag: optStr(raw.legacy_etag ?? legacy?.etag, "migration.legacy_etag", 128),
    legacy_bytes: optCount(raw.legacy_bytes ?? legacy?.bytes, "migration.legacy_bytes"),
    store_bytes: optCount(raw.store_bytes, "migration.store_bytes"),
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
 * Body: `{ manifest, final?, force?, migration?, manifest_bytes?, manifest_sha256? }` (a study manifest, format-store.md section 7; `study_files`
 * and anything else not named here is ignored, so a poster should drop it to keep the body small) or `{ gse_id, migration }` (state only).
 * A manifest may carry a slice of the samples when it also carries `n_samples` and, if the sum of bytes is not
 * derivable from the slice, `bytes`; send `final: false` on every slice but the last.
 */
export function parseIngestBody(body: unknown): ParsedIngest {
  if (!isObj(body)) throw new StoreManifestError("Body must be a JSON object");
  const final = body.final === undefined ? true : body.final === true;
  if (body.final !== undefined && typeof body.final !== "boolean") throw new StoreManifestError("final must be true or false");

  if (body.manifest === undefined) {
    const gse = body.gse_id;
    if (typeof gse !== "string" || !GSE_RE.test(gse)) throw new StoreManifestError("Send { manifest } or { gse_id, migration }");
    if (body.migration === undefined) throw new StoreManifestError("Nothing to write: migration is missing");
    return { study: null, migration: parseMigration(body.migration, null), migrationImplicit: false, force: false, gse, final };
  }

  const m = body.manifest;
  if (!isObj(m)) throw new StoreManifestError("manifest must be an object");
  if (!MANIFEST_FORMATS.includes(m.format)) throw new StoreManifestError("manifest.format must be 'singlet-store' (or the old 'singlet-v2')");
  if (m.manifest_version !== 1) throw new StoreManifestError("manifest.manifest_version must be 1");
  const gse = m.gse;
  if (typeof gse !== "string" || !GSE_RE.test(gse)) throw new StoreManifestError("manifest.gse must look like GSE123");
  if (typeof m.rev !== "string" || !REV_RE.test(m.rev)) throw new StoreManifestError("manifest.rev must be 16 lowercase hex characters");
  if (m.manifest_key !== undefined && m.manifest_key !== manifestKey(gse) && m.manifest_key !== legacyManifestKey(gse)) throw new StoreManifestError(`manifest.manifest_key must be ${manifestKey(gse)}`);
  if (!Array.isArray(m.samples) || m.samples.length === 0) throw new StoreManifestError("manifest.samples must be a non-empty array");
  if (m.samples.length > MAX_SAMPLES_PER_POST) {
    throw new StoreManifestError(`At most ${MAX_SAMPLES_PER_POST} samples per post; send slices with n_samples, bytes and final: false until the last`, 413);
  }
  const samples = m.samples.map((s, i) => parseSample(s, i, gse));
  const seen = new Set<string>();
  for (const s of samples) {
    if (seen.has(s.gsm)) throw new StoreManifestError(`${s.gsm} appears twice`);
    seen.add(s.gsm);
  }

  const nSamples = m.n_samples === undefined ? samples.length : m.n_samples;
  if (!isCount(nSamples) || nSamples < samples.length) throw new StoreManifestError("manifest.n_samples must be an integer of at least the samples sent");
  const sliced = nSamples !== samples.length;
  if (sliced && m.bytes === undefined) throw new StoreManifestError("A slice of a study needs manifest.bytes (the total over all samples)");
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
 *   2. in one atomic batch, on the final post: the store_study row (this flips the rev), the removal of the older revs' sample rows, the
 *      migration row.
 * `storedRev` is the rev store_study holds now (null when the study is new). When it equals the posted rev, nothing of the study is rewritten (rows
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
            `INSERT INTO store_sample (gse_id, gsm_id, key, bytes, sha256, n_columns, n_called, n_members, median_umi, median_genes, modalities, members_json, cell_stats_json, rev, updated_at)
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
            `INSERT INTO store_study (gse_id, manifest_key, rev, bytes, n_samples, created_at, legacy_bytes, manifest_bytes, manifest_sha256, n_cells_called, reference_build, packs_json, pipeline_json, updated_at)
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
      tail.push(db.prepare(`DELETE FROM store_sample WHERE gse_id = ? AND rev != ?`).bind(study.gse, study.rev));
    }
  }
  const mg = p.migration;
  // A body without a migration block must not touch the migration row of a rev that is already stored (it would demote a verified study).
  // The migration row changes together with the flip, so only on the final post (a slice of a new rev must not demote the served one).
  if (mg && p.final && !(p.migrationImplicit && unchanged)) {
    tail.push(
      db
        .prepare(
          `INSERT INTO store_migration (gse_id, status, legacy_key, legacy_etag, legacy_bytes, store_bytes, n_samples, members_by_kind, verify_ok, commit_sha, migrated_at, verified_at, ledger_key, error, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(gse_id) DO UPDATE SET status = excluded.status,
             legacy_key = COALESCE(excluded.legacy_key, store_migration.legacy_key),
             legacy_etag = COALESCE(excluded.legacy_etag, store_migration.legacy_etag),
             legacy_bytes = COALESCE(excluded.legacy_bytes, store_migration.legacy_bytes),
             store_bytes = COALESCE(excluded.store_bytes, store_migration.store_bytes),
             n_samples = COALESCE(excluded.n_samples, store_migration.n_samples),
             members_by_kind = COALESCE(excluded.members_by_kind, store_migration.members_by_kind),
             verify_ok = excluded.verify_ok,
             commit_sha = COALESCE(excluded.commit_sha, store_migration.commit_sha),
             migrated_at = COALESCE(excluded.migrated_at, store_migration.migrated_at),
             verified_at = COALESCE(excluded.verified_at, store_migration.verified_at),
             ledger_key = COALESCE(excluded.ledger_key, store_migration.ledger_key),
             error = excluded.error, updated_at = excluded.updated_at`
        )
        .bind(
          p.gse, mg.status, mg.legacy_key, mg.legacy_etag, mg.legacy_bytes, mg.store_bytes, mg.n_samples, mg.members_by_kind, mg.verify_ok,
          mg.commit_sha, mg.migrated_at, mg.verified_at, mg.ledger_key, mg.error, stamp
        )
    );
  }
  return { batches, tail, unchanged };
}

// ── reads ───────────────────────────────────────────────────────────────────

/**
 * The store tables may not exist yet (schema/032 not applied). Nothing is probed up front: the first statement that finds a table missing
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

/** Whether the store tables exist (one zero-row statement unless a recent answer is remembered). */
export async function storeAvailable(db: D1Database): Promise<boolean> {
  return guarded(db, false, async () => {
    await db.prepare(`SELECT gse_id FROM store_study LIMIT 0`).all();
    return true;
  });
}

export async function getStoreStudy(db: D1Database, gse: string): Promise<StoreStudyRow | null> {
  return guarded(db, null, () => db.prepare(`SELECT ${STUDY_COLUMNS} FROM store_study WHERE gse_id = ?`).bind(gse).first<StoreStudyRow>());
}

export async function getStoreMigration(db: D1Database, gse: string): Promise<StoreMigrationRow | null> {
  return guarded(db, null, () => db.prepare(`SELECT ${MIGRATION_COLUMNS} FROM store_migration WHERE gse_id = ?`).bind(gse).first<StoreMigrationRow>());
}

export interface StoreState {
  study: StoreStudyRow;
  migration: StoreMigrationRow | null;
}

/** True when a study with this migration state is answered from store. */
export function isServedFromStore(migration: Pick<StoreMigrationRow, "status"> | null): boolean {
  return migration !== null && SERVED_STATUSES.includes(migration.status);
}

/**
 * Whether the legacy single-file bundle (`data/<GSE>/<GSE>.singlet`) still exists for a study with this migration state. It is gone
 * once the migration is `retired`; every place that names the legacy URL, reads the legacy file or counts on its index asks this.
 * No migration row at all means the study was never moved: the legacy file is the only file.
 */
export function isLegacyAlive(migration: Pick<StoreMigrationRow, "status"> | null): boolean {
  return migration?.status !== "retired";
}

/** The study's store state when it is served from store, otherwise null (not migrated, still migrating, failed). Two primary-key reads. */
export async function getStoreState(db: D1Database, gse: string): Promise<StoreState | null> {
  const study = await getStoreStudy(db, gse);
  if (!study) return null;
  const migration = await getStoreMigration(db, gse);
  return isServedFromStore(migration) ? { study, migration } : null;
}

/** What the catalog holds for a study, served or not: for callers that also need to know the study is being moved. Two keyed reads. */
export interface StorePresence {
  study: StoreStudyRow | null;
  migration: StoreMigrationRow | null;
}

export async function getStorePresence(db: D1Database, gse: string): Promise<StorePresence> {
  const [study, migration] = await Promise.all([getStoreStudy(db, gse), getStoreMigration(db, gse)]);
  return { study, migration };
}

/** The served state, if the presence says the study is served from store. */
export function servedState(p: StorePresence): StoreState | null {
  return p.study && p.migration && isServedFromStore(p.migration) ? { study: p.study, migration: p.migration } : null;
}

/** Which of these studies are served from store (chunks of 90 ids, two reads per chunk). */
export async function storeServedStudies(db: D1Database, gses: string[]): Promise<Map<string, StoreState>> {
  const out = new Map<string, StoreState>();
  if (!gses.length) return out;
  const ids = [...new Set(gses)];
  return guarded(db, out, async () => {
    for (let i = 0; i < ids.length; i += 90) {
      const part = ids.slice(i, i + 90);
      const marks = part.map(() => "?").join(",");
      const studies = await db.prepare(`SELECT ${STUDY_COLUMNS} FROM store_study WHERE gse_id IN (${marks})`).bind(...part).all<StoreStudyRow>();
      if (!studies.results?.length) continue;
      const migrations = await db.prepare(`SELECT ${MIGRATION_COLUMNS} FROM store_migration WHERE gse_id IN (${marks})`).bind(...part).all<StoreMigrationRow>();
      const byGse = new Map<string, StoreMigrationRow>((migrations.results ?? []).map((m): [string, StoreMigrationRow] => [m.gse_id, m]));
      for (const st of studies.results) {
        const migration = byGse.get(st.gse_id) ?? null;
        if (isServedFromStore(migration)) out.set(st.gse_id, { study: st, migration });
      }
    }
    return out;
  });
}

/**
 * One sample with its members and stats under the study's revision (`rev`, or the one store_study holds now); null when the study has no such
 * sample. One keyed read.
 */
export async function getStoreSample(db: D1Database, gse: string, gsm: string, rev?: string): Promise<StoreSampleFull | null> {
  return guarded(db, null, () =>
    db
      .prepare(
        `SELECT ${LIGHT_COLUMNS}, members_json, cell_stats_json FROM store_sample
          WHERE gse_id = ? AND gsm_id = ? AND rev = ${rev ? "?" : "(SELECT rev FROM store_study WHERE gse_id = ?)"}`
      )
      .bind(gse, gsm, rev ?? gse)
      .first<StoreSampleFull>()
  );
}

/**
 * A page of a study's samples without the JSON columns, in gsm order, under the study's current `rev` (rows written
 * by a slice that has not been finalised yet are not listed). `after` is the last gsm_id of the previous page.
 * `limit` is capped at 500.
 */
export async function listStoreSamples(db: D1Database, gse: string, rev: string, opts: { limit?: number; after?: string } = {}): Promise<StoreSampleLight[]> {
  const limit = Math.min(500, Math.max(1, Math.floor(opts.limit ?? 500)));
  return guarded(db, [] as StoreSampleLight[], async () => {
    const rs = await db
      .prepare(`SELECT ${LIGHT_COLUMNS} FROM store_sample WHERE gse_id = ? AND rev = ? AND gsm_id > ? ORDER BY gsm_id LIMIT ?`)
      .bind(gse, rev, opts.after ?? "", limit)
      .all<StoreSampleLight>();
    return rs.results ?? [];
  });
}

/** Several samples of one study with members_json under its revision, at most 50 at a time (the caller pages). */
export async function getStoreSamples(db: D1Database, gse: string, gsms: string[], rev?: string): Promise<StoreSampleFull[]> {
  if (!gsms.length) return [];
  const ids = [...new Set(gsms)].slice(0, 50);
  return guarded(db, [] as StoreSampleFull[], async () => {
    const rs = await db
      .prepare(
        `SELECT ${LIGHT_COLUMNS}, members_json, cell_stats_json FROM store_sample
          WHERE gse_id = ? AND rev = ${rev ? "?" : "(SELECT rev FROM store_study WHERE gse_id = ?)"} AND gsm_id IN (${ids.map(() => "?").join(",")}) ORDER BY gsm_id`
      )
      .bind(gse, rev ?? gse, ...ids)
      .all<StoreSampleFull>();
    return rs.results ?? [];
  });
}

/** Parse members_json defensively. */
export function parseMembers(json: string | null | undefined): Record<string, StoreMember> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return isObj(v) ? (v as Record<string, StoreMember>) : {};
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

/** The members a visitor may see (restricted ones are refused at ingest; this is the second line). */
export function publicMemberNames(members: Record<string, unknown>): string[] {
  return Object.keys(members).filter((n) => !isRestrictedMember(n)).sort();
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

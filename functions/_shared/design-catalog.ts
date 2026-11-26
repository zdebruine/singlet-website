/**
 * Curated study design and per-sample processing status: validation and D1 statements shared by
 * POST /api/ingest/s1-design and POST /api/ingest/s1-status (schema/042_design_catalog.sql).
 * The record shape is singlet-design-catalog-0.1 (docs/CONTRASTS_CATALOG_SCHEMA.md in singlet-agents).
 */
export const DESIGN_SCHEMA = "singlet-design-catalog-0.1";
export const STUDY_RE = /^(GSE\d+|[SED]RP\d+)$/;
export const TIERS = ["candidate", "unresolved", "confirmed"] as const;
export const STATUSES = ["scheduled", "held", "running", "counts_available", "needs_debug"] as const;
export const RELEASE_ROUTES = ["tag_demultiplexing", "author_labels", "not_pooled"] as const;
export const MAX_RECORD_BYTES = 8 * 1024 * 1024;
export const MAX_STATUS_UPDATES = 500;

export class DesignError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

interface Rec {
  schema: string;
  study: string;
  tier: string;
  design_class: string;
  summary?: string;
  factors: { id: string; name?: string; type?: string; unit?: string; source?: string; confidence?: string; levels: { id: string; label?: string; standard?: string; role?: string; ontology?: { id: string }[] }[] }[];
  units: { unit_id: string; gsm?: string; library?: string; biosample_key?: string; donor?: string | null; pool?: { type?: string; mapping?: string }; levels: Record<string, string | string[] | null>; status?: string }[];
  contrasts: { id: string; factor_id?: string; factor_type?: string; test?: string; reference?: string | null; symmetric?: boolean; kind?: string; grade: string; status?: string; replication_unit?: string; n: { test_units: number; reference_units: number }; pairing?: string; confounds?: string[]; shared?: Record<string, string>; differs?: { attribute: string; test_values: string[]; reference_values: string[]; aligned_with_arms: boolean }[] }[];
  provenance?: { prompt_version?: string; model?: string; bundle_hash?: string; paper_used?: boolean };
}

export function parseDesign(body: unknown): { study: string; record: Rec; rev: string } {
  const b = body as { study?: string; record?: Rec } | null;
  if (!b || typeof b !== "object" || !b.record) throw new DesignError("Body must be {study, record}");
  const study = String(b.study ?? "").trim().toUpperCase();
  if (!STUDY_RE.test(study)) throw new DesignError("study must look like GSE123 or SRP123");
  const r = b.record;
  if (r.schema !== DESIGN_SCHEMA) throw new DesignError(`record.schema must be ${DESIGN_SCHEMA}`);
  if (r.study !== study) throw new DesignError("record.study does not match study");
  if (!(TIERS as readonly string[]).includes(r.tier)) throw new DesignError(`tier must be one of ${TIERS.join(", ")}`);
  if (!Array.isArray(r.factors) || !Array.isArray(r.units) || !Array.isArray(r.contrasts)) throw new DesignError("factors, units and contrasts must be arrays");
  for (const u of r.units) {
    if (u.status && !(STATUSES as readonly string[]).includes(u.status)) throw new DesignError(`unit ${u.unit_id}: bad status ${u.status}`);
  }
  for (const c of r.contrasts) if (!["A", "B", "C", "D"].includes(c.grade)) throw new DesignError(`contrast ${c.id}: grade must be A to D`);
  return { study, record: r, rev: "" };
}

/** Statements that replace one study's design rows. Run inside one D1 batch so no reader sees half of a study. */
export function designStatements(db: D1Database, study: string, r: Rec, rev: string, sidecarKey: string | null): D1PreparedStatement[] {
  const s: D1PreparedStatement[] = [];
  for (const t of ["design_contrast_attr", "design_contrast", "design_unit_level", "design_unit", "design_level", "design_factor", "design_study"]) {
    s.push(db.prepare(`DELETE FROM ${t} WHERE gse_id = ?`).bind(study));
  }
  const prov = r.provenance ?? {};
  s.push(
    db
      .prepare(`INSERT INTO design_study(gse_id,tier,design_class,summary,prompt_version,model,bundle_hash,n_units,n_contrasts,paper_used,sidecar_key,rev) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(study, r.tier, r.design_class, r.summary ?? null, prov.prompt_version ?? null, prov.model ?? null, prov.bundle_hash ?? null, r.units.length, r.contrasts.length, prov.paper_used ? 1 : 0, sidecarKey, rev)
  );
  for (const f of r.factors) {
    s.push(db.prepare(`INSERT INTO design_factor(gse_id,factor_id,name,type,unit,source,confidence) VALUES (?,?,?,?,?,?,?)`).bind(study, f.id, f.name ?? null, f.type ?? null, f.unit ?? null, f.source ?? null, f.confidence ?? null));
    for (const l of f.levels) {
      s.push(db.prepare(`INSERT INTO design_level(gse_id,factor_id,level_id,label,standard,role,ontology_ids) VALUES (?,?,?,?,?,?,?)`).bind(study, f.id, l.id, l.label ?? null, l.standard ?? null, l.role ?? null, (l.ontology ?? []).map((o) => o.id).join(",")));
    }
  }
  for (const u of r.units) {
    s.push(
      db
        .prepare(`INSERT INTO design_unit(gse_id,unit_id,gsm_id,library,biosample_key,donor,pool_type,pool_mapping,status) VALUES (?,?,?,?,?,?,?,?,?)`)
        .bind(study, u.unit_id, u.gsm ?? null, u.library ?? null, u.biosample_key ?? null, u.donor ?? null, u.pool?.type ?? null, u.pool?.mapping ?? null, u.status ?? "scheduled")
    );
    for (const [fid, v] of Object.entries(u.levels)) {
      if (v == null) continue;
      for (const lid of Array.isArray(v) ? v : [v]) {
        s.push(db.prepare(`INSERT INTO design_unit_level(gse_id,unit_id,factor_id,level_id,pooled) VALUES (?,?,?,?,?)`).bind(study, u.unit_id, fid, lid, Array.isArray(v) ? 1 : 0));
      }
    }
  }
  for (const c of r.contrasts) {
    s.push(
      db
        .prepare(`INSERT INTO design_contrast(gse_id,contrast_id,factor_id,factor_type,test,reference,symmetric,kind,grade,status,replication_unit,n_test,n_reference,pairing,confounds) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(study, c.id, c.factor_id ?? null, c.factor_type ?? null, c.test ?? null, c.reference ?? null, c.symmetric ? 1 : 0, c.kind ?? null, c.grade, c.status ?? null, c.replication_unit ?? null, c.n.test_units, c.n.reference_units, c.pairing ?? null, (c.confounds ?? []).join(","))
    );
    for (const [a, v] of Object.entries(c.shared ?? {})) {
      s.push(db.prepare(`INSERT INTO design_contrast_attr(gse_id,contrast_id,attribute,relation,value,aligned) VALUES (?,?,?,'shared',?,0)`).bind(study, c.id, a, v));
    }
    for (const d of c.differs ?? []) {
      s.push(db.prepare(`INSERT INTO design_contrast_attr(gse_id,contrast_id,attribute,relation,value,aligned) VALUES (?,?,?,'differs',?,?)`).bind(study, c.id, d.attribute, JSON.stringify([d.test_values, d.reference_values]), d.aligned_with_arms ? 1 : 0));
    }
  }
  return s;
}

export interface StatusUpdate {
  sample: string;
  gse?: string;
  status: string;
  reason?: string;
  object_url?: string;
  assay?: string;
  read_pairs?: number;
  attempt?: number;
  release?: string;
}

export function parseStatus(body: unknown): StatusUpdate[] {
  const u = (body as { updates?: StatusUpdate[] } | null)?.updates;
  if (!Array.isArray(u) || !u.length) throw new DesignError("Body must be {updates: [...]} with at least one update");
  if (u.length > MAX_STATUS_UPDATES) throw new DesignError(`At most ${MAX_STATUS_UPDATES} updates per post`, 413);
  for (const x of u) {
    if (!x.sample || typeof x.sample !== "string") throw new DesignError("every update needs a sample");
    if (!(STATUSES as readonly string[]).includes(x.status)) throw new DesignError(`${x.sample}: status must be one of ${STATUSES.join(", ")}`);
    if (x.object_url && x.status !== "counts_available") throw new DesignError(`${x.sample}: object_url only goes with counts_available`);
    if (x.status === "counts_available" && !/^https:\/\/[^ ]+\.s1$/.test(x.object_url ?? "")) throw new DesignError(`${x.sample}: counts_available needs an https object_url ending in .s1`);
    if (x.release && !(RELEASE_ROUTES as readonly string[]).includes(x.release)) throw new DesignError(`${x.sample}: release must be one of ${RELEASE_ROUTES.join(", ")}`);
  }
  return u;
}

/** Applies updates; refuses a move away from `held` that does not name a release route (D-137). Returns counts. */
export async function applyStatus(db: D1Database, updates: StatusUpdate[]): Promise<{ written: number; refused: { sample: string; error: string }[] }> {
  const ids = updates.map((u) => u.sample);
  const cur = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const rs = await db.prepare(`SELECT sample_id, status FROM sample_status WHERE sample_id IN (${part.map(() => "?").join(",")})`).bind(...part).all<{ sample_id: string; status: string }>();
    for (const r of rs.results ?? []) cur.set(r.sample_id, r.status);
  }
  const refused: { sample: string; error: string }[] = [];
  const stmts: D1PreparedStatement[] = [];
  for (const u of updates) {
    if (cur.get(u.sample) === "held" && u.status !== "held" && !u.release) {
      refused.push({ sample: u.sample, error: "a held sample moves on only with a release route (tag_demultiplexing, author_labels or not_pooled)" });
      continue;
    }
    stmts.push(
      db
        .prepare(
          `INSERT INTO sample_status(sample_id,gse_id,status,reason,object_url,assay,read_pairs,attempt,updated_at) VALUES (?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%SZ','now'))
           ON CONFLICT(sample_id) DO UPDATE SET gse_id=COALESCE(excluded.gse_id,gse_id), status=excluded.status, reason=excluded.reason, object_url=excluded.object_url,
           assay=COALESCE(excluded.assay,assay), read_pairs=COALESCE(excluded.read_pairs,read_pairs), attempt=excluded.attempt, updated_at=excluded.updated_at`
        )
        .bind(u.sample, u.gse ?? null, u.status, u.release ? `released: ${u.release}` : u.reason ?? null, u.object_url ?? null, u.assay ?? null, u.read_pairs ?? null, u.attempt ?? 0)
    );
    if (u.gse || cur.has(u.sample)) {
      stmts.push(db.prepare(`UPDATE design_unit SET status = ? WHERE gsm_id = ?`).bind(u.status, u.sample));
    }
  }
  if (stmts.length) await db.batch(stmts);
  return { written: updates.length - refused.length, refused };
}

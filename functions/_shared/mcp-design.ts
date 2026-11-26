/**
 * Read-only MCP tools over the curated design catalog (schema/042_design_catalog.sql): get_design, find_contrasts, get_contrast and
 * get_sample_status, plus the design summary that get_study adds. Every answer carries the study's tier, a one-line caveat and the
 * prompt version that produced the design. The tables may be absent (Alpha); each reader then says so, and get_study stays unchanged.
 */
import { toolError, toolResult, type ToolResult } from "./mcp-core";
import { isStudyWithheld, studyServedSql } from "./alpha";

const CAVEATS: Record<string, string> = {
  confirmed: "Tier confirmed: the design was checked against the study's own record.",
  candidate: "Tier candidate means model-curated and unverified: treat factors, units and contrasts as proposals, not as author-confirmed design.",
  unresolved: "Tier unresolved: the design could not be settled; nothing here is a usable contrast.",
};
const NONE_CONFIRMED = "No design is confirmed yet: every curated design is a candidate (model-curated, unverified). Pass include_candidate: true to see candidates.";
const ABSENT = "The design catalog is not available on this deployment.";

export const caveat = (tier: string | null | undefined) => CAVEATS[tier ?? ""] ?? CAVEATS.candidate;

const STUDY_ARG_RE = /^(GSE\d+|[SED]RP\d+)$/;
const GRADES = ["A", "B", "C", "D"];

const noTable = (e: unknown) => /no such table|no such column/i.test(e instanceof Error ? e.message : String(e));
const asId = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : "");
const intArg = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.trunc(v))) : d);
const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** True once the design tables hold a study (advertise the tools only then), or DESIGN_TOOLS=1. Memoized for five minutes per isolate. */
let gate: { at: number; visible: boolean } | null = null;
export async function designToolsVisible(env: { DB?: D1Database; DESIGN_TOOLS?: string } | null | undefined): Promise<boolean> {
  if (env?.DESIGN_TOOLS === "1") return true;
  const db = env?.DB;
  if (!db) return false;
  if (gate && Date.now() - gate.at < 5 * 60 * 1000) return gate.visible;
  let visible = false;
  try {
    visible = !!(await db.prepare(`SELECT 1 AS x FROM design_study LIMIT 1`).first());
  } catch {
    visible = false;
  }
  gate = { at: Date.now(), visible };
  return visible;
}
export function resetDesignGate(): void {
  gate = null;
}

interface StudyRow {
  gse_id: string;
  tier: string;
  design_class: string;
  summary: string | null;
  prompt_version: string | null;
  model: string | null;
  n_units: number | null;
  n_contrasts: number | null;
  paper_used: number;
  rev: string | null;
  updated_at: string | null;
}

async function studyRow(db: D1Database, id: string): Promise<StudyRow | null> {
  return db.prepare(`SELECT gse_id, tier, design_class, summary, prompt_version, model, n_units, n_contrasts, paper_used, rev, updated_at FROM design_study WHERE gse_id = ?`).bind(id).first<StudyRow>();
}

const provenance = (s: Pick<StudyRow, "tier" | "prompt_version" | "model" | "paper_used">) => ({
  tier: s.tier,
  caveat: caveat(s.tier),
  prompt_version: s.prompt_version,
  model: s.model,
  paper_used: !!s.paper_used,
});

async function statusCounts(db: D1Database, id: string): Promise<Record<string, number> | null> {
  try {
    const rs = await db.prepare(`SELECT status, COUNT(*) AS n FROM sample_status WHERE gse_id = ? GROUP BY status`).bind(id).all<{ status: string; n: number }>();
    const out: Record<string, number> = {};
    for (const r of rs.results ?? []) out[r.status] = Number(r.n);
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/** The extra fields get_study carries: a design summary and status counts. Null when the tables are absent or hold nothing for the study. */
export async function studyDesignSummary(db: D1Database, id: string): Promise<{ design: Record<string, unknown> | null; status_counts: Record<string, number> | null }> {
  let design: Record<string, unknown> | null = null;
  try {
    const s = await studyRow(db, id);
    if (s) {
      const f = await db.prepare(`SELECT COUNT(*) AS n FROM design_factor WHERE gse_id = ?`).bind(id).first<{ n: number }>();
      design = { ...provenance(s), design_class: s.design_class, summary: s.summary, n_factors: Number(f?.n ?? 0), n_units: s.n_units, n_contrasts: s.n_contrasts, details: "get_design" };
    }
  } catch {
    design = null;
  }
  return { design, status_counts: await statusCounts(db, id) };
}

export function designText(d: Record<string, unknown> | null, counts: Record<string, number> | null): string | null {
  const lines: string[] = [];
  if (d) lines.push(`Design (${d.tier}, prompt ${d.prompt_version ?? "unknown"}): ${d.design_class}, ${d.n_factors} factors, ${d.n_units} units, ${d.n_contrasts} contrasts. ${d.caveat} Use get_design for the full design.`);
  if (counts) lines.push(`Sample status: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}.`);
  return lines.length ? lines.join("\n") : null;
}

// ── get_design ──────────────────────────────────────────────────────────────

export async function getDesign(db: D1Database, args: Record<string, unknown>): Promise<ToolResult> {
  const id = asId(args.study);
  if (!STUDY_ARG_RE.test(id)) return toolError("`study` must be a GEO series (GSE178957) or an SRA study (SRP123456).");
  if (await isStudyWithheld(db, id)) return toolError(`${id} is not in the atlas.`);
  try {
    const s = await studyRow(db, id);
    if (!s) return toolError(`${id} has no curated design yet.`);
    const [factors, levels, units, unitLevels, contrasts] = await Promise.all([
      db.prepare(`SELECT factor_id, name, type, unit, source, confidence FROM design_factor WHERE gse_id = ? ORDER BY factor_id`).bind(id).all<Record<string, unknown>>(),
      db.prepare(`SELECT factor_id, level_id, label, standard, role, ontology_ids FROM design_level WHERE gse_id = ? ORDER BY factor_id, level_id`).bind(id).all<Record<string, unknown>>(),
      db.prepare(`SELECT unit_id, gsm_id, library, biosample_key, donor, pool_type, pool_mapping, status FROM design_unit WHERE gse_id = ? ORDER BY unit_id`).bind(id).all<Record<string, unknown>>(),
      db.prepare(`SELECT unit_id, factor_id, level_id FROM design_unit_level WHERE gse_id = ?`).bind(id).all<{ unit_id: string; factor_id: string; level_id: string }>(),
      db.prepare(`SELECT contrast_id, factor_id, factor_type, test, reference, kind, grade, status, n_test, n_reference FROM design_contrast WHERE gse_id = ? ORDER BY contrast_id`).bind(id).all<Record<string, unknown>>(),
    ]);
    const byUnit = new Map<string, Record<string, string[]>>();
    for (const r of unitLevels.results ?? []) {
      const m = byUnit.get(r.unit_id) ?? {};
      (m[r.factor_id] ??= []).push(r.level_id);
      byUnit.set(r.unit_id, m);
    }
    const levelsBy = new Map<string, unknown[]>();
    for (const l of levels.results ?? []) {
      const k = String(l.factor_id);
      levelsBy.set(k, [...(levelsBy.get(k) ?? []), { level_id: l.level_id, label: l.label, standard: l.standard, role: l.role, ontology_ids: l.ontology_ids ? String(l.ontology_ids).split(",").filter(Boolean) : [] }]);
    }
    const unitList = (units.results ?? []).map((u) => ({ ...u, levels: byUnit.get(String(u.unit_id)) ?? {} }));
    const factorList = (factors.results ?? []).map((f) => ({ ...f, levels: levelsBy.get(String(f.factor_id)) ?? [] }));
    const contrastList = (contrasts.results ?? []).map((c) => ({ id: `${id}:${c.contrast_id}`, ...c }));
    const structured = {
      study: id,
      ...provenance(s),
      design_class: s.design_class,
      summary: s.summary,
      rev: s.rev,
      updated_at: s.updated_at,
      factors: factorList,
      units: unitList,
      contrasts: contrastList,
      status_counts: await statusCounts(db, id),
    };
    const text = `${id} design (${s.tier}, prompt ${s.prompt_version ?? "unknown"}): ${s.design_class}. ${factorList.length} factors, ${unitList.length} units, ${contrastList.length} contrasts.\n${caveat(s.tier)}${s.summary ? `\n${s.summary}` : ""}`;
    return toolResult(text, structured);
  } catch (e) {
    if (noTable(e)) return toolError(ABSENT);
    throw e;
  }
}

// ── find_contrasts ──────────────────────────────────────────────────────────

export async function findContrasts(db: D1Database, args: Record<string, unknown>): Promise<ToolResult> {
  const includeCandidate = args.include_candidate === true;
  const factorType = typeof args.factor_type === "string" ? args.factor_type.trim().toLowerCase() : "";
  const term = typeof args.term === "string" ? args.term.trim() : "";
  const tissue = typeof args.tissue === "string" ? args.tissue.trim() : "";
  const minGrade = typeof args.min_grade === "string" ? args.min_grade.trim().toUpperCase() : "";
  const status = typeof args.status === "string" ? args.status.trim() : "";
  const limit = intArg(args.limit, 20, 1, 100);
  if (minGrade && !GRADES.includes(minGrade)) return toolError("`min_grade` must be A, B, C or D (A is best).");

  const where: string[] = [`s.tier IN (${includeCandidate ? "'confirmed','candidate'" : "'confirmed'"})`, studyServedSql("c.gse_id")];
  const binds: unknown[] = [];
  if (factorType) {
    where.push(`LOWER(c.factor_type) = ?`);
    binds.push(factorType);
  }
  if (minGrade) {
    where.push(`c.grade <= ?`);
    binds.push(minGrade);
  }
  if (status) {
    where.push(`c.status = ?`);
    binds.push(status);
  }
  if (term) {
    // The term is matched in the contrast's arms and in the labels, standard names and ontology ids of that factor's levels.
    where.push(
      `(c.test LIKE ? ESCAPE '\\' OR c.reference LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM design_level l WHERE l.gse_id = c.gse_id AND l.factor_id = c.factor_id AND (l.label LIKE ? ESCAPE '\\' OR l.standard LIKE ? ESCAPE '\\' OR l.ontology_ids LIKE ? ESCAPE '\\')))`
    );
    for (let i = 0; i < 5; i++) binds.push(like(term));
  }
  if (tissue) {
    where.push(
      `(EXISTS (SELECT 1 FROM design_contrast_attr a WHERE a.gse_id = c.gse_id AND a.contrast_id = c.contrast_id AND a.attribute = 'tissue' AND a.relation = 'shared' AND a.value LIKE ? ESCAPE '\\') OR EXISTS (SELECT 1 FROM gsm g WHERE g.gse_id = c.gse_id AND LOWER(g.tissue_group) = LOWER(?)))`
    );
    binds.push(like(tissue), tissue);
  }
  const sql = `SELECT c.gse_id, c.contrast_id, c.factor_id, c.factor_type, c.test, c.reference, c.kind, c.grade, c.status, c.replication_unit, c.n_test, c.n_reference, c.pairing, c.confounds,
      s.tier, s.prompt_version
    FROM design_contrast c JOIN design_study s ON s.gse_id = c.gse_id
    WHERE ${where.join(" AND ")} ORDER BY c.grade, (c.n_test + c.n_reference) DESC, c.gse_id, c.contrast_id LIMIT ${limit}`;
  try {
    const rs = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>();
    const rows = (rs.results ?? []).map((r) => ({
      id: `${r.gse_id}:${r.contrast_id}`,
      study: r.gse_id,
      factor_type: r.factor_type,
      test: r.test,
      reference: r.reference,
      kind: r.kind,
      grade: r.grade,
      status: r.status,
      n_test: r.n_test,
      n_reference: r.n_reference,
      replication_unit: r.replication_unit,
      pairing: r.pairing,
      confounds: r.confounds ? String(r.confounds).split(",").filter(Boolean) : [],
      tier: r.tier,
      prompt_version: r.prompt_version,
    }));
    const tiers = [...new Set(rows.map((r) => String(r.tier)))];
    const lines = [`${rows.length} contrast${rows.length === 1 ? "" : "s"} (${includeCandidate ? "confirmed and candidate" : "confirmed only"}).`];
    if (!includeCandidate) lines.push(NONE_CONFIRMED);
    if (tiers.includes("candidate")) lines.push(CAVEATS.candidate);
    const structured = {
      include_candidate: includeCandidate,
      tier: includeCandidate ? "confirmed+candidate" : "confirmed",
      tiers_returned: tiers,
      caveat: includeCandidate ? CAVEATS.candidate : NONE_CONFIRMED,
      prompt_versions: [...new Set(rows.map((r) => String(r.prompt_version ?? "")))].filter(Boolean),
      n: rows.length,
      contrasts: rows,
    };
    const body = rows.map((r) => `${r.id} [${r.grade}, ${r.tier}] ${r.factor_type}: ${r.test} vs ${r.reference} (${r.n_test} v ${r.n_reference}, ${r.status ?? "no status"})`);
    return toolResult([...lines, ...body].join("\n"), structured);
  } catch (e) {
    if (noTable(e)) return toolError(ABSENT);
    throw e;
  }
}

// ── get_contrast ────────────────────────────────────────────────────────────

export async function getContrast(db: D1Database, args: Record<string, unknown>): Promise<ToolResult> {
  const raw = typeof args.id === "string" ? args.id.trim() : "";
  const cut = raw.indexOf(":");
  const study = cut > 0 ? raw.slice(0, cut).toUpperCase() : "";
  const cid = cut > 0 ? raw.slice(cut + 1) : "";
  if (!STUDY_ARG_RE.test(study) || !cid) return toolError("`id` must look like GSE178957:GSE178957.c1, the id find_contrasts returns.");
  if (await isStudyWithheld(db, study)) return toolError(`${study} is not in the atlas.`);
  try {
    const c = await db.prepare(`SELECT * FROM design_contrast WHERE gse_id = ? AND contrast_id = ?`).bind(study, cid).first<Record<string, unknown>>();
    const s = c ? await studyRow(db, study) : null;
    if (!c || !s) return toolError(`No contrast ${raw}.`);
    const attrs = await db.prepare(`SELECT attribute, relation, value, aligned FROM design_contrast_attr WHERE gse_id = ? AND contrast_id = ? ORDER BY relation, attribute`).bind(study, cid).all<Record<string, unknown>>();
    const shared: Record<string, unknown> = {};
    const differs: unknown[] = [];
    for (const a of attrs.results ?? []) {
      if (a.relation === "shared") shared[String(a.attribute)] = a.value;
      else {
        let parsed: unknown = a.value;
        try {
          const [test, reference] = JSON.parse(String(a.value)) as [unknown, unknown];
          parsed = { test_values: test, reference_values: reference };
        } catch {
          /* keep the raw value */
        }
        differs.push({ attribute: a.attribute, ...(typeof parsed === "object" && parsed ? parsed : { value: parsed }), aligned_with_arms: !!a.aligned });
      }
    }
    // Units on each arm: those carrying the factor's level named by test or reference (matched on level id, label or standard name).
    const armUnits = async (arm: unknown) => {
      if (arm == null) return [];
      const rs = await db
        .prepare(
          `SELECT DISTINCT ul.unit_id, u.gsm_id, u.donor, u.status, ul.pooled FROM design_unit_level ul JOIN design_unit u ON u.gse_id = ul.gse_id AND u.unit_id = ul.unit_id
           JOIN design_level l ON l.gse_id = ul.gse_id AND l.factor_id = ul.factor_id AND l.level_id = ul.level_id
           WHERE ul.gse_id = ? AND ul.factor_id = ? AND (l.level_id = ? OR l.label = ? OR l.standard = ?) ORDER BY ul.unit_id LIMIT 200`
        )
        .bind(study, c.factor_id, String(arm), String(arm), String(arm))
        .all<Record<string, unknown>>();
      return rs.results ?? [];
    };
    const [testUnits, referenceUnits] = await Promise.all([armUnits(c.test), armUnits(c.reference)]);
    const structured = {
      id: `${study}:${cid}`,
      study,
      ...provenance(s),
      factor_id: c.factor_id,
      factor_type: c.factor_type,
      test: c.test,
      reference: c.reference,
      symmetric: !!c.symmetric,
      kind: c.kind,
      grade: c.grade,
      status: c.status,
      replication_unit: c.replication_unit,
      n_test: c.n_test,
      n_reference: c.n_reference,
      pairing: c.pairing,
      confounds: c.confounds ? String(c.confounds).split(",").filter(Boolean) : [],
      shared,
      differs,
      test_units: testUnits,
      reference_units: referenceUnits,
      design_tool: "get_design",
    };
    const text = `${structured.id} [grade ${c.grade}, ${s.tier}]: ${c.factor_type} ${c.test} vs ${c.reference}, ${c.n_test} v ${c.n_reference} ${c.replication_unit ?? "units"}, ${c.pairing ?? "pairing unknown"}.\n${caveat(s.tier)} Prompt ${s.prompt_version ?? "unknown"}.${structured.confounds.length ? `\nConfounds: ${structured.confounds.join(", ")}.` : ""}`;
    return toolResult(text, structured);
  } catch (e) {
    if (noTable(e)) return toolError(ABSENT);
    throw e;
  }
}

// ── get_sample_status ───────────────────────────────────────────────────────

export async function getSampleStatus(db: D1Database, args: Record<string, unknown>): Promise<ToolResult> {
  const study = asId(args.study);
  const sample = asId(args.sample);
  if (!study && !sample) return toolError("Give `study` (GSE or SRP accession) or `sample` (GSM, or SRS/ERS/DRS).");
  if (study && !STUDY_ARG_RE.test(study)) return toolError("`study` must be a GEO series (GSE178957) or an SRA study (SRP123456).");
  if (sample && !/^[A-Z]{2,5}\d+$/.test(sample)) return toolError("`sample` must be an accession such as GSM5456789.");
  const limit = intArg(args.limit, 100, 1, 500);
  try {
    if (sample) {
      const r = await db.prepare(`SELECT sample_id, gse_id, status, reason, object_url, assay, read_pairs, attempt, updated_at FROM sample_status WHERE sample_id = ?`).bind(sample).first<Record<string, unknown>>();
      if (!r) return toolError(`${sample} has no processing status.`);
      if (r.gse_id && (await isStudyWithheld(db, String(r.gse_id)))) return toolError(`${sample} is not in the atlas.`);
      const s = r.gse_id ? await studyRow(db, String(r.gse_id)) : null;
      const structured = { sample: r.sample_id, study: r.gse_id, ...r, design: s ? provenance(s) : null, tier: s?.tier ?? null, caveat: caveat(s?.tier), prompt_version: s?.prompt_version ?? null };
      return toolResult(`${sample}: ${r.status}${r.reason ? ` (${r.reason})` : ""}${r.object_url ? `, counts at ${r.object_url}` : ""}. ${caveat(s?.tier)}`, structured);
    }
    if (await isStudyWithheld(db, study)) return toolError(`${study} is not in the atlas.`);
    const s = await studyRow(db, study);
    const counts = await statusCounts(db, study);
    if (!counts) return toolError(`${study} has no sample status rows.`);
    const rs = await db.prepare(`SELECT sample_id, status, reason, object_url, assay, read_pairs, attempt, updated_at FROM sample_status WHERE gse_id = ? ORDER BY sample_id LIMIT ${limit}`).bind(study).all<Record<string, unknown>>();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const structured = { study, ...(s ? provenance(s) : { tier: null, caveat: caveat(null), prompt_version: null }), status_counts: counts, n_samples: total, samples: rs.results ?? [], truncated: total > (rs.results ?? []).length };
    return toolResult(`${study}: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}. ${structured.caveat}`, structured);
  } catch (e) {
    if (noTable(e)) return toolError(ABSENT);
    throw e;
  }
}

// ── Tool definitions ────────────────────────────────────────────────────────

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const TIER_NOTE =
  "Every answer carries tier (candidate, unresolved or confirmed), a caveat and the prompt version. Candidate means model-curated and unverified. Not metered.";

export const DESIGN_TOOLS = [
  {
    name: "get_design",
    title: "Curated study design",
    description: `The curated experimental design of one study: factors and their levels (with ontology ids), units (samples or demultiplexed origins) with the level each carries, the contrasts the design supports with grades, and sample status counts. ${TIER_NOTE}`,
    inputSchema: { type: "object", properties: { study: { type: "string", pattern: "^(GSE\\d+|[SED]RP\\d+)$", description: "GEO series (GSE178957) or SRA study (SRP123456) for studies without a GEO series." } }, required: ["study"], additionalProperties: false },
    annotations: { title: "Curated study design", ...RO },
  },
  {
    name: "find_contrasts",
    title: "Find curated contrasts",
    description: `Find test-versus-reference contrasts across curated designs by factor type, a term (matched in the arms, level labels and ontology ids), tissue, minimum grade (A best) and contrast status. By default only confirmed designs are searched, and nothing is confirmed yet, so the default answer is empty: pass include_candidate: true to search model-curated candidates, which are unverified. ${TIER_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        factor_type: { type: "string", description: "Factor type, e.g. disease, treatment, genotype, time." },
        term: { type: "string", description: "Free text or ontology id matched in the test and reference levels, e.g. COVID-19 or MONDO:0100096." },
        tissue: { type: "string", description: "Tissue group, e.g. Blood." },
        min_grade: { type: "string", enum: GRADES, description: "Worst grade accepted; A is best." },
        status: { type: "string", description: "Contrast status as stored (e.g. candidate)." },
        include_candidate: { type: "boolean", default: false, description: "Also search candidate (model-curated, unverified) designs. Default false: confirmed only." },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      additionalProperties: false,
    },
    annotations: { title: "Find curated contrasts", ...RO },
  },
  {
    name: "get_contrast",
    title: "One curated contrast",
    description: `One contrast in full: arms, grade, replication unit, counts, pairing, confound flags, the attributes the arms share and where they differ, and the units on each arm. Take the id from find_contrasts or get_design. ${TIER_NOTE}`,
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Contrast id as returned by find_contrasts, <study>:<contrast>." } }, required: ["id"], additionalProperties: false },
    annotations: { title: "One curated contrast", ...RO },
  },
  {
    name: "get_sample_status",
    title: "Sample processing status",
    description: `Where samples stand in the Beta campaign (scheduled, held, running, counts_available, needs_debug). Give a study for counts and a sample list, or a sample for its row with the counts object URL once available. ${TIER_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        study: { type: "string", pattern: "^(GSE\\d+|[SED]RP\\d+)$" },
        sample: { type: "string", description: "GSM, or SRS/ERS/DRS for a sample without a GEO record." },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 100, description: "Samples listed for a study." },
      },
      additionalProperties: false,
    },
    annotations: { title: "Sample processing status", ...RO },
  },
];

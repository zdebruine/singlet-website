/**
 * The study page's view of a curated design sidecar (s1/d/<study>.design.json, schema singlet-design-catalog-0.1; see
 * docs/CONTRASTS_CATALOG_SCHEMA.md in singlet-agents). Pure: no I/O, so the endpoint and the tests share it.
 *
 * Display rules (singlet-agents docs/CONTRASTS_DISPLAY_PROPOSAL.md):
 * - Comparisons the authors stated come first. Derived comparisons on an inferential factor (disease, treatment, time, ...) join them at grade A
 *   or B; grade C goes to a "weaker" list that the page keeps folded; grade D is held back and only counted.
 * - Derived pairings within a descriptive factor (tissue or site, sorted fraction, preparation or technology) are not listed one by one: they
 *   collapse to one line per factor, since a ten-level factor alone yields 45 pairs.
 * - The raw `residual` text and the per-unit covariates stay in the sidecar; the page gets each level's GSMs so it can count what is in the file.
 */

export const DESCRIPTIVE_FACTOR_TYPES = new Set(["tissue_site", "cell_fraction", "prep_tech"]);

export const GRADE_TEXT: Record<string, string> = {
  A: "Three or more donors or cultures per group, an explicit reference and no attribute aligned with the groups.",
  B: "Two per group, or a minor imbalance between the groups.",
  C: "One per group, or a nuisance attribute aligned with the groups.",
  D: "Group assignments unresolved.",
};

export const CONFOUND_TEXT: Record<string, string> = {
  single_unit_per_arm: "At least one group has a single sample.",
  other_factor_aligned: "Another design factor changes together with the groups.",
  batch_aligned: "The groups were processed in different batches.",
  tissue_aligned: "The groups come from different tissues.",
  chemistry_aligned: "The groups used different 10x chemistries.",
  pooled_origin_unresolved: "Some libraries pool several samples whose origin is not resolved yet.",
  pooled_samples_excluded: "Pooled libraries are left out of the counts.",
  donor_shared_unpaired: "Some donors appear in both groups without a stated pairing.",
};

export const TIER_TEXT: Record<string, string> = {
  confirmed: "Curated and checked against the study's own record.",
  candidate: "Curated by a language model from the GEO record and not yet checked against the paper.",
  unresolved: "Curated by a language model; the record did not settle the design, so no comparison is offered.",
};

export interface DesignLevelView {
  id: string;
  label: string;
  standard: string;
  role: string;
  ontology: { id: string; label: string }[];
  gsms: string[];
  n_units: number;
}
export interface DesignFactorView {
  id: string;
  name: string;
  type: string;
  confidence: string | null;
  evidence: string | null;
  levels: DesignLevelView[];
}
export interface DesignDiffer {
  attribute: string;
  test_values: string[];
  reference_values: string[];
  aligned: boolean;
}
export interface DesignContrastView {
  id: string;
  factor_id: string;
  factor: string;
  factor_type: string;
  test: string;
  reference: string | null;
  test_level: string | null;
  reference_level: string | null;
  symmetric: boolean;
  stated: boolean;
  grade: string;
  replication_unit: string | null;
  pairing: string | null;
  n_test: number;
  n_reference: number;
  donors_test: number | null;
  donors_reference: number | null;
  confounds: string[];
  shared: Record<string, string>;
  differs: DesignDiffer[];
  evidence: string | null;
}
export interface CollapsedFactor {
  factor_id: string;
  factor: string;
  factor_type: string;
  n_levels: number;
  n_pairs: number;
}
export interface StudyDesignView {
  study: string;
  rev: string | null;
  tier: string;
  tier_text: string;
  design_class: string;
  summary: string | null;
  factors: DesignFactorView[];
  comparisons: DesignContrastView[];
  weaker: DesignContrastView[];
  collapsed: CollapsedFactor[];
  held: number;
  conflicts: { gsm: string | null; note: string }[];
  abstentions: string[];
  n_units: number;
  status_counts: Record<string, number> | null;
  provenance: { model: string | null; prompt_version: string | null; paper_used: boolean; pubmed: string[]; method: string | null };
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : d);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strList = (v: unknown): string[] => arr(v).map((x) => str(x)).filter(Boolean);

const GRADE_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };

function contrastView(c: Rec): DesignContrastView {
  const n = rec(c.n);
  const ev = arr(c.evidence).map(rec).find((e) => strOrNull(e.quote));
  const shared: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec(c.shared))) if (!k.startsWith("factor:")) shared[k] = str(v);
  return {
    id: str(c.id),
    factor_id: str(c.factor_id),
    factor: str(c.factor),
    factor_type: str(c.factor_type, "other"),
    test: str(c.test),
    reference: strOrNull(c.reference) ?? strOrNull(c.other_arm),
    test_level: strOrNull(c.test_level),
    reference_level: strOrNull(c.reference_level),
    symmetric: !!c.symmetric,
    stated: c.kind === "author_stated",
    grade: GRADE_ORDER[str(c.grade)] === undefined ? "D" : str(c.grade),
    replication_unit: strOrNull(c.replication_unit),
    pairing: strOrNull(c.pairing),
    n_test: numOrNull(n.test_units) ?? 0,
    n_reference: numOrNull(n.reference_units) ?? 0,
    donors_test: numOrNull(n.test_donors),
    donors_reference: numOrNull(n.reference_donors),
    confounds: strList(c.confounds),
    shared,
    // Differences on another design factor are shown by the factor itself; the rest are the attributes a reader must weigh.
    differs: arr(c.differs)
      .map(rec)
      .filter((d) => !str(d.attribute).startsWith("factor:"))
      .map((d) => ({ attribute: str(d.attribute), test_values: strList(d.test_values), reference_values: strList(d.reference_values), aligned: !!d.aligned_with_arms })),
    evidence: ev ? str(ev.quote) : null,
  };
}

const byRank = (a: DesignContrastView, b: DesignContrastView) =>
  Number(b.stated) - Number(a.stated) || GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade] || Math.min(b.n_test, b.n_reference) - Math.min(a.n_test, a.n_reference);

/** Builds the page view from a sidecar record. `statusByGsm` (from sample_status) is optional; counts by status are reported when given. */
export function designView(record: unknown, opts: { rev?: string | null; statusByGsm?: Map<string, string> | null } = {}): StudyDesignView {
  const r = rec(record);
  const units = arr(r.units).map(rec);

  // GSMs per level; a pooled unit lists several levels of one factor and counts toward each.
  const gsmsByLevel = new Map<string, Set<string>>();
  const unitsByLevel = new Map<string, number>();
  for (const u of units) {
    const gsm = strOrNull(u.gsm);
    for (const v of Object.values(rec(u.levels))) {
      for (const lid of Array.isArray(v) ? v : [v]) {
        if (typeof lid !== "string") continue;
        unitsByLevel.set(lid, (unitsByLevel.get(lid) ?? 0) + 1);
        if (gsm) (gsmsByLevel.get(lid) ?? gsmsByLevel.set(lid, new Set()).get(lid)!).add(gsm);
      }
    }
  }

  const factors: DesignFactorView[] = arr(r.factors).map(rec).map((f) => ({
    id: str(f.id),
    name: str(f.name),
    type: str(f.type, "other"),
    confidence: strOrNull(f.confidence),
    evidence: strOrNull(f.evidence),
    levels: arr(f.levels).map(rec).map((l) => {
      const id = str(l.id);
      return {
        id,
        label: str(l.label),
        standard: str(l.standard) || str(l.label),
        role: str(l.role, "other"),
        ontology: arr(l.ontology).map(rec).filter((o) => strOrNull(o.id)).map((o) => ({ id: str(o.id), label: str(o.label) })),
        gsms: [...(gsmsByLevel.get(id) ?? [])].sort(),
        n_units: unitsByLevel.get(id) ?? 0,
      };
    }),
  }));
  const factorType = new Map(factors.map((f) => [f.id, f.type]));

  const tier = str(r.tier, "candidate");
  const comparisons: DesignContrastView[] = [];
  const weaker: DesignContrastView[] = [];
  const collapsedBy = new Map<string, CollapsedFactor>();
  let held = 0;
  if (tier !== "unresolved") {
    for (const c of arr(r.contrasts).map(rec).map(contrastView)) {
      const type = factorType.get(c.factor_id) ?? c.factor_type;
      if (c.grade === "D") {
        held++;
      } else if (!c.stated && DESCRIPTIVE_FACTOR_TYPES.has(type)) {
        const f = factors.find((x) => x.id === c.factor_id);
        const cur = collapsedBy.get(c.factor_id) ?? { factor_id: c.factor_id, factor: c.factor, factor_type: type, n_levels: f?.levels.length ?? 0, n_pairs: 0 };
        cur.n_pairs++;
        collapsedBy.set(c.factor_id, cur);
      } else if (c.grade === "C") {
        weaker.push(c);
      } else {
        comparisons.push(c);
      }
    }
  }
  comparisons.sort(byRank);
  weaker.sort(byRank);

  let statusCounts: Record<string, number> | null = null;
  if (opts.statusByGsm && opts.statusByGsm.size) {
    statusCounts = {};
    for (const u of units) {
      const s = opts.statusByGsm.get(str(u.gsm)) ?? str(u.status, "scheduled");
      statusCounts[s] = (statusCounts[s] ?? 0) + 1;
    }
  }

  const prov = rec(r.provenance);
  return {
    study: str(r.study),
    rev: opts.rev ?? null,
    tier,
    tier_text: TIER_TEXT[tier] ?? TIER_TEXT.candidate,
    design_class: str(r.design_class),
    summary: strOrNull(r.summary),
    factors,
    comparisons,
    weaker,
    collapsed: [...collapsedBy.values()],
    held,
    conflicts: arr(r.conflicts).map(rec).map((c) => ({ gsm: strOrNull(c.gsm), note: str(c.note) })).filter((c) => c.note),
    abstentions: strList(r.abstentions),
    n_units: units.length,
    status_counts: statusCounts,
    provenance: {
      model: strOrNull(prov.model),
      prompt_version: strOrNull(prov.prompt_version),
      paper_used: !!prov.paper_used,
      pubmed: strList(prov.pubmed),
      method: strOrNull(prov.method),
    },
  };
}

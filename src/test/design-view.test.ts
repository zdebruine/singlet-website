// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { designView } from "../../functions/_shared/design-view";
import { loadDesignView, onRequestGet } from "../../functions/api/gse/[id]/design";
import { createTestD1 } from "./helpers/d1-sqlite";

// Two sidecars from the 2026-11 dry-run catalog (singlet-agents corpus/contrasts/results/2026-11-dryrun-catalog), `residual` removed.
const fixture = (g: string) => JSON.parse(readFileSync(`src/test/fixtures/design/${g}.design.json`, "utf8"));
const HNSCC = fixture("GSE181919"); // disease stage with an explicit normal reference, plus HPV status and subsite
const LUNG = fixture("GSE159354"); // two disease contrasts and 45 pairings of sorted fractions

describe("designView", () => {
  it("lists the author-stated disease comparisons first and keeps author labels beside the normalized level", () => {
    const v = designView(HNSCC);
    expect(v.tier).toBe("candidate");
    const stage = v.factors.find((f) => f.type === "disease")!;
    expect(stage.levels.find((l) => l.role === "reference")!.standard).toBe("adjacent normal");
    expect(stage.levels.every((l) => l.gsms.length === l.n_units)).toBe(true);
    const first = v.comparisons.slice(0, 3);
    expect(first.every((c) => c.stated && c.grade === "A" && c.reference === "adjacent normal")).toBe(true);
    expect(first.map((c) => c.test).sort()).toEqual(["leukoplakia", "lymph node metastasis", "primary tumor"]);
  });

  it("collapses derived pairings within a descriptive factor instead of listing them", () => {
    const v = designView(LUNG);
    const fraction = v.collapsed.find((g) => g.factor_type === "cell_fraction")!;
    expect(fraction.n_levels).toBe(10);
    expect(fraction.n_pairs).toBe(45);
    expect(v.comparisons.map((c) => c.test).sort()).toEqual(["idiopathic pulmonary fibrosis", "systemic sclerosis-associated interstitial lung disease"]);
    expect([...v.comparisons, ...v.weaker].some((c) => c.factor_type === "cell_fraction")).toBe(false);
  });

  it("drops differences on another design factor from 'also differs' and hides factor keys from 'shared'", () => {
    for (const c of [...designView(HNSCC).comparisons, ...designView(LUNG).comparisons]) {
      expect(c.differs.some((d) => d.attribute.startsWith("factor:"))).toBe(false);
      expect(Object.keys(c.shared).some((k) => k.startsWith("factor:"))).toBe(false);
    }
  });

  it("puts grade C in the weaker list, counts grade D as held, and offers no comparison for an unresolved design", () => {
    const rec = structuredClone(HNSCC);
    rec.contrasts[0].grade = "C";
    rec.contrasts[1].grade = "D";
    const v = designView(rec);
    expect(v.weaker.map((c) => c.id)).toContain(rec.contrasts[0].id);
    expect(v.held).toBe(1);
    const u = designView({ ...HNSCC, tier: "unresolved" });
    expect(u.comparisons).toEqual([]);
    expect(u.weaker).toEqual([]);
    expect(u.factors.length).toBe(HNSCC.factors.length);
    expect(u.tier_text).toMatch(/no comparison/);
  });

  it("counts units by processing status when sample_status is given", () => {
    const gsm = HNSCC.units[0].gsm as string;
    const v = designView(HNSCC, { statusByGsm: new Map([[gsm, "counts_available"]]) });
    expect(v.status_counts!.counts_available).toBe(1);
    expect(Object.values(v.status_counts!).reduce((a, b) => a + b, 0)).toBe(HNSCC.units.length);
  });
});

describe("GET /api/gse/:id/design", () => {
  const SCHEMA = readFileSync("schema/042_design_catalog.sql", "utf8");
  const env = (beta: boolean, objects: Record<string, string> = {}) => {
    const DB = createTestD1(SCHEMA);
    const SINGLET_DATA = { get: async (k: string) => (k in objects ? { text: async () => objects[k] } : null) };
    return { DB, SINGLET_DATA: SINGLET_DATA as never, CHANNEL: beta ? "beta" : undefined };
  };
  const call = async (e: ReturnType<typeof env>, id: string) =>
    onRequestGet({ env: e, params: { id }, request: new Request(`https://beta.singlet.bio/api/gse/${id}/design`), waitUntil: () => {} } as never);

  it("answers 404 on Alpha so the page keeps the GEO-characteristics table", async () => {
    const res = await call(env(false), "GSE181919");
    expect(res.status).toBe(404);
  });

  it("serves the view from the sidecar recorded in design_study on Beta, and 404 when the study has none", async () => {
    const key = "s1/d/GSE181919.design.json";
    const e = env(true, { [key]: JSON.stringify(HNSCC) });
    await e.DB.prepare(`INSERT INTO design_study(gse_id,tier,design_class,sidecar_key,rev) VALUES ('GSE181919','candidate','tumor_normal',?, 'abc')`).bind(key).run();
    const view = await loadDesignView(e as never, "GSE181919");
    expect(view!.rev).toBe("abc");
    expect(view!.comparisons.length).toBeGreaterThan(0);
    expect((await call(e, "GSE159354")).status).toBe(404);
  });

  it("returns null instead of failing when the design tables are absent", async () => {
    const e = { DB: createTestD1(""), CHANNEL: "beta" };
    expect(await loadDesignView(e as never, "GSE181919")).toBeNull();
  });
});

// @vitest-environment node
/**
 * Research Alpha: samples that are not part of singlet.bio (alpha_exclusions) and withheld studies (alpha_withheld) are
 * left out of every count, search, study page, manifest, sitemap and MCP answer, and the lists are loaded with the SQL the
 * loader writes (scripts/alpha/exclusion-sql.ts). One small catalog:
 *
 *   GSE10  human, file with GSM101 + GSM102 (120 cells each) and GSM103 (wrong strand, excluded)
 *   GSE20  mouse, file with GSM201 only (empty matrix, excluded) → withheld
 *   GSE30  human, file with GSM301 (90 cells)
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestPost as mcpPost } from "../../functions/mcp";
import { onRequestGet as gseGet } from "../../functions/api/gse/[id]";
import { onRequestGet as searchGet } from "../../functions/api/search";
import { onRequestGet as sitemapGet } from "../../functions/sitemap.xml";
import { computeStats } from "../../functions/_shared/stats-core";
import { recomputeMeta } from "../../functions/_shared/catalog-refresh";
import { manifestRows } from "../../functions/_shared/manifest-core";
import { bundleIndexResponse } from "../../functions/_shared/bundle-core";
import { alphaToolArgs, servedEntries } from "../../functions/_shared/alpha";
import { isHiddenMember, isRestrictedMember, publicEntries } from "../../functions/_shared/restricted";
import { MODALITIES, resolveModalities } from "../../functions/_shared/modalities";
import { LAYER_FILES } from "../../functions/_shared/layers-core";
import { sha256Hex } from "../../functions/_shared/hash";
import { forgetKeyMemo } from "../../functions/_shared/identity";
import { buildSqlFiles, parseLists, parsePolicy, EXCLUSION_ROWS } from "../../scripts/alpha/exclusion-sql";
import { createTestD1 } from "./helpers/d1-sqlite";

const KEY = "sk_live_" + "c".repeat(32);
const SCHEMA =
  // production has the v2 tables, and the loader's rollup reads them
  ["032_v2_catalog.sql", "033_v2_sample_rev_key.sql", "010_accounts.sql", "011_product.sql", "012_ai_budget.sql"].map((f) => readFileSync(`schema/${f}`, "utf8")).join("\n") +
  readFileSync("schema/001_init_local_nofts.sql", "utf8").replace(/PRAGMA[^;]*;/g, "") +
  `
CREATE TABLE gse_meta (gse_id TEXT PRIMARY KEY, has_bundle INTEGER, organism_primary TEXT, organisms TEXT, tissue_groups TEXT, disease_groups TEXT, assay_families TEXT,
  tissues_raw TEXT, cell_types_raw TEXT, n_conditions INTEGER, n_done INTEGER, n_total INTEGER, n_cells INTEGER, year INTEGER, n_usable_samples INTEGER, n_lowqc_samples INTEGER,
  reference_mismatch INTEGER, n_usable_cells INTEGER, n_lowqc_cells INTEGER, updated_at TEXT);
CREATE TABLE bundle_manifest (gse_id TEXT PRIMARY KEY, bytes INTEGER, n_files INTEGER, n_gsms_in_bundle INTEGER, manifest_n_gsms INTEGER, gsm_ids TEXT, manifest_created_at TEXT,
  audited_at TEXT, reference_build TEXT, singlet_version TEXT);
CREATE TABLE sample_qc (gsm_id TEXT PRIMARY KEY, gse_id TEXT, protocol TEXT, reference_build TEXT, n_input_reads INTEGER, uniquely_mapped_pct REAL,
  n_cells_called INTEGER, median_umi REAL, median_genes REAL, mapping_rate REAL, exonic_fraction REAL, intronic_fraction REAL, sequencing_saturation REAL,
  median_mito_fraction REAL, fraction_reads_in_cells REAL, total_genes_detected INTEGER, singlet_version TEXT, updated_at TEXT,
  matrix_bytes INTEGER, usable INTEGER, qc_tier INTEGER);
CREATE TABLE bundle_index (gse_id TEXT PRIMARY KEY, bytes INTEGER, entries TEXT, indexed_at TEXT);
CREATE TABLE vocab_rules (field TEXT, priority INTEGER, grp TEXT, match_type TEXT, pattern TEXT);
CREATE TABLE bundle_index_failure (gse_id TEXT PRIMARY KEY, error TEXT, updated_at TEXT);
CREATE TABLE summaries_indexed (gse_id TEXT PRIMARY KEY, n_samples INTEGER, indexed_at TEXT);
ALTER TABLE gse ADD COLUMN r2_bundle_n_gsms INTEGER;
ALTER TABLE gsm ADD COLUMN organism_primary TEXT;
ALTER TABLE gsm ADD COLUMN tissue_group TEXT;
ALTER TABLE gsm ADD COLUMN disease_group TEXT;
ALTER TABLE gsm ADD COLUMN assay_family TEXT;
`;

const STUDIES: { gse: string; organism: string; samples: { gsm: string; cells: number; bytes: number }[] }[] = [
  { gse: "GSE10", organism: "Homo sapiens", samples: [{ gsm: "GSM101", cells: 120, bytes: 5000 }, { gsm: "GSM102", cells: 120, bytes: 5000 }, { gsm: "GSM103", cells: 400, bytes: 5000 }] },
  { gse: "GSE20", organism: "Mus musculus", samples: [{ gsm: "GSM201", cells: 50, bytes: 100 }] },
  { gse: "GSE30", organism: "Homo sapiens", samples: [{ gsm: "GSM301", cells: 90, bytes: 5000 }] },
];

const SAMPLES_TSV = "gsm\tgse\treasons\tin_bundle\tn_cells_called\tsource\nGSM103\tGSE10\tstrand\t1\t400\tx\nGSM201\tGSE20\tempty\t1\t50\ty\n";
const STUDIES_TSV = "gse\tn_samples_total\taction\nGSE10\t3\trepack\nGSE20\t1\twithhold\nGSE30\t1\trepack\n";

async function world(opts: { load?: boolean } = {}) {
  const db = createTestD1(SCHEMA);
  db.raw.prepare(`INSERT INTO users (id, email, created_at) VALUES ('u1', 'u1@example.com', '2026-01-01T00:00:00Z')`).run();
  db.raw.prepare(`INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash) VALUES ('k1', 'u1', 't', 'sk_live_cccc', ?1)`).run(await sha256Hex(KEY));
  for (const s of STUDIES) {
    db.raw
      .prepare(`INSERT INTO gse (id, title, organism, n_gsm_total, n_gsm_done, n_cells, r2_bundle_key, r2_bundle_bytes, r2_bundle_n_gsms, submitted_date, last_updated)
                VALUES (?, ?, ?, ?, ?, 99999, ?, 1, ?, '2024-01-01', '2026-10-01T00:00:00Z')`)
      .run(s.gse, `Study ${s.gse}`, s.organism, s.samples.length, s.samples.length, `data/${s.gse}/${s.gse}.singlet`, s.samples.length);
    db.raw
      .prepare(`INSERT INTO bundle_manifest (gse_id, bytes, n_gsms_in_bundle, gsm_ids, reference_build, singlet_version) VALUES (?, 7000, ?, ?, ?, '2.0.0')`)
      .run(s.gse, s.samples.length, JSON.stringify(s.samples.map((x) => x.gsm)), s.organism === "Homo sapiens" ? "GRCh38-2024-A" : "GRCm39-2024-A");
    for (const x of s.samples) {
      db.raw
        .prepare(`INSERT INTO gsm (gsm_id, gse_id, status, n_cells, organism, organism_primary, tissue_group, disease_group, assay_family, tissue)
                  VALUES (?, ?, 'DONE', 50000, ?, ?, 'Blood', 'Healthy / control', '10x 3''', ?)`)
        .run(x.gsm, s.gse, s.organism, s.organism, x.gsm === "GSM103" ? "only-in-excluded" : "blood");
      db.raw
        .prepare(`INSERT INTO sample_qc (gsm_id, gse_id, n_cells_called, median_umi, median_genes, mapping_rate, median_mito_fraction, singlet_version, matrix_bytes, usable, qc_tier, updated_at)
                  VALUES (?, ?, ?, 900, 600, 0.9, 0, '0.3.0', ?, ?, 0, '2026-10-01T00:00:00Z')`)
        .run(x.gsm, s.gse, x.cells, x.bytes, x.bytes > 400 && x.cells > 0 ? 1 : 0);
    }
    const entries = s.samples.flatMap((x) =>
      ["exon_counts.1pz", "intron_counts.1pz", "summary.json", "sex_call.json", "doublet_scores.tsv", "mt_heteroplasmy.1pz", "ancestry_call.json", "splice_psi.1pz"].map((f, i) => ({
        p: `samples/${x.gsm}/${f}`, n: 0, c: 100, u: 100, o: i * 200,
      }))
    );
    db.raw.prepare(`INSERT INTO bundle_index (gse_id, bytes, entries, indexed_at) VALUES (?, 7000, ?, '2026-10-01T00:00:00Z')`).run(s.gse, JSON.stringify([{ p: "manifest.json", n: 0, c: 10, u: 10, o: 0 }, ...entries]));
  }
  const stamp = "2026-10-26T00:00:00Z";
  for (const s of STUDIES) await recomputeMeta(db, s.gse, stamp, false);
  if (opts.load !== false) {
    for (const f of buildSqlFiles(parseLists(SAMPLES_TSV, STUDIES_TSV), { stamp })) db.raw.exec(f.sql);
  }
  return { DB: db, MCP_RATE_PER_MIN: "1000" };
}
type Env = Awaited<ReturnType<typeof world>>;

const get = (handler: (c: never) => Promise<Response> | Response, env: Env, path: string, params: Record<string, string> = {}) =>
  handler({ request: new Request(`https://singlet.bio${path}`), env, params, waitUntil: () => undefined } as never);

async function rpc(env: Env, name: string, args: Record<string, unknown> = {}) {
  const request = new Request("https://singlet.bio/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const r = await mcpPost({ request, env, waitUntil: () => undefined, params: {}, data: {}, next: async () => new Response(), functionPath: "/mcp" } as never);
  return ((await r.json()) as { result: { content: { text: string }[]; structuredContent?: any; isError?: boolean } }).result;
}

const mentions = (value: unknown, ...ids: string[]) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return ids.filter((id) => text.includes(id));
};

beforeEach(() => {
  forgetKeyMemo();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  // No test reaches the data host; a HEAD for get_download_url answers with the object's size.
  vi.stubGlobal("fetch", async () => new Response(null, { status: 200, headers: { "Content-Length": "6543" } }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loader SQL", () => {
  it("parses the census lists and rejects malformed lines", () => {
    const ok = parseLists(SAMPLES_TSV, STUDIES_TSV);
    expect(ok.exclusions).toEqual([{ gsm: "GSM103", gse: "GSE10", reason: "strand" }, { gsm: "GSM201", gse: "GSE20", reason: "empty" }]);
    expect(ok.withheld).toEqual(["GSE20"]);
    expect(ok.rejected).toEqual([]);
    const bad = parseLists("gsm\tgse\treasons\nGSMx\tGSE1\tstrand\nGSM1\tGSE1\tnon_rna,strand\nGSM1\tGSE1\tempty\n", "gse\taction\nnope\twithhold\n");
    expect(bad.rejected).toHaveLength(2);
    expect(bad.exclusions).toEqual([{ gsm: "GSM1", gse: "GSE1", reason: "empty,non_rna,strand" }]);
  });

  it("takes the guard's policy JSON as the authority and places samples the TSVs do not name from the catalog", async () => {
    const policy = JSON.stringify({ version: "alpha-test-b", excluded_samples: ["GSM103", "GSM201", "GSM301"], withheld_studies: ["GSE20"] });
    const lists = parsePolicy(policy, [SAMPLES_TSV, "gsm\tgse\treasons\nGSM999\tGSE99\tstrand\n"]);
    expect(lists).toMatchObject({ version: "alpha-test-b", unresolved: ["GSM301"], withheld: ["GSE20"], ignored: 1, rejected: [] });
    const env = await world({ load: false });
    for (const f of buildSqlFiles(lists, { policy: lists.version })) env.DB.raw.exec(f.sql);
    expect(env.DB.raw.prepare("SELECT gsm_id, gse_id, reason, policy_version FROM alpha_exclusions ORDER BY gsm_id").all()).toEqual([
      { gsm_id: "GSM103", gse_id: "GSE10", reason: "strand", policy_version: "alpha-test-b" },
      { gsm_id: "GSM201", gse_id: "GSE20", reason: "empty", policy_version: "alpha-test-b" },
      { gsm_id: "GSM301", gse_id: "GSE30", reason: "unspecified", policy_version: "alpha-test-b" },
    ]);
    // GSE30's only sample is now excluded: its rollup was recomputed, so it is no longer downloadable
    expect(env.DB.raw.prepare("SELECT n_usable_samples, n_usable_cells FROM gse_meta WHERE gse_id = 'GSE30'").get()).toEqual({ n_usable_samples: 0, n_usable_cells: 0 });
    expect(() => parsePolicy("{}", [])).toThrow();
  });

  it("is idempotent and stays under D1's statement size", async () => {
    const env = await world();
    const before = env.DB.raw.prepare("SELECT * FROM gse_meta ORDER BY gse_id").all();
    for (const f of buildSqlFiles(parseLists(SAMPLES_TSV, STUDIES_TSV), { stamp: "2026-10-26T00:00:00Z" })) env.DB.raw.exec(f.sql);
    expect(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM alpha_exclusions").get()).toEqual({ n: 2 });
    expect(env.DB.raw.prepare("SELECT * FROM gse_meta ORDER BY gse_id").all()).toEqual(before);
    const many = Array.from({ length: 3 * EXCLUSION_ROWS + 7 }, (_, i) => ({ gsm: `GSM${9000000 + i}`, gse: `GSE${900 + (i % 400)}`, reason: "empty,non_rna,strand" }));
    for (const f of buildSqlFiles({ exclusions: many, withheld: ["GSE900"] })) {
      for (const stmt of f.sql.split(/;\n/)) expect(stmt.length).toBeLessThan(100_000);
    }
  });

  it("recomputes gse_meta exactly as the catalog crank does", async () => {
    const loaded = await world();
    const viaLoader = loaded.DB.raw.prepare("SELECT * FROM gse_meta WHERE gse_id = 'GSE10'").get() as Record<string, unknown>;
    const env = await world({ load: false });
    env.DB.raw.exec(buildSqlFiles(parseLists(SAMPLES_TSV, STUDIES_TSV)).filter((f) => !f.name.startsWith("03_")).map((f) => f.sql).join("\n"));
    // the insert trigger marked the study stale for the crank
    expect(env.DB.raw.prepare("SELECT n_usable_samples FROM gse_meta WHERE gse_id = 'GSE10'").get()).toEqual({ n_usable_samples: null });
    await recomputeMeta(env.DB, "GSE10", "2026-10-26T00:00:00Z", false);
    const viaCrank = env.DB.raw.prepare("SELECT * FROM gse_meta WHERE gse_id = 'GSE10'").get();
    expect(viaCrank).toEqual(viaLoader);
    expect(viaLoader).toMatchObject({ n_usable_samples: 2, n_usable_cells: 240, n_done: 2, n_total: 2 });
    expect(String(viaLoader.tissues_raw)).not.toContain("only-in-excluded");
  });

  it("marks a study stale when another study takes over its sample_qc rows (the 10-24 stats/search drift)", async () => {
    const env = await world();
    env.DB.raw.exec("UPDATE sample_qc SET gse_id = 'GSE10' WHERE gsm_id = 'GSM301'");
    expect(env.DB.raw.prepare("SELECT n_usable_samples FROM gse_meta WHERE gse_id = 'GSE30'").get()).toEqual({ n_usable_samples: null });
  });
});

describe("numbers", () => {
  it("/api/stats and the default search agree and leave the excluded and withheld out", async () => {
    const env = await world();
    const s = (await computeStats(env.DB))!;
    expect(s).toMatchObject({ studies_with_files: 2, samples_in_files: 3, cells_in_files: 330, files_published: 2, studies_withheld: 0, total_cells: 330 });
    expect(s.accounting.studies_tracked).toBe(2);
    expect(s.success_samples).toBe(3);
    const r = (await (await get(searchGet, env, "/api/search?has_bundle=1")).json()) as any;
    expect(r.totals).toMatchObject({ studies: s.studies_with_files, samples: s.samples_in_files, cells: s.cells_in_files });
    expect(mentions(r, "GSE20", "GSM103", "GSM201")).toEqual([]);
    expect(r.data.find((x: any) => x.gse_id === "GSE10").n_cells).toBe(240);
  });

  it("before the lists are loaded, nothing changes", async () => {
    const s = (await computeStats((await world({ load: false })).DB))!;
    // GSE20's only sample has an empty matrix, so it was never downloadable; GSM103 still counts
    expect(s).toMatchObject({ studies_with_files: 2, samples_in_files: 4, cells_in_files: 730 });
  });

  it("sample search, accession lookup and text search do not find excluded samples or withheld studies", async () => {
    const env = await world();
    const samples = (await (await get(searchGet, env, "/api/search?level=gsm&has_bundle=0")).json()) as any;
    expect(samples.data.map((x: any) => x.gsm_id).sort()).toEqual(["GSM101", "GSM102", "GSM301"]);
    expect(samples.data.find((x: any) => x.gsm_id === "GSM101").n_cells).toBe(120);
    for (const q of ["GSM103", "GSE20", "GSM201"]) {
      const r = (await (await get(searchGet, env, `/api/search?q=${q}&has_bundle=0`)).json()) as any;
      expect(mentions(r.data ?? r, q === "GSE20" ? "GSE20" : q), JSON.stringify(r).slice(0, 300)).toEqual([]);
    }
  });

  it("the sitemap lists served studies only", async () => {
    const xml = await (await get(sitemapGet, await world(), "/sitemap.xml")).text();
    expect(xml).toContain("/study/GSE10");
    expect(xml).not.toContain("GSE20");
  });

  it("manifests count file cells and samples that are part of the atlas, and say when they are truncated", async () => {
    const env = await world();
    const rows = await manifestRows(env.DB, ["GSE10", "GSE20"]);
    expect(rows.map((r) => r.gse_id)).toEqual(["GSE10"]);
    expect(rows[0]).toMatchObject({ n_cells: 240, n_samples_in_file: 2, n_samples_passing_qc: 2 });
  });
});

describe("study pages", () => {
  it("a withheld study is not found; a served one lists only its samples, with file cells", async () => {
    const env = await world();
    expect((await get(gseGet, env, "/api/gse/GSE20", { id: "GSE20" })).status).toBe(404);
    const j = (await (await get(gseGet, env, "/api/gse/GSE10", { id: "GSE10" })).json()) as any;
    expect(j.samples.map((x: any) => x.gsm_id)).toEqual(["GSM101", "GSM102"]);
    expect(j.samples.map((x: any) => x.n_cells)).toEqual([120, 120]);
    expect(j.series).toMatchObject({ n_cells: 240, n_gsm_total: 2, bundle_n_samples: 2, singlet_version: "2.0.0", bundle_bytes: 7000 });
    expect(j.samples[0].singlet_version).toBeUndefined();
    expect(mentions(j, "GSM103", "only-in-excluded")).toEqual([]);
  });

  it("the file listing hides excluded samples, private members and layers Alpha does not offer", async () => {
    const env = await world();
    const row = env.DB.raw.prepare("SELECT entries FROM bundle_index WHERE gse_id = 'GSE10'").get() as { entries: string };
    const idx = { entries: JSON.parse(row.entries), bytes: 7000, indexed_at: "x", etag: null } as never;
    const out = await bundleIndexResponse(env.DB, "GSE10", idx);
    expect(out.samples.map((x) => x.gsm_id)).toEqual(["GSM101", "GSM102"]);
    // the legacy sex call is not offered for any species (genetic sex comes from the s1 cell labels)
    expect(out.samples[0].files.map((f) => f.path.split("/").pop())).toEqual(["exon_counts.1pz", "intron_counts.1pz", "summary.json"]);
    const mouse = await servedEntries(env.DB, "GSE20", [{ p: "samples/GSM9/sex_call.json" }, { p: "samples/GSM9/exon_counts.1pz" }]);
    expect(mouse.map((e) => e.p)).toEqual(["samples/GSM9/exon_counts.1pz"]);
  });
});

describe("MCP", () => {
  it("answers a withheld study or an excluded sample as not found", async () => {
    const env = await world();
    for (const [tool, args] of [
      ["get_study", { gse_id: "GSE20" }],
      ["get_sample_qc", { gse_id: "GSE20" }],
      ["get_download_url", { gse_id: "GSE20" }],
      ["get_partial_download", { gse_id: "GSE10", gsm_id: "GSM103", file: "exon_counts.1pz" }],
      ["list_bundle_files", { gse_id: "GSE10", gsm_id: "GSM103" }],
    ] as const) {
      const r = await rpc(env, tool, args);
      expect(r.isError, tool).toBe(true);
      expect(r.content[0].text, tool).toMatch(/not in the atlas/);
    }
  });

  it("get_study, get_sample_qc and get_atlas_stats leave the excluded out; no mito column, one pipeline version", async () => {
    const env = await world();
    const study = await rpc(env, "get_study", { gse_id: "GSE10" });
    expect(mentions(study, "GSM103")).toEqual([]);
    expect(study.structuredContent.n_cells).toBe(240);
    const qc = await rpc(env, "get_sample_qc", { gse_id: "GSE10" });
    expect(qc.structuredContent.samples.map((x: any) => x.gsm_id)).toEqual(["GSM101", "GSM102"]);
    expect(qc.structuredContent.samples[0]).not.toHaveProperty("median_mito_pct");
    expect(qc.structuredContent.samples[0]).not.toHaveProperty("median_mito_fraction");
    expect(qc.structuredContent.totals).toMatchObject({ total_cells_called: 240, pipeline_version: "2.0.0" });
    expect(qc.content[0].text).not.toMatch(/mito/);
    const stats = await rpc(env, "get_atlas_stats");
    expect(stats.structuredContent).toMatchObject({ studies_with_files: 2, samples_in_files: 3, cells_in_files: 330 });
    const url = await rpc(env, "get_download_url", { gse_id: "GSE10" });
    expect(url.structuredContent.bytes).toBe(6543);
  });

  it("drops withheld studies from id lists", async () => {
    const env = await world();
    expect((await alphaToolArgs(env.DB, { gse_ids: ["GSE10", "GSE20"] })).args.gse_ids).toEqual(["GSE10"]);
    const m = await rpc(env, "export_manifest", { gse_ids: ["GSE10", "GSE20"], format: "json" });
    expect(m.structuredContent.studies).toEqual(["GSE10"]);
  });
});

describe("layers", () => {
  it("restricted members match the data.singlet.bio guard (workers/data-guard policy.ts)", () => {
    for (const rel of ["mt_heteroplasmy.1pz", "mt_variants.tsv", "ancestry_call.json", "mt/donor0_mt_variants.vcf", "x/donor1_mt_consensus.fa", "donor/snp_ad.1pz", "ase_counts.tsv"])
      expect(isRestrictedMember(rel), rel).toBe(true);
    for (const rel of ["mt/mt_summary.tsv", "donor/donor_assignments.tsv", "sex_call.json", "exon_counts.1pz"]) expect(isRestrictedMember(rel), rel).toBe(false);
  });

  it("hides the legacy layers Alpha does not offer, including the pipeline sex call, and not the s1 cell labels", () => {
    for (const rel of ["ambient_contamination.tsv", "ambient_contamination.json", "ambient_profile.tsv", "doublet_scores.tsv", "splice_psi.1pz", "nonhost/nonhost_per_cell.1pz", "mt/mt_summary.tsv"])
      expect(isHiddenMember(rel, { human: true }), rel).toBe(true);
    expect(isHiddenMember("sex_call.json", { human: true })).toBe(true);
    expect(isHiddenMember("sex_call.json", { human: false })).toBe(true);
    // the s1 transcode's labels are public cell metadata: not restricted, not hidden
    for (const rel of ["cells", "labels.tsv", "ancestry_hancestro", "ancestry_prob", "sex_chrom", "cell_type_cl"])
      expect(isRestrictedMember(rel) || isHiddenMember(rel, { human: true }), rel).toBe(false);
    expect(isHiddenMember("nonhost/nonhost_summary.json")).toBe(false);
    const list = [{ p: "samples/GSM1/doublet_scores.tsv" }, { p: "samples/GSM2/exon_counts.1pz" }, { p: "samples/GSM1/exon_counts.1pz" }];
    expect(publicEntries(list, { human: true, excluded: new Set(["GSM2"]) }).map((e) => e.p)).toEqual(["samples/GSM1/exon_counts.1pz"]);
  });

  it("the modality registry and layer counts offer none of them", () => {
    for (const m of MODALITIES) for (const member of m.members) expect(isHiddenMember(member, { human: true }) || isRestrictedMember(member), member).toBe(false);
    expect(LAYER_FILES.map((l) => l.key)).not.toEqual(expect.arrayContaining(["mtdna"]));
    expect(LAYER_FILES.find((l) => l.key === "vdj")?.label).toBe("TR/IG gene expression (not clonotypes)");
    expect(resolveModalities(["sex_call.json"], { human: true })).toEqual([]);
    expect(LAYER_FILES.find((l) => l.key === "sex")).toBeUndefined();
  });
});

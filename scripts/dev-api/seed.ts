/**
 * Seed a local SQLite mirror of the catalog from the public singlet.bio API.
 *
 *   bun scripts/dev-api/seed.ts [--samples 8000] [--out scripts/dev-api/catalog.sqlite]
 *
 * The public list endpoints don't expose the normalised columns or GEO
 * characteristics, so those are derived locally with a small synonym rule set
 * (vocab_rules) and synthetic characteristics — good enough to exercise every
 * query path (FTS, facets, conditions, ranking) end to end.
 */
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { toGroup, type VocabRule, type RuleField } from "../../functions/_shared/vocab";

const API = process.env.SEED_API ?? "https://singlet.bio";
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
const SAMPLE_TARGET = parseInt(args.get("samples") ?? "8000", 10);
const OUT = args.get("out") ?? new URL("./catalog.sqlite", import.meta.url).pathname;

const RULES: [RuleField, string, "exact" | "contains", string][] = [
  ["tissue", "Blood / PBMC", "contains", "pbmc"],
  ["tissue", "Blood / PBMC", "contains", "blood"],
  ["tissue", "Brain / CNS", "contains", "brain"],
  ["tissue", "Brain / CNS", "contains", "cortex"],
  ["tissue", "Brain / CNS", "contains", "hippocamp"],
  ["tissue", "Brain / CNS", "contains", "spinal cord"],
  ["tissue", "Brain / CNS", "contains", "glioma"],
  ["tissue", "Brain / CNS", "contains", "glioblastoma"],
  ["tissue", "Lung / airway", "contains", "lung"],
  ["tissue", "Lung / airway", "contains", "airway"],
  ["tissue", "Lung / airway", "contains", "bronch"],
  ["tissue", "Gut / intestine", "contains", "colon"],
  ["tissue", "Gut / intestine", "contains", "intestin"],
  ["tissue", "Gut / intestine", "contains", "ileum"],
  ["tissue", "Bone marrow", "contains", "marrow"],
  ["tissue", "Lymphoid organs", "contains", "spleen"],
  ["tissue", "Lymphoid organs", "contains", "lymph"],
  ["tissue", "Lymphoid organs", "contains", "thymus"],
  ["tissue", "Heart / vascular", "contains", "heart"],
  ["tissue", "Heart / vascular", "contains", "cardiac"],
  ["tissue", "Heart / vascular", "contains", "aort"],
  ["tissue", "Skin", "contains", "skin"],
  ["tissue", "Skin", "contains", "melanoma"],
  ["tissue", "Liver", "contains", "liver"],
  ["tissue", "Liver", "contains", "hepat"],
  ["tissue", "Kidney / urinary", "contains", "kidney"],
  ["tissue", "Kidney / urinary", "contains", "renal"],
  ["tissue", "Breast", "contains", "breast"],
  ["tissue", "Breast", "contains", "mammary"],
  ["tissue", "Muscle / bone / joint", "contains", "muscle"],
  ["tissue", "Muscle / bone / joint", "contains", "bone"],
  ["tissue", "Muscle / bone / joint", "contains", "joint"],
  ["tissue", "Pancreas", "contains", "pancrea"],
  ["tissue", "Pancreas", "contains", "islet"],
  ["tissue", "Eye", "contains", "retina"],
  ["tissue", "Eye", "contains", "eye"],
  ["tissue", "Embryo / development", "contains", "embryo"],
  ["tissue", "Embryo / development", "contains", "fetal"],
  ["tissue", "Reproductive", "contains", "testis"],
  ["tissue", "Reproductive", "contains", "ovar"],
  ["tissue", "Reproductive", "contains", "uter"],
  ["tissue", "Reproductive", "contains", "placenta"],
  ["tissue", "Organoid", "contains", "organoid"],
  ["tissue", "Cell line / in vitro", "contains", "cell line"],
  ["tissue", "Cell line / in vitro", "contains", "ipsc"],
  ["tissue", "Cell line / in vitro", "contains", "hek293"],
  ["tissue", "Cell line / in vitro", "contains", "culture"],
  ["tissue", "Adipose", "contains", "adipose"],
  ["tissue", "Adipose", "contains", "fat"],
  ["tissue", "Tumor (site unspecified)", "contains", "tumor"],
  ["tissue", "Tumor (site unspecified)", "contains", "tumour"],
  ["tissue", "Immune cells (sorted)", "contains", "t cells"],
  ["tissue", "Immune cells (sorted)", "contains", "macrophage"],
  ["tissue", "Plant", "contains", "root"],
  ["tissue", "Plant", "contains", "leaf"],
  ["disease", "COVID-19", "contains", "covid"],
  ["disease", "COVID-19", "contains", "sars-cov"],
  ["disease", "Alzheimer's disease", "contains", "alzheimer"],
  ["disease", "Parkinson's disease", "contains", "parkinson"],
  ["disease", "Cancer", "contains", "cancer"],
  ["disease", "Cancer", "contains", "carcinoma"],
  ["disease", "Cancer", "contains", "tumor"],
  ["disease", "Cancer", "contains", "tumour"],
  ["disease", "Cancer", "contains", "melanoma"],
  ["disease", "Cancer", "contains", "glioma"],
  ["disease", "Cancer", "contains", "glioblastoma"],
  ["disease", "Cancer", "contains", "leukemia"],
  ["disease", "Cancer", "contains", "lymphoma"],
  ["disease", "Cancer", "contains", "myeloma"],
  ["disease", "Cancer", "contains", "sarcoma"],
  ["disease", "Autoimmune / inflammatory", "contains", "colitis"],
  ["disease", "Autoimmune / inflammatory", "contains", "arthritis"],
  ["disease", "Autoimmune / inflammatory", "contains", "lupus"],
  ["disease", "Autoimmune / inflammatory", "contains", "psoriasis"],
  ["disease", "Autoimmune / inflammatory", "contains", "sclerosis"],
  ["disease", "Autoimmune / inflammatory", "contains", "inflamm"],
  ["disease", "Metabolic / cardiovascular", "contains", "diabet"],
  ["disease", "Metabolic / cardiovascular", "contains", "obes"],
  ["disease", "Metabolic / cardiovascular", "contains", "atheroscl"],
  ["disease", "Metabolic / cardiovascular", "contains", "infarct"],
  ["disease", "Other infection", "contains", "infect"],
  ["disease", "Other infection", "contains", "influenza"],
  ["disease", "Other infection", "contains", "sepsis"],
  ["disease", "Injury / transplant / aging", "contains", "aging"],
  ["disease", "Injury / transplant / aging", "contains", "aged"],
  ["disease", "Injury / transplant / aging", "contains", "old mice"],
  ["disease", "Injury / transplant / aging", "contains", "injury"],
  ["disease", "Injury / transplant / aging", "contains", "transplant"],
  ["disease", "Genetic / developmental", "contains", "syndrome"],
  ["disease", "Genetic / developmental", "contains", "knockout"],
  ["disease", "Other neurological / psychiatric", "contains", "epilep"],
  ["disease", "Other neurological / psychiatric", "contains", "autism"],
  ["disease", "Other neurological / psychiatric", "contains", "stress"],
  ["disease", "Healthy / control", "contains", "healthy"],
  ["disease", "Healthy / control", "contains", "control"],
  ["disease", "Healthy / control", "contains", "normal"],
  ["protocol", "10x 3'", "exact", "10xv2"],
  ["protocol", "10x 3'", "exact", "10xv3"],
  ["protocol", "10x 3'", "exact", "10xv3.1"],
  ["protocol", "10x 3'", "exact", "10xv4"],
  ["protocol", "10x 3'", "exact", "10x-3p-v2"],
  ["protocol", "10x 3'", "exact", "10x-3p-v3"],
  ["protocol", "10x 3'", "exact", "10x-3p-v4"],
  ["protocol", "10x 5'", "contains", "5p"],
  ["protocol", "10x 5'", "contains", "10x5"],
  ["protocol", "10x Multiome / ATAC", "contains", "multiome"],
  ["protocol", "10x Multiome / ATAC", "contains", "atac"],
  ["protocol", "10x (version unconfirmed)", "contains", "10x"],
  ["protocol", "Smart-seq / plate-based", "contains", "smart"],
  ["protocol", "Smart-seq / plate-based", "contains", "plate"],
  ["protocol", "Seq-Well / Microwell", "contains", "microwell"],
  ["protocol", "Seq-Well / Microwell", "contains", "seqwell"],
  ["protocol", "Drop-seq / inDrop", "contains", "drop"],
  ["protocol", "CITE-seq", "contains", "cite"],
  ["protocol", "BD Rhapsody", "contains", "rhapsody"],
  ["protocol", "Parse / SPLiT-seq", "contains", "parse"],
  ["protocol", "Parse / SPLiT-seq", "contains", "split"],
  ["protocol", "Spatial", "contains", "visium"],
  ["protocol", "Spatial", "contains", "spatial"],
  ["protocol", "Not single-cell RNA", "contains", "bulk"],
];

const rules: VocabRule[] = RULES.map(([field, grp, match_type, pattern], i) => ({ field, priority: i + 1, grp, match_type, pattern }));

interface ApiGsm {
  gsm_id: string; gse_id: string; organism: string | null; protocol: string | null; modality: string | null; tissue: string | null;
  cell_type: string | null; donor_id: string | null; disease: string | null; sex: string | null; n_cells: number | null;
  mapping_rate: number | null; median_genes: number | null; median_umis: number | null; mt_pct: number | null; status: string;
  failure_category: string | null; singlet_version: string | null; pipeline_date: string | null; title: string | null;
  source: string | null; srr_ids: string[]; last_updated: string;
}
interface ApiGse {
  id: string; title: string | null; organism: string | null; n_gsm_total: number; n_gsm_done: number; n_gsm_failed: number;
  n_cells: number; pubmed_ids: string[]; r2_bundle_key: string | null; r2_bundle_bytes: number | null; submitted_date: string | null; last_updated: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

function primaryOrganism(o: string | null): string | null {
  if (!o) return null;
  return o.split(";")[0].trim() || null;
}

function yearFor(gseId: string, submitted: string | null): number | null {
  if (submitted) {
    const y = parseInt(submitted.slice(0, 4), 10);
    if (Number.isFinite(y)) return y;
  }
  // Local-only approximation so the year facet has data to show.
  const n = parseInt(gseId.slice(3), 10);
  if (!Number.isFinite(n)) return null;
  if (n < 90000) return 2016;
  if (n < 120000) return 2018;
  if (n < 150000) return 2019;
  if (n < 165000) return 2020;
  if (n < 190000) return 2021;
  if (n < 215000) return 2022;
  if (n < 245000) return 2023;
  if (n < 275000) return 2024;
  if (n < 300000) return 2025;
  return 2026;
}

const CONDITION_SETS: [string, string[]][] = [
  ["age", ["6 month", "24 month"]],
  ["treatment", ["vehicle", "drug"]],
  ["genotype", ["WT", "KO"]],
  ["timepoint", ["day 0", "day 3", "day 7"]],
  ["condition", ["healthy", "disease"]],
];

function syntheticCharacteristics(s: ApiGsm, idx: number, studyIdx: number): string {
  const parts: string[] = [];
  if (s.tissue) parts.push(`tissue: ${s.tissue}`);
  if (s.cell_type) parts.push(`cell type: ${s.cell_type}`);
  if (s.sex) parts.push(`sex: ${s.sex}`);
  const [key, values] = CONDITION_SETS[studyIdx % CONDITION_SETS.length];
  parts.push(`${key}: ${values[idx % values.length]}`);
  parts.push(`donor id: D${studyIdx}-${idx}`);
  return parts.join(" ;; ");
}

async function main() {
  console.log(`Seeding from ${API} → ${OUT}`);
  const db = new Database(OUT, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url)).toString());
  for (const t of ["gse", "gsm", "gse_meta", "vocab_rules", "meta_cache", "fts_gse", "fts_gsm"]) db.exec(`DELETE FROM ${t}`);

  // Samples (pages of 500).
  const samples: ApiGsm[] = [];
  for (let page = 0; samples.length < SAMPLE_TARGET; page++) {
    const res = await getJson<{ data: ApiGsm[]; total: number }>(`/api/gsm?page_size=500&page=${page}`);
    samples.push(...res.data);
    if (!res.data.length || samples.length >= res.total) break;
    process.stdout.write(`  samples: ${samples.length}\r`);
  }
  // Make sure the acceptance-check study is present in full.
  const must = ["GSE178957"];
  for (const id of must) {
    const d = await getJson<{ series: ApiGse & { abstract: string | null }; samples: ApiGsm[] }>(`/api/gse/${id}`);
    for (const s of d.samples) if (!samples.some((x) => x.gsm_id === s.gsm_id)) samples.push(s);
  }
  console.log(`\n  samples: ${samples.length}`);

  // All studies (small table), keep those referenced by the seeded samples.
  const allGse: ApiGse[] = [];
  for (let page = 0; ; page++) {
    const res = await getJson<{ data: ApiGse[]; total: number }>(`/api/gse?page_size=500&page=${page}`);
    allGse.push(...res.data);
    if (!res.data.length || allGse.length >= res.total) break;
  }
  const wanted = new Set(samples.map((s) => s.gse_id));
  const studies = allGse.filter((g) => wanted.has(g.id));
  console.log(`  studies: ${studies.length} of ${allGse.length}`);

  // Abstracts for a subset (detail endpoint), so fts_gse has abstract text.
  const abstracts = new Map<string, string | null>();
  const detailIds = studies.slice(0, 60).map((g) => g.id).concat(must);
  for (const id of detailIds) {
    try {
      const d = await getJson<{ series: { abstract: string | null } }>(`/api/gse/${id}`);
      abstracts.set(id, d.series.abstract);
    } catch {
      /* skip */
    }
  }

  const insRule = db.prepare(`INSERT INTO vocab_rules (field, priority, grp, match_type, pattern) VALUES (?, ?, ?, ?, ?)`);
  for (const r of rules) insRule.run(r.field, r.priority, r.grp, r.match_type, r.pattern);

  const insGse = db.prepare(`INSERT OR REPLACE INTO gse (id, title, abstract, organism, n_gsm_total, n_gsm_done, n_gsm_failed, n_cells, pubmed_ids, r2_bundle_key, r2_bundle_bytes, submitted_date, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insGsm = db.prepare(`INSERT OR REPLACE INTO gsm (gsm_id, gse_id, organism, organism_primary, protocol, assay_family, modality, tissue, tissue_group, cell_type, donor_id, disease, disease_group, sex, n_cells, mapping_rate, median_genes, median_umis, mt_pct, status, failure_category, singlet_version, pipeline_date, title, source, srr_ids, characteristics, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insMeta = db.prepare(`INSERT OR REPLACE INTO gse_meta (gse_id, organism_primary, organisms, tissue_groups, disease_groups, assay_families, tissues_raw, cell_types_raw, n_conditions, n_done, n_total, n_cells, has_bundle, year, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const byStudy = new Map<string, ApiGsm[]>();
  for (const s of samples) {
    if (!wanted.has(s.gse_id)) continue;
    let arr = byStudy.get(s.gse_id);
    if (!arr) byStudy.set(s.gse_id, (arr = []));
    arr.push(s);
  }

  const tx = db.transaction(() => {
    let studyIdx = 0;
    for (const g of studies) {
      const abstract = abstracts.get(g.id) ?? null;
      insGse.run(g.id, g.title, abstract, g.organism, g.n_gsm_total, g.n_gsm_done, g.n_gsm_failed, g.n_cells, JSON.stringify(g.pubmed_ids ?? []), g.r2_bundle_key, g.r2_bundle_bytes, g.submitted_date, g.last_updated);
      db.run(`INSERT INTO fts_gse (id, title, abstract, organism) VALUES (?, ?, ?, ?)`, [g.id, g.title, abstract, g.organism]);

      const ss = byStudy.get(g.id) ?? [];
      const organisms = new Set<string>();
      const tg = new Set<string>();
      const dg = new Set<string>();
      const af = new Set<string>();
      const tissuesRaw = new Set<string>();
      const cellTypesRaw = new Set<string>();
      let nDone = 0;
      let nCells = 0;
      ss.forEach((s, idx) => {
        const orgP = primaryOrganism(s.organism);
        const tissueGroup = toGroup(rules, "tissue", s.tissue ?? s.source ?? "") ?? (s.tissue ? "Other" : null);
        const diseaseGroup = toGroup(rules, "disease", [s.disease, s.title, g.title].filter(Boolean).join(" ")) ?? "Other / unspecified";
        const assay = toGroup(rules, "protocol", s.protocol ?? "") ?? "Unknown";
        const chars = syntheticCharacteristics(s, idx, studyIdx);
        insGsm.run(
          s.gsm_id, s.gse_id, s.organism, orgP, s.protocol, assay, s.modality, s.tissue, tissueGroup, s.cell_type, s.donor_id,
          s.disease, diseaseGroup, s.sex, s.n_cells, s.mapping_rate, s.median_genes, s.median_umis, s.mt_pct, s.status,
          s.failure_category, s.singlet_version, s.pipeline_date, s.title, s.source, JSON.stringify(s.srr_ids ?? []), chars, s.last_updated
        );
        db.run(`INSERT INTO fts_gsm (gsm_id, gse_id, title, source, tissue, cell_type, organism, disease, characteristics) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [s.gsm_id, s.gse_id, s.title, s.source, s.tissue, s.cell_type, s.organism, s.disease, chars]);
        if (orgP) organisms.add(orgP);
        if (tissueGroup) tg.add(tissueGroup);
        dg.add(diseaseGroup);
        af.add(assay);
        if (s.tissue) tissuesRaw.add(s.tissue.toLowerCase());
        if (s.cell_type) cellTypesRaw.add(s.cell_type.toLowerCase());
        if (s.status === "DONE" || s.status === "DONE_QC_WARN") {
          nDone++;
          nCells += s.n_cells ?? 0;
        }
      });
      insMeta.run(
        g.id, primaryOrganism(g.organism), JSON.stringify([...organisms]), JSON.stringify([...tg]), JSON.stringify([...dg]),
        JSON.stringify([...af]), JSON.stringify([...tissuesRaw]), JSON.stringify([...cellTypesRaw]), 1,
        nDone, ss.length, nCells, g.r2_bundle_key ? 1 : 0, yearFor(g.id, g.submitted_date), new Date().toISOString()
      );
      studyIdx++;
    }
  });
  tx();
  console.log("  done:", db.query("SELECT (SELECT COUNT(*) FROM gse) gse, (SELECT COUNT(*) FROM gsm) gsm, (SELECT COUNT(*) FROM gse_meta) meta").get());
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

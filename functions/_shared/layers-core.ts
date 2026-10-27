/**
 * What the downloadable files hold beyond gene counts: for each layer Research Alpha offers, how many studies on
 * DOWNLOADABLE_SQL carry it, read from the published file indexes (`bundle_index.entries`).
 *
 * One LIKE scan over bundle_index (no json_each), so it is computed at most every 12 h and shared
 * through meta_cache. Served by GET /api/stats/layers for the home page charts.
 */
import { DOWNLOADABLE_SQL } from "./search-core";

export interface Layer {
  key: string;
  label: string;
  /** Downloadable studies whose file holds this layer. */
  studies: number;
  /** The studies it is counted over: all downloadable studies, or human ones for human-only layers. */
  of: number;
}

export interface LayerStats {
  studies: number;
  layers: Layer[];
  computed_at: string;
}

/**
 * Layer → a file name that only that layer writes (see ./modalities). Research Alpha counts only the layers it offers:
 * mtDNA variants and the legacy ancestry call are not released, and doublet scores and the legacy pipeline sex call are
 * not reliable (./restricted), so they are not counted even though the files are in many legacy bundles.
 */
export const LAYER_FILES: { key: string; label: string; file: string; humanOnly?: boolean }[] = [
  { key: "gene_counts", label: "Gene counts", file: "exon_counts.1pz" },
  { key: "splicing", label: "Spliced and unspliced reads", file: "intron_counts.1pz" },
  { key: "junctions", label: "Splice junctions", file: "sj_counts.1pz" },
  { key: "vdj", label: "TR/IG gene expression (not clonotypes)", file: "vdj_gene_usage.1pz" },
  { key: "donors", label: "Donor demultiplexing", file: "donor_assignments.tsv" },
  // The legacy pipeline sex call (sex_call.json) is not offered: genetic sex comes from the s1 cell labels (sex_chrom).
];

/** Layer counts over downloadable studies that are served from s1 and have no bundle_index row; null before schema/032 or when there are none. */
async function s1OnlyLayerRow(db: D1Database): Promise<Record<string, number | null> | null> {
  const human = "m.organism_primary = 'Homo sapiens'";
  const sums = LAYER_FILES.map(
    (l, i) => `COUNT(DISTINCT CASE WHEN s.members_json LIKE ?${i + 1}${l.humanOnly ? ` AND ${human}` : ""} THEN m.gse_id END) AS l${i}`,
  ).join(", ");
  try {
    return await db
      .prepare(
        `SELECT COUNT(DISTINCT m.gse_id) AS n, COUNT(DISTINCT CASE WHEN ${human} THEN m.gse_id END) AS n_human, ${sums}
           FROM gse_meta m
           JOIN s1_study vs ON vs.gse_id = m.gse_id
           JOIN s1_migration vm ON vm.gse_id = vs.gse_id AND vm.status IN ('verified', 'retired')
           JOIN s1_sample s ON s.gse_id = vs.gse_id AND s.rev = vs.rev
          WHERE ${DOWNLOADABLE_SQL} AND NOT EXISTS (SELECT 1 FROM bundle_index b WHERE b.gse_id = m.gse_id)`,
      )
      .bind(...LAYER_FILES.map((l) => `%${l.file}%`))
      .first<Record<string, number | null>>();
  } catch {
    return null;
  }
}

export async function computeLayerStats(db: D1Database): Promise<LayerStats> {
  const human = "m.organism_primary = 'Homo sapiens'";
  const sums = LAYER_FILES.map(
    (l, i) => `SUM(CASE WHEN b.entries LIKE ?${i + 1}${l.humanOnly ? ` AND ${human}` : ""} THEN 1 ELSE 0 END) AS l${i}`,
  ).join(", ");
  const row = await db
    .prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN ${human} THEN 1 ELSE 0 END) AS n_human, ${sums} FROM gse_meta m JOIN bundle_index b ON b.gse_id = m.gse_id WHERE ${DOWNLOADABLE_SQL}`)
    .bind(...LAYER_FILES.map((l) => `%${l.file}%`))
    .first<Record<string, number | null>>();
  // Studies served from s1 that have no legacy index (never had one) are counted from the files their samples hold. A retired study keeps its
  // legacy bundle_index row, so it is counted above.
  const s1 = await s1OnlyLayerRow(db);
  const total = (key: string) => Number(row?.[key] ?? 0) + Number(s1?.[key] ?? 0);
  return {
    studies: total("n"),
    layers: LAYER_FILES.map((l, i) => ({
      key: l.key,
      label: l.label,
      studies: total(`l${i}`),
      of: l.humanOnly ? total("n_human") : total("n"),
    })),
    computed_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

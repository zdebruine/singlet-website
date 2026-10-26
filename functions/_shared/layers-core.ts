/**
 * What the downloadable files hold beyond gene counts: for each layer, how many studies on
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

/** Layer → a file name that only that layer writes (see ./modalities). */
export const LAYER_FILES: { key: string; label: string; file: string; humanOnly?: boolean }[] = [
  { key: "gene_counts", label: "Gene counts", file: "exon_counts.1pz" },
  { key: "splicing", label: "Spliced and unspliced reads", file: "intron_counts.1pz" },
  { key: "junctions", label: "Splice junctions and exon inclusion", file: "sj_counts.1pz" },
  { key: "mtdna", label: "Mitochondrial DNA variants", file: "mt_heteroplasmy.1pz" },
  { key: "vdj", label: "Immune receptor genes (V(D)J)", file: "vdj_gene_usage.1pz" },
  { key: "donors", label: "Donor demultiplexing", file: "donor_assignments.tsv" },
  // Continental ancestry is a human call; other species' files carry the same name, so count humans only.
  { key: "ancestry", label: "Genetic ancestry (human)", file: "ancestry_call.json", humanOnly: true },
  // The pipeline matches chrY/XIST gene names in upper case, so every mouse sex_call.json says "unknown" (docs/DENSE-METADATA.md).
  // The file is there but holds no call: count humans only until the pipeline is fixed.
  { key: "sex", label: "Genetic sex (human)", file: "sex_call.json", humanOnly: true },
  { key: "doublets", label: "Doublet scores", file: "doublet_scores.tsv" },
];

/** Layer counts over downloadable studies that are served from v2 and have no bundle_index row; null before schema/032 or when there are none. */
async function v2OnlyLayerRow(db: D1Database): Promise<Record<string, number | null> | null> {
  const human = "m.organism_primary = 'Homo sapiens'";
  const sums = LAYER_FILES.map(
    (l, i) => `COUNT(DISTINCT CASE WHEN s.members_json LIKE ?${i + 1}${l.humanOnly ? ` AND ${human}` : ""} THEN m.gse_id END) AS l${i}`,
  ).join(", ");
  try {
    return await db
      .prepare(
        `SELECT COUNT(DISTINCT m.gse_id) AS n, COUNT(DISTINCT CASE WHEN ${human} THEN m.gse_id END) AS n_human, ${sums}
           FROM gse_meta m
           JOIN v2_study vs ON vs.gse_id = m.gse_id
           JOIN v2_migration vm ON vm.gse_id = vs.gse_id AND vm.status IN ('verified', 'retired')
           JOIN v2_sample s ON s.gse_id = vs.gse_id AND s.rev = vs.rev
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
  // Studies served from v2 that have no legacy index (never had one) are counted from the files their samples hold. A retired study keeps its
  // legacy bundle_index row, so it is counted above.
  const v2 = await v2OnlyLayerRow(db);
  const total = (key: string) => Number(row?.[key] ?? 0) + Number(v2?.[key] ?? 0);
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

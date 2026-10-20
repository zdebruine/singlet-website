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
  { key: "snps", label: "SNP genotypes", file: "snp_ad.1pz" },
  { key: "donors", label: "Donor demultiplexing", file: "donor_assignments.tsv" },
  // Continental ancestry is a human call; other species' files carry the same name, so count humans only.
  { key: "ancestry", label: "Genetic ancestry (human)", file: "ancestry_call.json", humanOnly: true },
  { key: "sex", label: "Genetic sex", file: "sex_call.json" },
  { key: "doublets", label: "Doublet scores", file: "doublet_scores.tsv" },
];

export async function computeLayerStats(db: D1Database): Promise<LayerStats> {
  const human = "m.organism_primary = 'Homo sapiens'";
  const sums = LAYER_FILES.map(
    (l, i) => `SUM(CASE WHEN b.entries LIKE ?${i + 1}${l.humanOnly ? ` AND ${human}` : ""} THEN 1 ELSE 0 END) AS l${i}`,
  ).join(", ");
  const row = await db
    .prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN ${human} THEN 1 ELSE 0 END) AS n_human, ${sums} FROM gse_meta m JOIN bundle_index b ON b.gse_id = m.gse_id WHERE ${DOWNLOADABLE_SQL}`)
    .bind(...LAYER_FILES.map((l) => `%${l.file}%`))
    .first<Record<string, number | null>>();
  return {
    studies: Number(row?.n ?? 0),
    layers: LAYER_FILES.map((l, i) => ({
      key: l.key,
      label: l.label,
      studies: Number(row?.[`l${i}`] ?? 0),
      of: Number((l.humanOnly ? row?.n_human : row?.n) ?? 0),
    })),
    computed_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

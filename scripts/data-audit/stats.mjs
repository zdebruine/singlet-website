// Statistical checks that SQL alone does not express well. They read every usable sample's QC row once
// (about 70,000 rows, 10,000 per page) and look for patterns nobody wrote a rule for.
const COLS = "q.gse_id, q.gsm_id, q.n_cells_called AS cells, q.median_genes AS genes, q.median_umi AS umi, q.mapping_rate AS map, q.n_input_reads AS reads";

async function loadUsable(query) {
  const rows = [];
  let last = "";
  for (;;) {
    const page = await query(`SELECT ${COLS} FROM sample_qc q WHERE q.usable = 1 AND q.gsm_id > '${last}' ORDER BY q.gsm_id LIMIT 10000`);
    if (!page.length) break;
    rows.push(...page);
    last = page[page.length - 1].gsm_id;
    if (page.length < 10000) break;
  }
  return rows;
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export async function runStats(query, nExamples = 8) {
  const rows = await loadUsable(query);
  const out = [];

  // 1. Identical metric fingerprints across different samples: five independent measurements agreeing exactly
  // means a copied or duplicated row, not a coincidence.
  const groups = new Map();
  for (const r of rows) {
    if (r.cells < 50 || !r.reads) continue;
    const k = [r.cells, r.genes, r.umi, r.map, r.reads].join("|");
    (groups.get(k) ?? groups.set(k, []).get(k)).push(r);
  }
  const dup = [...groups.values()].filter((g) => g.length > 1);
  const dupSamples = dup.reduce((n, g) => n + g.length, 0);
  out.push({
    id: "duplicate_metric_fingerprint", sev: 4, scope: "sample", reach: "usable",
    why: "Different usable samples share identical cells, genes, UMIs, mapping rate and input reads (copied or duplicated QC rows)",
    n: dupSamples, n_reach: dupSamples, score: Number((4 * Math.log10(dupSamples + 1)).toFixed(2)),
    examples: dup.sort((a, b) => b.length - a.length).slice(0, nExamples).map((g) => ({ samples: g.length, studies: new Set(g.map((r) => r.gse_id)).size, gsm_ids: g.slice(0, 3).map((r) => r.gsm_id).join(","), cells: g[0].cells, genes: g[0].genes, reads: g[0].reads })),
  });

  // 2. Within a study, a sample whose median genes per cell is under a fifth of its siblings' (and a robust
  // z-score below -4 on the log scale): the same experiment, but this sample did not work.
  const byStudy = new Map();
  for (const r of rows) (byStudy.get(r.gse_id) ?? byStudy.set(r.gse_id, []).get(r.gse_id)).push(r);
  const outliers = [];
  for (const [gse, rs] of byStudy) {
    if (rs.length < 4) continue;
    const logs = rs.map((r) => Math.log(Math.max(r.genes, 1)));
    const med = median(logs);
    const mad = median(logs.map((v) => Math.abs(v - med))) * 1.4826 || 0.15;
    for (const r of rs) {
      const z = (Math.log(Math.max(r.genes, 1)) - med) / mad;
      if (z < -4 && r.genes < Math.exp(med) / 5) outliers.push({ gse_id: gse, gsm_id: r.gsm_id, genes: r.genes, study_median_genes: Math.round(Math.exp(med)), z: Number(z.toFixed(1)), cells: r.cells });
    }
  }
  out.push({
    id: "sample_far_below_study_peers", sev: 3, scope: "sample", reach: "usable",
    why: "Median genes per cell under a fifth of the study median and robust z below -4 (one sample failed inside a study that worked)",
    n: outliers.length, n_reach: outliers.length, score: Number((3 * Math.log10(outliers.length + 1)).toFixed(2)),
    examples: outliers.sort((a, b) => a.z - b.z).slice(0, nExamples),
  });

  // 3. Cells called well above the reads that could support them (under 50 reads per cell), a sign that
  // empty droplets were called as cells.
  const empty = rows.filter((r) => r.reads > 0 && r.cells > 0 && r.reads / r.cells < 50);
  out.push({
    id: "reads_per_cell_implausible", sev: 3, scope: "sample", reach: "usable",
    why: "Under 50 input reads per called cell (empty droplets likely called as cells)",
    n: empty.length, n_reach: empty.length, score: Number((3 * Math.log10(empty.length + 1)).toFixed(2)),
    examples: empty.sort((a, b) => a.reads / a.cells - b.reads / b.cells).slice(0, nExamples).map((r) => ({ gse_id: r.gse_id, gsm_id: r.gsm_id, reads: r.reads, cells: r.cells, reads_per_cell: Number((r.reads / r.cells).toFixed(1)) })),
  });
  return out;
}

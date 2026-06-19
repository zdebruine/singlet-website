#!/usr/bin/env node
/**
 * Seed the local D1 database by running wrangler d1 execute --command for each row.
 * Usage: node scripts/seed-local-d1.mjs
 */
import { execSync } from "node:child_process";

const WRANGLER = "./node_modules/.bin/wrangler";
const DB = "singlet-catalog";

function exec(sql) {
  // Escape single quotes in the SQL
  const escaped = sql.replace(/'/g, "'\\''");
  try {
    execSync(`${WRANGLER} d1 execute ${DB} --local --command '${escaped}'`, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch (e) {
    console.error("FAILED:", sql.slice(0, 80));
    console.error(e.stderr?.toString().slice(0, 200));
    return false;
  }
}

console.log("Seeding local D1 database...\n");

// ── GSE rows ──────────────────────────────────────────────────────────────────
const gseRows = [
  ["GSE200218", "Single-cell RNA sequencing of human PBMC", "Homo sapiens", 12, 10, 2, 185000, '["35631567"]', "2022-03-15"],
  ["GSE196153", "Mouse brain atlas single-cell transcriptomics", "Mus musculus", 18, 16, 2, 320000, '["35668182"]', "2022-01-20"],
  ["GSE189762", "Lung cancer tumor microenvironment scRNA-seq", "Homo sapiens", 8, 7, 1, 92000, '["35484399"]', "2021-11-05"],
  ["GSE171524", "Human liver cell atlas", "Homo sapiens", 9, 9, 0, 140000, '["35177654"]', "2021-05-12"],
  ["GSE158055", "COVID-19 blood immune landscape", "Homo sapiens", 24, 20, 4, 288000, '["33340223"]', "2020-09-22"],
];

for (const [id, title, organism, ntot, ndone, nfail, ncells, pmids, date] of gseRows) {
  exec(`INSERT OR IGNORE INTO gse (id,title,organism,n_gsm_total,n_gsm_done,n_gsm_failed,n_cells,pubmed_ids,submitted_date,last_updated) VALUES ('${id}','${title}','${organism}',${ntot},${ndone},${nfail},${ncells},'${pmids}','${date}','2026-01-12T00:00:00Z')`);
}
console.log("✓ GSE rows inserted");

// ── GSM rows ──────────────────────────────────────────────────────────────────
const gsmRows = [
  // GSE200218 PBMC
  ["GSM6010234","GSE200218","Homo sapiens","10x Chromium v3","scrna","blood","PBMC","D001","healthy","female",18432,0.82,1420,3800,3.2,"SUCCESS","gold","2026-01-08","PBMC donor 1 rep 1"],
  ["GSM6010235","GSE200218","Homo sapiens","10x Chromium v3","scrna","blood","PBMC","D001","healthy","female",17891,0.81,1390,3720,3.4,"SUCCESS","gold","2026-01-08","PBMC donor 1 rep 2"],
  ["GSM6010236","GSE200218","Homo sapiens","10x Chromium v3","scrna","blood","PBMC","D002","healthy","male",19234,0.79,1350,3540,4.1,"SUCCESS","gold","2026-01-08","PBMC donor 2 rep 1"],
  ["GSM6010237","GSE200218","Homo sapiens","10x Chromium v3","scrna","blood","PBMC","D002","healthy","male",2100,0.45,180,320,28.5,"SOFT_FAIL",null,"2026-01-09","PBMC donor 2 rep 2 QC fail"],
  ["GSM6010238","GSE200218","Homo sapiens","10x Chromium v3","scrna","blood","PBMC","D003","healthy","female",21045,0.85,1560,4200,2.8,"SUCCESS","gold","2026-01-09","PBMC donor 3 rep 1"],
  ["GSM6010239","GSE200218","Homo sapiens","10x Chromium v3","scrna","blood","PBMC","D003","healthy","female",20892,0.84,1510,4050,2.9,"SUCCESS","gold","2026-01-09","PBMC donor 3 rep 2"],
  ["GSM6010240","GSE200218","Homo sapiens","10x Chromium v3","scrna","blood","PBMC","D004","healthy","male",16789,0.76,1240,3120,5.3,"SUCCESS","silver","2026-01-09","PBMC donor 4"],
  ["GSM6010241","GSE200218","Homo sapiens","10x Chromium v3","scrna","blood","PBMC","D005","healthy","male",0,null,null,null,null,"HARD_FAIL",null,"2026-01-10","PBMC donor 5 alignment fail"],
  ["GSM6010242","GSE200218","Homo sapiens","10x Chromium v3","scrna","blood","PBMC","D006","healthy","female",22301,0.88,1680,4500,2.1,"SUCCESS","gold","2026-01-10","PBMC donor 6"],
  ["GSM6010243","GSE200218","Homo sapiens","10x Chromium v3","scrna","blood","PBMC","D007","healthy","male",19876,0.83,1480,3950,3.0,"SUCCESS","gold","2026-01-10","PBMC donor 7"],
  // GSE196153 Mouse brain
  ["GSM5884201","GSE196153","Mus musculus","10x Chromium v3","scrna","brain","neuron","M001","healthy","male",31204,0.91,2100,5800,1.2,"SUCCESS","gold","2026-01-05","Mouse cortex region 1"],
  ["GSM5884202","GSE196153","Mus musculus","10x Chromium v3","scrna","brain","astrocyte","M001","healthy","male",28901,0.89,1980,5200,1.5,"SUCCESS","gold","2026-01-05","Mouse cortex region 2"],
  ["GSM5884203","GSE196153","Mus musculus","10x Chromium v3","scrna","brain","microglia","M002","healthy","female",25678,0.87,1750,4600,1.8,"SUCCESS","gold","2026-01-05","Mouse hippocampus"],
  ["GSM5884204","GSE196153","Mus musculus","10x Chromium v3","scrna","brain","oligodendrocyte","M002","healthy","female",22345,0.85,1620,4200,2.0,"SUCCESS","gold","2026-01-06","Mouse cerebellum"],
  ["GSM5884205","GSE196153","Mus musculus","10x Chromium v3","scrna","brain","neuron","M003","healthy","male",19876,0.82,1480,3800,2.5,"SUCCESS","silver","2026-01-06","Mouse striatum"],
  ["GSM5884206","GSE196153","Mus musculus","10x Chromium v3","scrna","brain","neuron","M003","healthy","male",0,null,null,null,null,"HARD_FAIL",null,"2026-01-06","Mouse thalamus STAR fail"],
  ["GSM5884207","GSE196153","Mus musculus","10x Chromium v3","scrna","brain","endothelial","M004","healthy","female",17234,0.88,1890,4900,1.3,"SUCCESS","gold","2026-01-07","Mouse brainstem"],
  ["GSM5884208","GSE196153","Mus musculus","Drop-seq","scrna","brain","neuron","M005","healthy","male",14567,0.79,1320,3200,3.1,"SUCCESS","silver","2026-01-07","Mouse olfactory bulb"],
  // GSE189762 Lung cancer
  ["GSM5707001","GSE189762","Homo sapiens","10x Chromium v3","scrna","lung","T cell","P001","NSCLC","male",12345,0.78,1190,2900,6.2,"SUCCESS","silver","2026-01-03","Lung tumor TIL patient 1"],
  ["GSM5707002","GSE189762","Homo sapiens","10x Chromium v3","scrna","lung","macrophage","P001","NSCLC","male",9876,0.75,1050,2600,7.8,"SUCCESS","silver","2026-01-03","Lung tumor TAM patient 1"],
  ["GSM5707003","GSE189762","Homo sapiens","10x Chromium v3","scrna","lung","epithelial","P002","NSCLC","female",15678,0.81,1320,3300,5.4,"SUCCESS","gold","2026-01-04","Lung tumor epithelium patient 2"],
  ["GSM5707004","GSE189762","Homo sapiens","10x Chromium v3","scrna","lung","NK cell","P002","NSCLC","female",8234,0.72,980,2400,8.9,"SUCCESS","bronze","2026-01-04","Lung adjacent normal patient 2"],
  ["GSM5707005","GSE189762","Homo sapiens","10x Chromium v3","scrna","lung","B cell","P003","NSCLC","male",11234,0.76,1100,2750,6.5,"SUCCESS","silver","2026-01-04","Lung pleural effusion patient 3"],
  ["GSM5707006","GSE189762","Homo sapiens","10x Chromium v3","scrna","lung","mast cell","P003","NSCLC","male",6789,0.69,870,2100,9.2,"SOFT_FAIL",null,"2026-01-05","Lung lymph node patient 3 low quality"],
  ["GSM5707007","GSE189762","Homo sapiens","10x Chromium v3","scrna","lung","dendritic cell","P004","NSCLC","female",0,null,null,null,null,"HARD_FAIL",null,"2026-01-05","Lung sample patient 4 download fail"],
  // GSE171524 Human liver
  ["GSM5220101","GSE171524","Homo sapiens","10x Chromium v3","snrna","liver","hepatocyte","L001","healthy","male",14567,0.86,2890,6200,0.8,"SUCCESS","gold","2025-12-20","Human liver donor 1"],
  ["GSM5220102","GSE171524","Homo sapiens","10x Chromium v3","snrna","liver","stellate cell","L002","healthy","female",12890,0.83,2650,5800,1.1,"SUCCESS","gold","2025-12-20","Human liver donor 2"],
  ["GSM5220103","GSE171524","Homo sapiens","10x Chromium v3","snrna","liver","Kupffer cell","L003","healthy","male",11234,0.81,2400,5300,1.4,"SUCCESS","gold","2025-12-21","Human liver donor 3"],
  ["GSM5220104","GSE171524","Homo sapiens","10x Chromium v3","snrna","liver","endothelial","L004","healthy","female",13456,0.84,2780,6000,0.9,"SUCCESS","gold","2025-12-21","Human liver donor 4"],
  ["GSM5220105","GSE171524","Homo sapiens","10x Chromium v3","snrna","liver","cholangiocyte","L005","healthy","male",15678,0.88,3100,6800,0.7,"SUCCESS","gold","2025-12-22","Human liver donor 5"],
  ["GSM5220106","GSE171524","Homo sapiens","10x Chromium v3","snrna","liver","hepatocyte","L006","healthy","female",16890,0.90,3250,7100,0.6,"SUCCESS","gold","2025-12-22","Human liver donor 6"],
  ["GSM5220107","GSE171524","Homo sapiens","10x Chromium v3","snrna","liver","hepatocyte","L007","healthy","male",14234,0.85,2950,6500,0.8,"SUCCESS","gold","2025-12-23","Human liver donor 7"],
  ["GSM5220108","GSE171524","Homo sapiens","10x Chromium v3","snrna","liver","NK cell","L008","healthy","female",13012,0.82,2700,5900,1.0,"SUCCESS","gold","2025-12-23","Human liver donor 8"],
  ["GSM5220109","GSE171524","Homo sapiens","10x Chromium v3","snrna","liver","hepatocyte","L009","healthy","male",17234,0.91,3400,7500,0.5,"SUCCESS","gold","2025-12-24","Human liver donor 9"],
  // GSE158055 COVID-19
  ["GSM4796583","GSE158055","Homo sapiens","10x Chromium v2","scrna","blood","monocyte","C001","COVID-19 severe","male",13456,0.77,1150,2800,7.5,"SUCCESS","silver","2025-12-15","Severe COVID-19 patient 1"],
  ["GSM4796584","GSE158055","Homo sapiens","10x Chromium v2","scrna","blood","T cell","C001","COVID-19 severe","male",11234,0.74,1020,2500,8.1,"SUCCESS","bronze","2025-12-15","Severe COVID-19 patient 1 T cells"],
  ["GSM4796585","GSE158055","Homo sapiens","10x Chromium v2","scrna","blood","neutrophil","C002","COVID-19 moderate","female",14567,0.79,1180,2900,6.8,"SUCCESS","silver","2025-12-16","Moderate COVID-19 patient 2"],
  ["GSM4796586","GSE158055","Homo sapiens","10x Chromium v2","scrna","blood","NK cell","C003","COVID-19 mild","male",10234,0.80,1220,3100,5.9,"SUCCESS","silver","2025-12-16","Mild COVID-19 patient 3"],
  ["GSM4796587","GSE158055","Homo sapiens","10x Chromium v2","scrna","blood","B cell","C004","healthy","female",9876,0.83,1350,3400,4.2,"SUCCESS","gold","2025-12-17","Healthy control 1"],
  ["GSM4796588","GSE158055","Homo sapiens","10x Chromium v2","scrna","blood","plasmablast","C004","healthy","female",8567,0.85,1420,3600,3.8,"SUCCESS","gold","2025-12-17","Healthy control 1 plasmablasts"],
  ["GSM4796589","GSE158055","Homo sapiens","10x Chromium v2","scrna","blood","monocyte","C005","COVID-19 critical","male",0,null,null,null,null,"HARD_FAIL",null,"2025-12-18","Critical COVID-19 patient 5 seq fail"],
  ["GSM4796590","GSE158055","Homo sapiens","10x Chromium v2","scrna","blood","dendritic cell","C006","COVID-19 severe","female",7890,0.65,820,1900,11.2,"SOFT_FAIL",null,"2025-12-18","Severe COVID-19 patient 6 high MT"],
];

let ok = 0, fail = 0;
for (const row of gsmRows) {
  const [gsm_id, gse_id, organism, protocol, modality, tissue, cell_type, donor_id, disease, sex, n_cells, mr, mg, mu, mt, status, qc_flag, pipeline_date, title] = row;
  const ncStr = n_cells === null || n_cells === 0 ? (status === "HARD_FAIL" ? "NULL" : n_cells) : n_cells;
  const mrStr = mr === null ? "NULL" : mr;
  const mgStr = mg === null ? "NULL" : mg;
  const muStr = mu === null ? "NULL" : mu;
  const mtStr = mt === null ? "NULL" : mt;
  const qcStr = qc_flag === null ? "NULL" : `'${qc_flag}'`;
  const sql = `INSERT OR IGNORE INTO gsm (gsm_id,gse_id,organism,protocol,modality,tissue,cell_type,donor_id,disease,sex,n_cells,mapping_rate,median_genes,median_umis,mt_pct,status,qc_flag,pipeline_date,title,last_updated,srr_ids) VALUES ('${gsm_id}','${gse_id}','${organism}','${protocol}','${modality}','${tissue}','${cell_type}','${donor_id}','${disease}','${sex}',${ncStr},${mrStr},${mgStr},${muStr},${mtStr},'${status}',${qcStr},'${pipeline_date}','${title}','2026-01-12T00:00:00Z','[]')`;
  if (exec(sql)) ok++; else fail++;
}
console.log(`✓ GSM rows: ${ok} inserted, ${fail} failed`);

// ── Publications ──────────────────────────────────────────────────────────────
const pubs = [
  ["35631567", "Single-cell immune profiling of peripheral blood", "10.1038/s41590-022-01214-1", 2022, "Nature Immunology"],
  ["35668182", "A transcriptomic atlas of mouse brain cell types", "10.1016/j.cell.2022.05.013", 2022, "Cell"],
  ["35484399", "Single-cell landscape of tumor microenvironment in NSCLC", "10.1038/s41422-022-00654-6", 2022, "Cell Research"],
  ["35177654", "A single-cell atlas of the human liver", "10.1016/j.cell.2021.12.015", 2022, "Cell"],
  ["33340223", "COVID-19 immune features by single-cell transcriptome atlas", "10.1016/j.cell.2021.01.053", 2021, "Cell"],
];
for (const [pmid, title, doi, year, journal] of pubs) {
  exec(`INSERT OR IGNORE INTO publications (pmid,title,doi,year,journal) VALUES ('${pmid}','${title}','${doi}',${year},'${journal}')`);
}
console.log("✓ Publications inserted");

const gp = [
  ["GSE200218","35631567"],["GSE196153","35668182"],["GSE189762","35484399"],["GSE171524","35177654"],["GSE158055","33340223"],
];
for (const [gse_id, pmid] of gp) {
  exec(`INSERT OR IGNORE INTO gse_publication (gse_id,pmid) VALUES ('${gse_id}','${pmid}')`);
}
console.log("✓ GSE-Publication links inserted");

// ── Meta cache ────────────────────────────────────────────────────────────────
const statsJson = JSON.stringify({
  total_samples: 48, success_samples: 38, total_cells: 1137482,
  species_count: 2, series_count: 5,
  avg_mapping_rate: 0.829, avg_median_genes: 1812, success_rate: 0.7917
});
exec(`INSERT OR REPLACE INTO meta_cache (key,value,updated_at) VALUES ('corpus_stats','${statsJson}','2026-01-12T00:00:00Z')`);

const facetsJson = JSON.stringify({
  organisms: ["Homo sapiens","Mus musculus"],
  protocols: ["10x Chromium v3","10x Chromium v2","Drop-seq"],
  tissues: ["blood","brain","lung","liver"],
  cell_types: ["PBMC","neuron","T cell","hepatocyte","macrophage","NK cell","B cell","astrocyte","microglia","endothelial"],
  diseases: ["healthy","COVID-19 severe","COVID-19 moderate","COVID-19 mild","COVID-19 critical","NSCLC"],
  sexes: ["male","female"],
  statuses: ["SUCCESS","SOFT_FAIL","HARD_FAIL"],
  qc_flags: ["gold","silver","bronze"],
  failure_categories: []
});
exec(`INSERT OR REPLACE INTO meta_cache (key,value,updated_at) VALUES ('facets','${facetsJson.replace(/'/g, "''")}'  ,'2026-01-12T00:00:00Z')`);
console.log("✓ Meta cache populated");

console.log("\nDone! Local D1 seeded.");

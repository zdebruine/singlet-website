-- Local dev seed data (~50 representative rows)
-- Run: wrangler d1 execute singlet-catalog --local --file schema/002_seed_local.sql

-- ── GSE Series ───────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO gse (id, title, abstract, organism, n_gsm_total, n_gsm_done, n_gsm_failed, n_cells, pubmed_ids, submitted_date, last_updated) VALUES
('GSE200218', 'Single-cell RNA sequencing of human PBMC', 'Comprehensive single-cell profiling of peripheral blood mononuclear cells from healthy donors across multiple time points.', 'Homo sapiens', 12, 10, 2, 185000, '["35631567"]', '2022-03-15', '2026-01-10T12:00:00Z'),
('GSE196153', 'Mouse brain atlas single-cell transcriptomics', 'A comprehensive atlas of mouse brain cell types using droplet-based single-cell RNA sequencing.', 'Mus musculus', 18, 16, 2, 320000, '["35668182"]', '2022-01-20', '2026-01-11T09:00:00Z'),
('GSE189762', 'Lung cancer tumor microenvironment scRNA-seq', 'Single-cell profiling of tumor-infiltrating immune cells in non-small cell lung cancer.', 'Homo sapiens', 8, 7, 1, 92000, '["35484399"]', '2021-11-05', '2026-01-09T15:00:00Z'),
('GSE171524', 'Human liver cell atlas', 'Single-nucleus RNA sequencing of healthy human liver across 9 donors.', 'Homo sapiens', 9, 9, 0, 140000, '["35177654"]', '2021-05-12', '2026-01-08T10:00:00Z'),
('GSE158055', 'COVID-19 blood immune landscape', 'Single-cell transcriptomics of blood immune cells from COVID-19 patients at different severity levels.', 'Homo sapiens', 24, 20, 4, 288000, '["33340223"]', '2020-09-22', '2026-01-12T08:00:00Z');

-- ── GSM Samples (10x Chromium human PBMC — GSE200218) ────────────────────────
INSERT OR IGNORE INTO gsm (gsm_id, gse_id, organism, protocol, modality, tissue, cell_type, donor_id, disease, sex, n_cells, mapping_rate, median_genes, median_umis, mt_pct, status, qc_flag, singlet_version, pipeline_date, pz_size_bytes, title, source, srr_ids, last_updated) VALUES
('GSM6010234', 'GSE200218', 'Homo sapiens', '10x Chromium v3', 'scrna', 'blood', 'PBMC', 'D001', 'healthy', 'female', 18432, 0.82, 1420, 3800, 3.2, 'SUCCESS', 'gold', '0.9.0', '2026-01-08', 45678901, 'PBMC donor 1 replicate 1', 'GEO', '["SRR18824301"]', '2026-01-08T12:00:00Z'),
('GSM6010235', 'GSE200218', 'Homo sapiens', '10x Chromium v3', 'scrna', 'blood', 'PBMC', 'D001', 'healthy', 'female', 17891, 0.81, 1390, 3720, 3.4, 'SUCCESS', 'gold', '0.9.0', '2026-01-08', 44210987, 'PBMC donor 1 replicate 2', 'GEO', '["SRR18824302"]', '2026-01-08T12:30:00Z'),
('GSM6010236', 'GSE200218', 'Homo sapiens', '10x Chromium v3', 'scrna', 'blood', 'PBMC', 'D002', 'healthy', 'male', 19234, 0.79, 1350, 3540, 4.1, 'SUCCESS', 'gold', '0.9.0', '2026-01-08', 47891234, 'PBMC donor 2 replicate 1', 'GEO', '["SRR18824303"]', '2026-01-08T13:00:00Z'),
('GSM6010237', 'GSE200218', 'Homo sapiens', '10x Chromium v3', 'scrna', 'blood', 'PBMC', 'D002', 'healthy', 'male', 2100, 0.45, 180, 320, 28.5, 'SOFT_FAIL', NULL, '0.9.0', '2026-01-09', 5234567, 'PBMC donor 2 replicate 2 (QC fail)', 'GEO', '["SRR18824304"]', '2026-01-09T08:00:00Z'),
('GSM6010238', 'GSE200218', 'Homo sapiens', '10x Chromium v3', 'scrna', 'blood', 'PBMC', 'D003', 'healthy', 'female', 21045, 0.85, 1560, 4200, 2.8, 'SUCCESS', 'gold', '0.9.0', '2026-01-09', 51234567, 'PBMC donor 3 replicate 1', 'GEO', '["SRR18824305"]', '2026-01-09T09:00:00Z'),
('GSM6010239', 'GSE200218', 'Homo sapiens', '10x Chromium v3', 'scrna', 'blood', 'PBMC', 'D003', 'healthy', 'female', 20892, 0.84, 1510, 4050, 2.9, 'SUCCESS', 'gold', '0.9.0', '2026-01-09', 50987654, 'PBMC donor 3 replicate 2', 'GEO', '["SRR18824306"]', '2026-01-09T09:30:00Z'),
('GSM6010240', 'GSE200218', 'Homo sapiens', '10x Chromium v3', 'scrna', 'blood', 'PBMC', 'D004', 'healthy', 'male', 16789, 0.76, 1240, 3120, 5.3, 'SUCCESS', 'silver', '0.9.0', '2026-01-09', 41234567, 'PBMC donor 4', 'GEO', '["SRR18824307"]', '2026-01-09T10:00:00Z'),
('GSM6010241', 'GSE200218', 'Homo sapiens', '10x Chromium v3', 'scrna', 'blood', 'PBMC', 'D005', 'healthy', 'male', 0, NULL, NULL, NULL, NULL, 'HARD_FAIL', NULL, '0.9.0', '2026-01-10', NULL, 'PBMC donor 5 (alignment fail)', 'GEO', '["SRR18824308"]', '2026-01-10T07:00:00Z'),
('GSM6010242', 'GSE200218', 'Homo sapiens', '10x Chromium v3', 'scrna', 'blood', 'PBMC', 'D006', 'healthy', 'female', 22301, 0.88, 1680, 4500, 2.1, 'SUCCESS', 'gold', '0.9.0', '2026-01-10', 54567890, 'PBMC donor 6', 'GEO', '["SRR18824309"]', '2026-01-10T08:00:00Z'),
('GSM6010243', 'GSE200218', 'Homo sapiens', '10x Chromium v3', 'scrna', 'blood', 'PBMC', 'D007', 'healthy', 'male', 19876, 0.83, 1480, 3950, 3.0, 'SUCCESS', 'gold', '0.9.0', '2026-01-10', 48765432, 'PBMC donor 7', 'GEO', '["SRR18824310"]', '2026-01-10T09:00:00Z');

-- ── GSM Samples (mouse brain — GSE196153) ────────────────────────────────────
INSERT OR IGNORE INTO gsm (gsm_id, gse_id, organism, protocol, modality, tissue, cell_type, donor_id, disease, sex, n_cells, mapping_rate, median_genes, median_umis, mt_pct, status, qc_flag, singlet_version, pipeline_date, pz_size_bytes, title, source, srr_ids, last_updated) VALUES
('GSM5884201', 'GSE196153', 'Mus musculus', '10x Chromium v3', 'scrna', 'brain', 'neuron', 'M001', 'healthy', 'male', 31204, 0.91, 2100, 5800, 1.2, 'SUCCESS', 'gold', '0.9.0', '2026-01-05', 82345678, 'Mouse cortex region 1', 'GEO', '["SRR18001201"]', '2026-01-05T10:00:00Z'),
('GSM5884202', 'GSE196153', 'Mus musculus', '10x Chromium v3', 'scrna', 'brain', 'astrocyte', 'M001', 'healthy', 'male', 28901, 0.89, 1980, 5200, 1.5, 'SUCCESS', 'gold', '0.9.0', '2026-01-05', 76543210, 'Mouse cortex region 2', 'GEO', '["SRR18001202"]', '2026-01-05T10:30:00Z'),
('GSM5884203', 'GSE196153', 'Mus musculus', '10x Chromium v3', 'scrna', 'brain', 'microglia', 'M002', 'healthy', 'female', 25678, 0.87, 1750, 4600, 1.8, 'SUCCESS', 'gold', '0.9.0', '2026-01-05', 68901234, 'Mouse hippocampus', 'GEO', '["SRR18001203"]', '2026-01-05T11:00:00Z'),
('GSM5884204', 'GSE196153', 'Mus musculus', '10x Chromium v3', 'scrna', 'brain', 'oligodendrocyte', 'M002', 'healthy', 'female', 22345, 0.85, 1620, 4200, 2.0, 'SUCCESS', 'gold', '0.9.0', '2026-01-06', 61234567, 'Mouse cerebellum', 'GEO', '["SRR18001204"]', '2026-01-06T09:00:00Z'),
('GSM5884205', 'GSE196153', 'Mus musculus', '10x Chromium v3', 'scrna', 'brain', 'neuron', 'M003', 'healthy', 'male', 19876, 0.82, 1480, 3800, 2.5, 'SUCCESS', 'silver', '0.9.0', '2026-01-06', 53456789, 'Mouse striatum', 'GEO', '["SRR18001205"]', '2026-01-06T10:00:00Z'),
('GSM5884206', 'GSE196153', 'Mus musculus', '10x Chromium v3', 'scrna', 'brain', 'neuron', 'M003', 'healthy', 'male', 0, NULL, NULL, NULL, NULL, 'HARD_FAIL', NULL, '0.9.0', '2026-01-06', NULL, 'Mouse thalamus (STAR fail)', 'GEO', '["SRR18001206"]', '2026-01-06T11:00:00Z'),
('GSM5884207', 'GSE196153', 'Mus musculus', '10x Chromium v3', 'scrna', 'brain', 'endothelial', 'M004', 'healthy', 'female', 17234, 0.88, 1890, 4900, 1.3, 'SUCCESS', 'gold', '0.9.0', '2026-01-07', 46789012, 'Mouse brainstem', 'GEO', '["SRR18001207"]', '2026-01-07T08:00:00Z'),
('GSM5884208', 'GSE196153', 'Mus musculus', 'Drop-seq', 'scrna', 'brain', 'neuron', 'M005', 'healthy', 'male', 14567, 0.79, 1320, 3200, 3.1, 'SUCCESS', 'silver', '0.9.0', '2026-01-07', 39876543, 'Mouse olfactory bulb', 'GEO', '["SRR18001208"]', '2026-01-07T09:00:00Z');

-- ── GSM Samples (lung cancer — GSE189762) ────────────────────────────────────
INSERT OR IGNORE INTO gsm (gsm_id, gse_id, organism, protocol, modality, tissue, cell_type, donor_id, disease, sex, n_cells, mapping_rate, median_genes, median_umis, mt_pct, status, qc_flag, singlet_version, pipeline_date, pz_size_bytes, title, source, srr_ids, last_updated) VALUES
('GSM5707001', 'GSE189762', 'Homo sapiens', '10x Chromium v3', 'scrna', 'lung', 'T cell', 'P001', 'NSCLC', 'male', 12345, 0.78, 1190, 2900, 6.2, 'SUCCESS', 'silver', '0.9.0', '2026-01-03', 32456789, 'Lung tumor TIL patient 1', 'GEO', '["SRR17654301"]', '2026-01-03T10:00:00Z'),
('GSM5707002', 'GSE189762', 'Homo sapiens', '10x Chromium v3', 'scrna', 'lung', 'macrophage', 'P001', 'NSCLC', 'male', 9876, 0.75, 1050, 2600, 7.8, 'SUCCESS', 'silver', '0.9.0', '2026-01-03', 26789012, 'Lung tumor TAM patient 1', 'GEO', '["SRR17654302"]', '2026-01-03T11:00:00Z'),
('GSM5707003', 'GSE189762', 'Homo sapiens', '10x Chromium v3', 'scrna', 'lung', 'epithelial', 'P002', 'NSCLC', 'female', 15678, 0.81, 1320, 3300, 5.4, 'SUCCESS', 'gold', '0.9.0', '2026-01-04', 41234567, 'Lung tumor epithelium patient 2', 'GEO', '["SRR17654303"]', '2026-01-04T09:00:00Z'),
('GSM5707004', 'GSE189762', 'Homo sapiens', '10x Chromium v3', 'scrna', 'lung', 'NK cell', 'P002', 'NSCLC', 'female', 8234, 0.72, 980, 2400, 8.9, 'SUCCESS', 'bronze', '0.9.0', '2026-01-04', 22345678, 'Lung adjacent normal patient 2', 'GEO', '["SRR17654304"]', '2026-01-04T10:00:00Z'),
('GSM5707005', 'GSE189762', 'Homo sapiens', '10x Chromium v3', 'scrna', 'lung', 'B cell', 'P003', 'NSCLC', 'male', 11234, 0.76, 1100, 2750, 6.5, 'SUCCESS', 'silver', '0.9.0', '2026-01-04', 29876543, 'Lung pleural effusion patient 3', 'GEO', '["SRR17654305"]', '2026-01-04T11:00:00Z'),
('GSM5707006', 'GSE189762', 'Homo sapiens', '10x Chromium v3', 'scrna', 'lung', 'mast cell', 'P003', 'NSCLC', 'male', 6789, 0.69, 870, 2100, 9.2, 'SOFT_FAIL', NULL, '0.9.0', '2026-01-05', NULL, 'Lung lymph node patient 3 (low quality)', 'GEO', '["SRR17654306"]', '2026-01-05T08:00:00Z'),
('GSM5707007', 'GSE189762', 'Homo sapiens', '10x Chromium v3', 'scrna', 'lung', 'dendritic cell', 'P004', 'NSCLC', 'female', 0, NULL, NULL, NULL, NULL, 'HARD_FAIL', NULL, '0.9.0', '2026-01-05', NULL, 'Lung sample patient 4 (download fail)', 'GEO', '["SRR17654307"]', '2026-01-05T09:00:00Z');

-- ── GSM Samples (human liver — GSE171524) ────────────────────────────────────
INSERT OR IGNORE INTO gsm (gsm_id, gse_id, organism, protocol, modality, tissue, cell_type, donor_id, disease, sex, n_cells, mapping_rate, median_genes, median_umis, mt_pct, status, qc_flag, singlet_version, pipeline_date, pz_size_bytes, title, source, srr_ids, last_updated) VALUES
('GSM5220101', 'GSE171524', 'Homo sapiens', '10x Chromium v3', 'snrna', 'liver', 'hepatocyte', 'L001', 'healthy', 'male', 14567, 0.86, 2890, 6200, 0.8, 'SUCCESS', 'gold', '0.9.0', '2025-12-20', 62345678, 'Human liver donor 1', 'GEO', '["SRR14567801"]', '2025-12-20T10:00:00Z'),
('GSM5220102', 'GSE171524', 'Homo sapiens', '10x Chromium v3', 'snrna', 'liver', 'stellate cell', 'L002', 'healthy', 'female', 12890, 0.83, 2650, 5800, 1.1, 'SUCCESS', 'gold', '0.9.0', '2025-12-20', 55678901, 'Human liver donor 2', 'GEO', '["SRR14567802"]', '2025-12-20T11:00:00Z'),
('GSM5220103', 'GSE171524', 'Homo sapiens', '10x Chromium v3', 'snrna', 'liver', 'Kupffer cell', 'L003', 'healthy', 'male', 11234, 0.81, 2400, 5300, 1.4, 'SUCCESS', 'gold', '0.9.0', '2025-12-21', 49012345, 'Human liver donor 3', 'GEO', '["SRR14567803"]', '2025-12-21T09:00:00Z'),
('GSM5220104', 'GSE171524', 'Homo sapiens', '10x Chromium v3', 'snrna', 'liver', 'endothelial', 'L004', 'healthy', 'female', 13456, 0.84, 2780, 6000, 0.9, 'SUCCESS', 'gold', '0.9.0', '2025-12-21', 58901234, 'Human liver donor 4', 'GEO', '["SRR14567804"]', '2025-12-21T10:00:00Z'),
('GSM5220105', 'GSE171524', 'Homo sapiens', '10x Chromium v3', 'snrna', 'liver', 'cholangiocyte', 'L005', 'healthy', 'male', 15678, 0.88, 3100, 6800, 0.7, 'SUCCESS', 'gold', '0.9.0', '2025-12-22', 67890123, 'Human liver donor 5', 'GEO', '["SRR14567805"]', '2025-12-22T08:00:00Z'),
('GSM5220106', 'GSE171524', 'Homo sapiens', '10x Chromium v3', 'snrna', 'liver', 'hepatocyte', 'L006', 'healthy', 'female', 16890, 0.90, 3250, 7100, 0.6, 'SUCCESS', 'gold', '0.9.0', '2025-12-22', 72345678, 'Human liver donor 6', 'GEO', '["SRR14567806"]', '2025-12-22T09:00:00Z'),
('GSM5220107', 'GSE171524', 'Homo sapiens', '10x Chromium v3', 'snrna', 'liver', 'hepatocyte', 'L007', 'healthy', 'male', 14234, 0.85, 2950, 6500, 0.8, 'SUCCESS', 'gold', '0.9.0', '2025-12-23', 61234567, 'Human liver donor 7', 'GEO', '["SRR14567807"]', '2025-12-23T08:00:00Z'),
('GSM5220108', 'GSE171524', 'Homo sapiens', '10x Chromium v3', 'snrna', 'liver', 'NK cell', 'L008', 'healthy', 'female', 13012, 0.82, 2700, 5900, 1.0, 'SUCCESS', 'gold', '0.9.0', '2025-12-23', 56789012, 'Human liver donor 8', 'GEO', '["SRR14567808"]', '2025-12-23T09:00:00Z'),
('GSM5220109', 'GSE171524', 'Homo sapiens', '10x Chromium v3', 'snrna', 'liver', 'hepatocyte', 'L009', 'healthy', 'male', 17234, 0.91, 3400, 7500, 0.5, 'SUCCESS', 'gold', '0.9.0', '2025-12-24', 74567890, 'Human liver donor 9', 'GEO', '["SRR14567809"]', '2025-12-24T08:00:00Z');

-- ── GSM Samples (COVID-19 — GSE158055) ───────────────────────────────────────
INSERT OR IGNORE INTO gsm (gsm_id, gse_id, organism, protocol, modality, tissue, cell_type, donor_id, disease, sex, n_cells, mapping_rate, median_genes, median_umis, mt_pct, status, qc_flag, singlet_version, pipeline_date, pz_size_bytes, title, source, srr_ids, last_updated) VALUES
('GSM4796583', 'GSE158055', 'Homo sapiens', '10x Chromium v2', 'scrna', 'blood', 'monocyte', 'C001', 'COVID-19 severe', 'male', 13456, 0.77, 1150, 2800, 7.5, 'SUCCESS', 'silver', '0.9.0', '2025-12-15', 35678901, 'Severe COVID-19 patient 1', 'GEO', '["SRR12654321"]', '2025-12-15T10:00:00Z'),
('GSM4796584', 'GSE158055', 'Homo sapiens', '10x Chromium v2', 'scrna', 'blood', 'T cell', 'C001', 'COVID-19 severe', 'male', 11234, 0.74, 1020, 2500, 8.1, 'SUCCESS', 'bronze', '0.9.0', '2025-12-15', 29876543, 'Severe COVID-19 patient 1 T cells', 'GEO', '["SRR12654322"]', '2025-12-15T11:00:00Z'),
('GSM4796585', 'GSE158055', 'Homo sapiens', '10x Chromium v2', 'scrna', 'blood', 'neutrophil', 'C002', 'COVID-19 moderate', 'female', 14567, 0.79, 1180, 2900, 6.8, 'SUCCESS', 'silver', '0.9.0', '2025-12-16', 38901234, 'Moderate COVID-19 patient 2', 'GEO', '["SRR12654323"]', '2025-12-16T09:00:00Z'),
('GSM4796586', 'GSE158055', 'Homo sapiens', '10x Chromium v2', 'scrna', 'blood', 'NK cell', 'C003', 'COVID-19 mild', 'male', 10234, 0.80, 1220, 3100, 5.9, 'SUCCESS', 'silver', '0.9.0', '2025-12-16', 27654321, 'Mild COVID-19 patient 3', 'GEO', '["SRR12654324"]', '2025-12-16T10:00:00Z'),
('GSM4796587', 'GSE158055', 'Homo sapiens', '10x Chromium v2', 'scrna', 'blood', 'B cell', 'C004', 'healthy', 'female', 9876, 0.83, 1350, 3400, 4.2, 'SUCCESS', 'gold', '0.9.0', '2025-12-17', 26789012, 'Healthy control 1', 'GEO', '["SRR12654325"]', '2025-12-17T08:00:00Z'),
('GSM4796588', 'GSE158055', 'Homo sapiens', '10x Chromium v2', 'scrna', 'blood', 'plasmablast', 'C004', 'healthy', 'female', 8567, 0.85, 1420, 3600, 3.8, 'SUCCESS', 'gold', '0.9.0', '2025-12-17', 23456789, 'Healthy control 1 plasmablasts', 'GEO', '["SRR12654326"]', '2025-12-17T09:00:00Z'),
('GSM4796589', 'GSE158055', 'Homo sapiens', '10x Chromium v2', 'scrna', 'blood', 'monocyte', 'C005', 'COVID-19 critical', 'male', 0, NULL, NULL, NULL, NULL, 'HARD_FAIL', NULL, '0.9.0', '2025-12-18', NULL, 'Critical COVID-19 patient 5 (seq fail)', 'GEO', '["SRR12654327"]', '2025-12-18T07:00:00Z'),
('GSM4796590', 'GSE158055', 'Homo sapiens', '10x Chromium v2', 'scrna', 'blood', 'dendritic cell', 'C006', 'COVID-19 severe', 'female', 7890, 0.65, 820, 1900, 11.2, 'SOFT_FAIL', NULL, '0.9.0', '2025-12-18', NULL, 'Severe COVID-19 patient 6 (high MT)', 'GEO', '["SRR12654328"]', '2025-12-18T08:00:00Z');

-- ── Publications ─────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO publications (pmid, title, doi, year, journal) VALUES
('35631567', 'Single-cell immune profiling of peripheral blood reveals COVID-19-associated emergency myelopoiesis', '10.1038/s41590-022-01214-1', 2022, 'Nature Immunology'),
('35668182', 'A transcriptomic atlas of mouse brain cell types', '10.1016/j.cell.2022.05.013', 2022, 'Cell'),
('35484399', 'Single-cell landscape of tumor microenvironment in non-small cell lung cancer', '10.1038/s41422-022-00654-6', 2022, 'Cell Research'),
('35177654', 'A single-cell atlas of the human liver', '10.1016/j.cell.2021.12.015', 2022, 'Cell'),
('33340223', 'COVID-19 immune features revealed by a large-scale single-cell transcriptome atlas', '10.1016/j.cell.2021.01.053', 2021, 'Cell');

INSERT OR IGNORE INTO gse_publication (gse_id, pmid) VALUES
('GSE200218', '35631567'),
('GSE196153', '35668182'),
('GSE189762', '35484399'),
('GSE171524', '35177654'),
('GSE158055', '33340223');

-- ── Meta cache (corpus stats) ─────────────────────────────────────────────────
INSERT OR REPLACE INTO meta_cache (key, value, updated_at) VALUES
('corpus_stats', '{"total_samples":48,"success_samples":38,"total_cells":1137482,"species_count":2,"series_count":5,"avg_mapping_rate":0.829,"avg_median_genes":1812,"success_rate":0.7917}', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
('last_updated', '"2026-01-12T09:00:00Z"', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
('facets', '{"organisms":["Homo sapiens","Mus musculus"],"protocols":["10x Chromium v3","10x Chromium v2","Drop-seq"],"tissues":["blood","brain","lung","liver"],"cell_types":["PBMC","neuron","T cell","hepatocyte","macrophage","NK cell","B cell","astrocyte","microglia","endothelial"],"diseases":["healthy","COVID-19 severe","COVID-19 moderate","COVID-19 mild","COVID-19 critical","NSCLC"],"sexes":["male","female"],"statuses":["SUCCESS","SOFT_FAIL","HARD_FAIL"],"qc_flags":["gold","silver","bronze"],"failure_categories":[]}', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

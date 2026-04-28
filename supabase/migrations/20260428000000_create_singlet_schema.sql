-- Migration: Create singlet database schema
-- Provides: dataset browser, pipeline dashboard, E2E validation, GPU benchmarks

-- ============================================================
-- Table: samples — Every processed GEO sample
-- ============================================================
CREATE TABLE public.samples (
    gsm_id          TEXT PRIMARY KEY,
    gse_id          TEXT NOT NULL,
    srr_ids         TEXT[] NOT NULL DEFAULT '{}',
    organism        TEXT NOT NULL DEFAULT 'unknown',
    taxon_id        INTEGER,
    protocol        TEXT,
    modality        TEXT DEFAULT 'scrna',
    status          TEXT NOT NULL DEFAULT 'PENDING',
    failure_category TEXT,

    -- QC metrics
    mapping_rate    REAL,
    cells_called    INTEGER,
    median_genes    INTEGER,
    median_umis     INTEGER,
    mt_pct          REAL,
    doublet_rate    REAL,
    ambient_pct     REAL,
    saturation      REAL,

    -- Processing metadata
    singlet_version TEXT,
    singlet_commit  TEXT,
    wall_time_s     INTEGER,
    download_path   TEXT,
    pipeline_date   TIMESTAMPTZ,

    -- Data access
    pz_path         TEXT,
    pz_size_bytes   BIGINT,

    -- GEO metadata
    title           TEXT,
    source          TEXT,
    characteristics JSONB DEFAULT '{}'::jsonb,

    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_samples_organism ON public.samples(organism);
CREATE INDEX idx_samples_status ON public.samples(status);
CREATE INDEX idx_samples_gse ON public.samples(gse_id);
CREATE INDEX idx_samples_protocol ON public.samples(protocol);
CREATE INDEX idx_samples_modality ON public.samples(modality);
CREATE INDEX idx_samples_pipeline_date ON public.samples(pipeline_date DESC);

-- ============================================================
-- Table: e2e_results — End-to-end validation panel results
-- ============================================================
CREATE TABLE public.e2e_results (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    panel           TEXT NOT NULL,
    sample_srr      TEXT NOT NULL,
    singlet_commit  TEXT NOT NULL,
    external_tool   TEXT NOT NULL,
    metric_name     TEXT NOT NULL,
    metric_value    REAL NOT NULL,
    threshold       REAL NOT NULL,
    status          TEXT NOT NULL,
    run_date        TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_e2e_run UNIQUE (panel, sample_srr, singlet_commit, metric_name)
);

CREATE INDEX idx_e2e_panel ON public.e2e_results(panel);
CREATE INDEX idx_e2e_status ON public.e2e_results(status);
CREATE INDEX idx_e2e_date ON public.e2e_results(run_date DESC);

-- ============================================================
-- Table: gpu_frontier — singlet-gpu Pareto frontier benchmarks
-- ============================================================
CREATE TABLE public.gpu_frontier (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    feature         TEXT NOT NULL,
    scale           TEXT NOT NULL,
    wall_ms         REAL,
    memory_mb       REAL,
    sota_tool       TEXT,
    sota_wall_ms    REAL,
    speedup         REAL,
    correctness_r   REAL,
    correctness_ref TEXT,
    cycle_number    INTEGER,
    commit_hash     TEXT,
    measured_date   TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_frontier_entry UNIQUE (feature, scale, cycle_number)
);

CREATE INDEX idx_gpu_feature ON public.gpu_frontier(feature);
CREATE INDEX idx_gpu_date ON public.gpu_frontier(measured_date DESC);

-- ============================================================
-- Table: pipeline_batches — Batch submission tracking
-- ============================================================
CREATE TABLE public.pipeline_batches (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_name      TEXT NOT NULL,
    slurm_job_id    TEXT,
    samples_total   INTEGER NOT NULL DEFAULT 0,
    samples_success INTEGER NOT NULL DEFAULT 0,
    samples_failed  INTEGER NOT NULL DEFAULT 0,
    submitted_at    TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_batches_date ON public.pipeline_batches(submitted_at DESC);

-- ============================================================
-- Materialized Views — Aggregated stats (refresh via cron)
-- ============================================================
CREATE MATERIALIZED VIEW public.corpus_stats AS
SELECT
    COUNT(*) AS total_samples,
    COUNT(*) FILTER (WHERE status = 'SUCCESS') AS success_samples,
    SUM(cells_called) FILTER (WHERE status = 'SUCCESS') AS total_cells,
    COUNT(DISTINCT organism) AS species_count,
    COUNT(DISTINCT gse_id) AS series_count,
    ROUND(AVG(mapping_rate) FILTER (WHERE status = 'SUCCESS')::numeric, 4) AS avg_mapping_rate,
    ROUND(AVG(median_genes) FILTER (WHERE status = 'SUCCESS')::numeric, 0) AS avg_median_genes,
    ROUND(
        COUNT(*) FILTER (WHERE status = 'SUCCESS')::numeric /
        NULLIF(COUNT(*) FILTER (WHERE status IN ('SUCCESS','SOFT_FAIL','HARD_FAIL')), 0),
        4
    ) AS success_rate
FROM public.samples;

CREATE MATERIALIZED VIEW public.species_stats AS
SELECT
    organism,
    COUNT(*) AS sample_count,
    SUM(cells_called) AS total_cells,
    ROUND(AVG(mapping_rate)::numeric, 4) AS avg_mapping_rate,
    ROUND(AVG(median_genes)::numeric, 0) AS avg_median_genes
FROM public.samples
WHERE status = 'SUCCESS'
GROUP BY organism
ORDER BY total_cells DESC NULLS LAST;

-- ============================================================
-- Row Level Security — Public read, service-key write
-- ============================================================
ALTER TABLE public.samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.e2e_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gpu_frontier ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_batches ENABLE ROW LEVEL SECURITY;

-- Anyone can read
CREATE POLICY "Public read samples" ON public.samples FOR SELECT USING (true);
CREATE POLICY "Public read e2e" ON public.e2e_results FOR SELECT USING (true);
CREATE POLICY "Public read gpu" ON public.gpu_frontier FOR SELECT USING (true);
CREATE POLICY "Public read batches" ON public.pipeline_batches FOR SELECT USING (true);

-- Service role can write (used by ETL scripts)
CREATE POLICY "Service write samples" ON public.samples FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write e2e" ON public.e2e_results FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write gpu" ON public.gpu_frontier FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write batches" ON public.pipeline_batches FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Functions — Refresh materialized views
-- ============================================================
CREATE OR REPLACE FUNCTION public.refresh_corpus_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW public.corpus_stats;
    REFRESH MATERIALIZED VIEW public.species_stats;
END;
$$;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER samples_updated_at
    BEFORE UPDATE ON public.samples
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

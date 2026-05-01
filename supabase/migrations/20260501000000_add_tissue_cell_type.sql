-- Migration: Add tissue and cell_type columns
-- Derived from source/characteristics metadata normalization

ALTER TABLE public.samples ADD COLUMN IF NOT EXISTS tissue TEXT;
ALTER TABLE public.samples ADD COLUMN IF NOT EXISTS cell_type TEXT;

-- Indexes for filtering
CREATE INDEX IF NOT EXISTS idx_samples_tissue ON public.samples(tissue);
CREATE INDEX IF NOT EXISTS idx_samples_cell_type ON public.samples(cell_type);

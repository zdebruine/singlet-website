# Structured sample type and disease facts (2026-10-28)

`functions/_shared/sample-type.ts` reads each served sample's own GEO record (source and characteristics; never the title, never other
samples of the study) into fields that follow public conventions. Every value carries the GEO segment it came from as evidence.

| Field | Convention | Values | Stored in |
|---|---|---|---|
| `tissue_type` | CELLxGENE schema 7.0.0 `tissue_type` | tissue, organoid, primary cell culture, cell line | `sample_property` |
| `cell_line` | Cellosaurus accession (CELLxGENE puts it in the tissue slot for cell lines) | CVCL_xxxx | `sample_term` attr cell_line, `sample_attr`, `ontology_term`/`ontology_label` (ontology 'Cellosaurus') |
| `tumor_sample_type` | GDC / TCGA `sample_type` | tumor, primary tumor, metastatic, recurrent tumor, adjacent normal (= Solid Tissue Normal) | `sample_property` |
| `disease` | CELLxGENE `disease`: MONDO, or PATO:0000461 normal | term ids | `sample_term` attr disease, `sample_attr` |
| `donor_status` | existing field, derived from the disease term | healthy, diseased | `sample_property` |
| `sample_kind` | existing coarse field, kept and filled | primary, cell_line, stem_cell, organoid, xenograft | `sample_property` |

Choices:
- **Organoids:** the UBERON tissue stays the tissue of origin, as in CELLxGENE. Embryoid bodies and gastruloids are organoids.
- **Primary cell cultures:** the sorted cell type (CL) is the cell, as CELLxGENE's tissue slot requires.
- **Xenografts (PDX / CDX):** these are tissue. A cell line grown as a tumour in an animal and sampled from it is tissue too; its line stays in `cell_line`.
- **Stem-cell-derived cultures:** an ES or iPS line differentiated in a dish is a cell line, of `sample_kind` stem_cell.
- **Healthy:** read only from explicit text ("healthy donor", "non-diseased"). A bare "control" or "normal" counts only under a disease key, for a human donor.
- **Short abbreviations:** these map only through the curated `DISEASE_ALIASES` list, never through a MONDO synonym of the same letters ("MM").
- **Treatment, tumour grade and stage, infection details:** these stay verbatim `sample_attr` values. Infections that name a disease (COVID-19, HIV, TB) are disease terms, as in CELLxGENE.

Run: `cellosaurus_resolve.py` (Cellosaurus API: exact identifier or synonym of the sample's species, unique; a second pass takes a single
alphanumeric token such as "A549" out of a longer value), then `backfill.ts` (export commands in its header). Output in `out/`:
`ontology-terms.sql`, then `sample-type.sql` and `disease.sql`, each ending with the `meta_cache.facts_epoch` bump; `review.csv` with
the evidence of every row; `summary.json`; `disease-unmapped.json`.

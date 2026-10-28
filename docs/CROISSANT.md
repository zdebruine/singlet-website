# Croissant metadata

singlet.bio describes the Research Alpha atlas, every study and every sample in
[MLCommons Croissant 1.1](https://docs.mlcommons.org/croissant/docs/croissant-spec-1.1.html) JSON-LD, with the Responsible AI
vocabulary (`rai:`) and PROV-O provenance (`prov:`). The documents are generated on request from D1 and the study manifest
(`data.singlet.bio/s1/m/<GSE>.json`) by `functions/_shared/croissant.ts`; nothing is stored, and no table was added.

## Routes

| Route | What | Cache |
|---|---|---|
| `GET /croissant.json`, `GET /api/croissant` | The atlas: counts on the `/api/stats` basis, release policy, `studies` record set, a file set over every study manifest | 1 h |
| `GET /api/croissant/studies.csv` | The atlas `studies` record set: one row per downloadable study, with its manifest and Croissant URLs | 1 h |
| `GET /api/croissant/<GSE>` | One study | 300 s (as `/api/gse/:id`) |
| `GET /api/croissant/<GSE>/<GSM>` | One sample of a study (its `cells` record set reads that sample's sidecar alone) | 300 s |
| `GET /api/croissant/<GSE>/samples.csv` | The study's `samples` record set | 300 s |
| `GET /api/croissant/features/<exon pack id>.csv` | The genes of a reference and the matrix rows each owns | 1 day |

Documents are served as `application/ld+json`. A withheld, unknown or not-downloadable study (Research Alpha exclusions,
`DOWNLOADABLE_SQL`), a study not in the .s1 format, and a sample the study does not serve answer 404. Only samples that are part
of the atlas and passed QC (`sample_qc.usable = 1`, `qc_tier` 0: the samples every headline counts) are described; excluded and
low-QC samples are never named. Study pages link their document with `<link rel="describedby" type="application/ld+json">`.

## Dataset-level fields

- `version`: the Research Alpha release-policy id in force, read from D1 (the newest `policy_version` in `alpha_withheld` and
  the last row of `alpha_exclusions`; the loader stamps every row with the policy file's `version`), e.g. `alpha-2026-10-27e`.
- `license`: CC0 1.0. The pipeline (`prov:wasAssociatedWith`, `sc:SoftwareSourceCode`) is MIT.
- `citeAs`: the GEO series (title, accession, linked publications with DOI) and "Singlet Research Alpha (October 2026)".
- `datePublished` / `dateModified`: `s1_study.created_at` / the latest of `s1_study.updated_at` and the manifest's `created_at`
  (atlas: the earliest and latest over all studies and the policy load time).
- `prov:wasDerivedFrom`: the GEO series and the SRA run used per sample; `prov:wasGeneratedBy`: alignment and counting
  (pipeline version and reference build from `sample_qc`), and the .s1 transcode and labelling (manifest `pipeline`).
- `isLiveDataset: true`: manifests and the function CSVs are mutable, so they carry no checksum. Every .s1 object and label
  sidecar is immutable and carries its `sha256` and `contentSize` from the manifest.
- `rai:*`: dataCollection, dataCollectionType, dataCollectionRawData, dataPreprocessingProtocol (pipeline, QC thresholds from
  `qc-rules.ts`, release policy), dataAnnotationProtocol (labeller, GEO-to-ontology mapping, ontology releases from
  `ontology_term.release`), dataAnnotationPlatform and machineAnnotationTools (the sidecars' `model_version`),
  annotationsPerItem, dataAnnotationAnalysis, dataBiases, dataLimitations, personalSensitiveInformation, dataUseCases,
  dataSocialImpact, dataReleaseMaintenancePlan. The accuracy numbers are the published ones (compartment 0.84, lineage 0.75, cell
  type 0.43, subtype 0.32; sex 98.1%; ancestry about 1% of cells); a study document also quotes the per-level accuracy recorded in
  its own manifest. The atlas `dataBiases` are computed: organism shares of samples and cells, tissue groups and assay families by
  studies, coverage against the samples GEO lists, and samples per genetic-ancestry call.

## Record sets (study and sample documents)

| Record set | Source | Loadable with mlcroissant |
|---|---|---|
| `samples` | `samples.csv` (function): GEO metadata with ontology ids for tissue (UBERON), disease (MONDO; healthy PATO:0000461), developmental stage (HsapDv / MmusDv), sex (PATO), self-reported ancestry (HANCESTRO) and sorted cell type (CL) from `sample_term`, each with a `*_mapping` column (rules or model); organism (NCBITaxon); assay, reference build, pipeline version, SRA runs, QC; the labeller's chromosomal sex, genetic ancestry and cell types from `sample_attr`; file URLs and checksums | yes |
| `cells` | label sidecars `s1/a/<GSM>/<digest>.parquet`: `col`, CL cell type id / label / score / path and the per-level confidences, chromosomal sex and score, HANCESTRO ancestry and proportion, model version | per-sample document: yes. Study document: described over a FileSet of the sidecars; mlcroissant 1.1.1 does not read a FileSet of plain files |
| `cell_qc` | `cells` member of each .s1 object: barcode, called, UMIs and features (exon / intron), EmptyDrops call and FDR | no (.s1 container; read with `singlet.load`) |
| `spliced_counts`, `unspliced_counts` | `exon_counts.1pz` / `intron_counts.1pz` members: (col, row, count) of the pz2 matrices | no (.s1 container) |
| `features` | `features/<pack>.csv` (function, decoded from `s1/ref/<pack>.pack`): Ensembl gene id, symbol, build, chromosome, start, end, exon count and the exon and intron row ranges | yes |

The atlas document has one record set, `studies` (`studies.csv`), loadable.

Ontology columns use `dataType: ["sc:Text", <class>]` with the class each ontology's values fall under (checked on OLS):
`obo:UBERON_0001062`, `obo:CL_0000000`, `obo:MONDO_0000001`, `obo:PATO_0001894`, `obo:HANCESTRO_0004`, `obo:HsapDv_0000000`,
`obo:MmusDv_0000000`. The .s1 objects use their specification URL as `encodingFormat` (Croissant: an unregistered format is named by
the most appropriate URL).

## Rendering and validation

`npm run croissant:render -- --out <dir> [--atlas] [--local] GSE…` runs the same loaders and builders against production,
read-only: D1 through `wrangler d1 execute --remote` (the script refuses anything but a single SELECT) and the manifests and packs
from data.singlet.bio. `--local` also writes the function CSVs and copies of the documents that point at them, so `mlcroissant load`
works before the routes are deployed.

`docs/croissant/` holds the documents rendered on 2026-10-28 (release policy `alpha-2026-10-27e`) with production URLs:

| File | Study |
|---|---|
| `atlas.json` | the atlas (6,978 studies, 46,649 samples, 221,161,455 cells) |
| `GSE138867.json`, `GSE138867.GSM4120733.json` | human, blood (8 samples) |
| `GSE133773.json`, `GSE133773.GSM3927202.json` | mouse, brain (3 samples, MmusDv stages) |
| `GSE221988.json`, `GSE221988.GSM6911290.json` | human, with genetic ancestry (HANCESTRO:0005) |

`validation.txt`: `mlcroissant validate` (mlcroissant 1.1.1) on all seven: exit 0, no errors, one warning each: the version
`alpha-2026-10-27e` is not semver. The release-policy id is kept as the version on purpose.

`load.txt`: `mlcroissant load --num_records 5` on the `--local` copies: `samples` (three studies), `features`, `cells` of the three
per-sample documents (sidecars downloaded from data.singlet.bio, sha256 checked) and the atlas `studies` load. `cells` of a study
document fails in mlcroissant 1.1.1 (`Column "col" does not exist`): it does not read a FileSet whose members are plain files; use
the per-sample documents (`samples.croissant_url`).

## After a deploy

```
curl -s https://singlet.bio/croissant.json | head -c 400
curl -sI https://singlet.bio/api/croissant/GSE138867 | grep -i content-type     # application/ld+json
curl -s  https://singlet.bio/api/croissant/GSE138867/samples.csv | head -3
curl -s -o /dev/null -w "%{http_code}\n" https://singlet.bio/api/croissant/GSE128639   # withheld: 404
pip install "mlcroissant[parquet]"
mlcroissant validate --jsonld https://singlet.bio/api/croissant/GSE138867
mlcroissant load --jsonld https://singlet.bio/api/croissant/GSE138867 --record_set samples --num_records 5
mlcroissant load --jsonld https://singlet.bio/api/croissant/GSE138867/GSM4120733 --record_set cells --num_records 5
```

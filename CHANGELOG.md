# Changelog

Changes to what singlet.bio publishes. Newest first.

## 2026-10-24 — Genetic sex is counted for human studies only

Every mouse sample's `sex_call.json` reads "unknown": the pipeline matches the chrY and XIST gene names in upper case, so mouse
symbols (Xist, Uty, Ddx3y, …) never match. The file is present, but it holds no call. The layer statistics (`/api/stats/layers`),
the study summaries and the docs now count and list genetic sex for human studies only, as they already did for ancestry. Mouse
calls return when the pipeline matches mouse gene names and the files are rebuilt.

## 2026-10-22 — Studies are starting to move to one object per sample

A study can now be stored as one object per sample plus a manifest, instead of one `.singlet` file per study. The first study in this
layout is GSE145370 (14 samples); its page, the API and the MCP server say so. The data and the license are unchanged (CC0). The Python and R
packages read this layout from the release that includes the per-sample reader; older versions keep working for every study that still has
its single file.

What you can see:
- `GET /api/gse/<GSE>` has a `series.v2` block with the manifest URL (`https://data.singlet.bio/v2/m/<GSE>.json`), its revision, and
  whether the old single file still exists. `GET /api/bundle/<GSE>/index` and `/entry` list the sample objects and say where a member's
  bytes are, so one sample or one file of a sample can be read with an HTTP range.
- The MCP server gains `find_cells`, `slice_cells` and `resolve_features` once a study is stored this way, and `get_study`, `get_sample_qc`,
  `list_bundle_files`, `get_modalities` and `get_partial_download` return a `rev` that can be sent back as `known_rev`.
- Partial-download recipes (`/api/bundle/<GSE>/entry` for large members, `get_partial_download`) now carry the file's ETag, and the curl and
  Python lines send it as `If-Match`: if the file is replaced after the recipe was made, the read fails with 412 instead of returning other
  bytes. This also fixes recipes that pointed into the wrong bytes for studies whose file had been re-packed in place.

What does not change yet: a study's single `.singlet` file stays at its URL until the per-sample copy has been verified byte for byte and
a grace period has passed. After that the old URL stops working. The study page, `GET /api/gse/<GSE>`, `search_datasets`, `export_manifest`
and the Browse download links then point at the manifest instead (`legacy_available: false` in the v2 block); a link to
`data/<GSE>/<GSE>.singlet` that you saved will return 404 for such a study, and the manifest lists the files that replace it. Files
downloaded before are not affected.

## 2026-10-20 — Donor-level genotype layers are not part of the public downloads

Layers that carry per-donor germline information were taken out of the public product. This covers the donor SNP
read-depth matrices, per-donor genotype and coverage files, allele-specific expression counts, and per-donor
mitochondrial consensus sequences and variant files. They are no longer listed or served by the site, the API or
the MCP server, and they are no longer counted in the layer statistics or offered as a search filter.

The pipeline still computes these layers. The complete original of each study file is held in private storage
for internal tools and for controlled-access accounts, which are not yet open.

Still public: inferred sex, inferred ancestry as a coarse group with its confidence, donor labels from
demultiplexing, doublet scores, and mitochondrial heteroplasmy.

Status of the stored files: the site, API and MCP changes are in this release. The study files on
data.singlet.bio are re-packed without these members after the private copies have been verified; this entry is
updated with the completion date when that is done. Files downloaded before that date are not recalled.

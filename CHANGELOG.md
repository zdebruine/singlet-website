# Changelog

Changes to what singlet.bio publishes. Newest first.

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

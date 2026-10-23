# Ontology mapping: model pass over the long tail (instructions given to the model; inputs are candidates.jsonl from build.ts plus study titles)

Used for the 2026-10-23 pass (docs/ONTOLOGY.md, step 6): the batch files were candidates.jsonl rows on at least 2 samples
with up to 3 study titles each, and the term lists were id/label/synonym TSVs of the non-obsolete terms of each OBO file.
The decisions are model-decisions.jsonl after review.

Each line of your batch file is one metadata value written by GEO submitters for single-cell RNA-seq samples, which
a dictionary matcher could not place. Decide, for each value, the one ontology term it denotes, or null.

Fields: `attr` (which sample attribute the value was given for), `value` (as stored), `raw` (original text, if
different), `n_samples`, `n_studies`, `studies` (up to 3 "GSE: title" lines that use the value — context only),
`candidates` (lexical candidates, may be wrong or miss the right term).

Target ontology by attr:
- `tissue` -> UBERON (anatomy). Term list: terms-UBERON.tsv
- `cell_type_sorted` -> CL (cell types). Term list: terms-CL.tsv
- `disease` -> MONDO. Term list: terms-MONDO.tsv
- `ancestry` -> HANCESTRO. Term list: terms-HANCESTRO.tsv

The TSVs (same folder as this file) have `id<TAB>label<TAB>synonyms (scope)`; obsolete terms are excluded. Search
them with grep (`grep -i "terminal ileum" terms-UBERON.tsv`). Any id you output must be a line of the right TSV and
`label` must be exactly its label (column 2). Wrong ids are rejected automatically, so check every one.

Rules (precision first: a wrong mapping is worse than none; leave anything you are not sure of as null):
1. Map only when the value itself clearly denotes the entity. The study titles help read abbreviations and typos
   ("PMBC" -> peripheral blood mononuclear cell); they never supply an entity the value does not name.
2. If one value is used by several studies (n_studies > 1) with different meanings, null.
3. Choose the most specific term you are certain of; a correct broader term beats a doubtful narrow one
   ("Frontal Cx (BA9)" -> "Brodmann (1909) area 9" is fine; "lung cells" as tissue -> "lung").
4. tissue: never derive a tissue from a disease or tumour word ("esophageal adenocarcinoma", "tumor",
   "Brain Metastases" as tissue -> null). Organoids, cell lines, "cells", sort gates, donors, timepoints -> null.
   "fetal brain" -> brain (the stage is recorded elsewhere). Lavage/aspirate fluids map only if UBERON has the fluid.
5. cell_type_sorted: cell lines (K562, HEK293, 22RV1, H9...), disease names, tissue names, "Adult", "Tumor",
   populations named only by a gate ("Pop A") or by a negative marker alone ("CD45-") -> null. hESC/iPSC map to the
   stem cell terms if CL has them. Cancer cells -> null unless CL has that specific malignant cell type.
6. disease: "Cases", "infected", "Early", "Late", "Lean", "Obese", treatment arms, timepoints, "Donor", control and
   healthy-like values -> null (healthy is handled separately). A mouse model of a disease maps to the disease term.
   Ambiguous abbreviations (AD, CD, MS, PD) map only if every listed study makes the meaning certain.
7. ancestry: map to HANCESTRO ancestry categories; ethnicity-only values ("Not Hispanic or Latino"), "Other",
   "Mixed", lists of several donors -> null.
8. confidence: 0.8 when certain, 0.6-0.7 when the reading is clear but the term choice involved judgement. Do not
   output mappings you would rate below 0.6; output null instead.

Output: write one JSON object per input line, in input order, to your output file:
`{"attr": ..., "value_norm": <value exactly as given>, "term_id": "UBERON:0002116" | null, "label": <exact label> | null, "confidence": 0.8, "reason": "<= 15 words"}`
Every input line must have an output line (null when unmapped). Write the file with a script or heredoc; check that
the line count matches the batch and that every non-null term_id/label pair appears in the TSV.

# Model pass for sample facts (T5)

The deterministic pre-pass (`functions/_shared/attr-extract.ts`, run by `scripts/enrich/extract-attrs.ts`) writes
`sample_attr` rows with `source = 'geo'` for every explicit `key: value` pair it can read. This pass handles what it
leaves behind. Nothing here runs from this repository: the job script belongs in `singlet-agents/hpc/`, the prompt and
schema live here so they are reviewed with the code that validates them.

## Input

One JSONL file per study, `scripts/enrich/out/unplaced/<GSE>.jsonl`. The first line is the study, the rest are samples
that need a decision:

```json
{"type":"study","gse_id":"GSE102596","title":"...","organism":"Homo sapiens","abstract":"first 1,200 characters"}
{"type":"sample","gsm_id":"GSM2741551","title":"...","source":"human kidney cortex",
 "characteristics":"developmental stage: week 16 ;; tissue: kidney cortex","platform":"10x 3' v3 snRNA-seq",
 "have":{"tissue":"kidney cortex"},
 "unplaced":[{"attr":"life_stage","key":"developmental stage","value":"week 16"}],
 "unmapped_keys":["brain region"],"missing":["tissue"]}
```

- `have`: facts the rules already wrote for this sample. The model never rewrites them.
- `unplaced`: explicit values the rules kept verbatim or could not parse (a sex of "M/F pooled?", an age of "2 Yrs 11 Mos").
- `unmapped_keys`: characteristics keys no rule reads.
- `missing`: attributes worth asking about when the text may state them in the title or source (today: `tissue`).

Send one study per call: all of a study's samples together, so "WT" and "wild type" or "ctrl" and "control" come back
consistent. Cache the shared system prompt (Anthropic prompt caching). Use a Haiku-class model, temperature 0.

## System prompt

```
You extract structured facts about biological samples from GEO sample records. For each sample you are given its
title, source, characteristics string, the facts already extracted by rules (do not repeat or contradict them) and
the values the rules could not place.

Rules:
1. Report only what the text states. Do not use outside knowledge about the study, the paper or typical designs.
   If the text does not say it, omit the attribute. An empty "facts" list is a correct answer.
2. Every fact needs "evidence": a verbatim quote (a contiguous substring) from that sample's title, source or
   characteristics. Copy it exactly, including case and punctuation. Quote the shortest span that supports the fact.
3. Use only these attributes: tissue, sample_type, cell_type_sorted, disease, disease_state, treatment,
   treatment_status, timepoint, genotype, age, life_stage, sex, ancestry, donor.
4. value_norm is a short lowercase label in the vocabulary below. value_raw is the text as written.
   - sample_type: primary tissue | cell line | organoid | pdx | ipsc derived | sorted population | other
   - disease_state: case | control | unaffected tissue | unknown. "healthy" or "control" subjects are control.
   - treatment_status: untreated | treated | vehicle | unknown. Untreated means the text says so (naive, no treatment).
   - sex: male | female | mixed. Omit unknown.
   - life_stage: embryonic | fetal | neonatal | pediatric | adult | aged. Only when the text says it or gives an age
     with a unit and the organism is human (<18 y pediatric, 18-64 y adult, 65+ y aged).
   - age and timepoint: value_num is a number, unit one of years, months, weeks, days, hours, pcw, E-days. A range is
     its midpoint, and value_raw keeps the range. If the unit is not in the text, leave unit null; do not assume one.
   - disease, tissue, treatment, genotype, cell_type_sorted: the label as the text states it, expanded only where an
     abbreviation is defined in the same record. Keep specific names (kidney cortex, not kidney).
5. Controls: "control", "ctrl" or "healthy" under a disease key is disease "healthy". Under a treatment key it is not
   untreated unless the text says untreated, vehicle or mock; report treatment_status "unknown".
6. confidence is your probability the fact is right and supported by the quote: 0.9+ only for a direct statement,
   0.8 for a clear but compressed one (an abbreviation, a code defined elsewhere in the record), below 0.7 for anything
   you had to interpret. Do not report facts below 0.5.
7. Use the same label for the same thing across the study's samples ("wild type" everywhere, not WT and wildtype).
8. Never write about quality, failure, or whether a sample is usable.

Return JSON only, matching the schema.
```

## Output schema (JSON, one object per study)

```json
{
  "type": "object",
  "required": ["gse_id", "samples"],
  "properties": {
    "gse_id": { "type": "string" },
    "samples": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["gsm_id", "facts"],
        "properties": {
          "gsm_id": { "type": "string" },
          "facts": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["attr", "value_raw", "value_norm", "evidence", "confidence"],
              "properties": {
                "attr": { "enum": ["tissue","sample_type","cell_type_sorted","disease","disease_state","treatment","treatment_status","timepoint","genotype","age","life_stage","sex","ancestry","donor"] },
                "value_raw": { "type": "string" },
                "value_norm": { "type": "string" },
                "value_num": { "type": ["number", "null"] },
                "unit": { "type": ["string", "null"] },
                "evidence": { "type": "string", "minLength": 1 },
                "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
              },
              "additionalProperties": false
            }
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

## Validation before anything is posted

The job posts rows only after these checks, in this order; a failed row is dropped and counted, never repaired.

1. `evidence` is a substring of the sample's title, source or characteristics (whitespace collapsed). Use
   `evidenceHolds` from `functions/_shared/attr-extract.ts`.
2. `attr` is in the closed list and `value_norm` is in its vocabulary where one is given.
3. The `(gsm_id, attr)` pair has no `geo` row from the rules. A `model` row sits beside a `geo` row and never replaces it,
   so a model fact for an attribute the rules already filled is dropped.
4. `confidence >= 0.5`. Default search reads `model` rows at `>= 0.8` (SEARCH-ROADMAP 4.1).
5. Rows are written as `source = 'model'`, `extractor_version = '<model id>@<prompt hash>'`, to `/api/ingest/sample_attr`
   with the ingest token, never from a preview's request path.

## Measuring it (T5 validation)

- Precision and recall against `scripts/search-eval/golden-facts.json` once T4 lands: `geo` rows precision >= 0.95,
  recall >= 0.85; `model` rows precision >= 0.90 at confidence >= 0.8.
- Cost per study <= $0.01, measured on 100 studies before any wider run. The batch files hold only the leftover
  samples, so most studies are one short call or none.
- `scripts/enrich/sample-run/report.json` lists, per attribute, the 10 most common raw values the rules could not place.
  They are the first cases to read when reviewing the prompt, and good candidates for `scripts/ontology/overrides.tsv` (T8).

## What the rules already settle (so the model is not asked)

`sex` from M/F/male/female; `age` from numbers with units, ranges, "6-week-old", "2 Yrs 11 Mos", E/P stages, and a bare
number for human donors (years, confidence 0.75); `treatment` none and vehicle tokens; `disease` healthy tokens and a short
disease list; `tissue` from a lexicon of about 150 names, and from the source field when it names exactly one;
`cell line` as `sample_type`; `genotype` as written, with wild type normalised; `donor` as written.

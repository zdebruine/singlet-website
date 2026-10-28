# singlet.bio with Claude: API user guide

> How to give Claude access to the singlet.bio single-cell atlas through its public MCP server (https://singlet.bio/mcp): from Claude.ai or Claude Desktop as a connector, and from the Anthropic API with the MCP connector. Covers API keys, request shape, every tool and the order to call them, limits and costs, worked examples from real benchmark transcripts, and known pitfalls.

Human-readable version: https://singlet.bio/docs/claude-api
Site index for agents: https://singlet.bio/llms.txt
Last checked against the live server's `tools/list` and the Anthropic MCP connector docs: 2026-10-28.

## What the server is

- URL: `https://singlet.bio/mcp` (MCP, Streamable HTTP, stateless). Only tools are used; Claude's MCP connector supports tool calls only.
- Data: singlet.bio Research Alpha, public GEO single-cell RNA-seq studies reprocessed from raw reads with one pipeline, CC0. Each study is one immutable `.s1` object per sample plus a study manifest at `https://data.singlet.bio/s1/m/<GSE>.json`. Objects support HTTP Range.
- Per-cell labels: Cell Ontology cell type (every level of the call), chromosomal sex, genetic ancestry (HANCESTRO, human donors with enough covered sites). Sample metadata is mapped to UBERON tissue, MONDO disease (PATO:0000461 = normal), HsapDv/MmusDv stage and PATO sex.
- Live atlas size: call `get_atlas_stats`.
- Every number and every "why" string a tool returns is computed, not generated. Quote them; don't paraphrase.

## 1. Get an API key

1. Sign in at https://singlet.bio/account with GitHub or Google (free).
2. Under "API keys", choose "Create key". The key starts `sk_live_`. It is shown once; store it like a password (for example in `~/.singlet/api_key`, mode 600).
3. Send it as `Authorization: Bearer <key>`. With the Anthropic API it goes in `authorization_token` (below).

Without a key or a sign-in, `initialize` and every `tools/call` answer HTTP 401 `sign_in_required`; `tools/list` and `ping` stay open. Downloads from `data.singlet.bio` never need a key.

## 2. Connect

### Claude.ai, Claude Desktop, Claude mobile (connector)

Settings → Connectors → Add custom connector → URL `https://singlet.bio/mcp` → Connect → sign in to singlet.bio with GitHub or Google. No key to copy. Disconnect at https://singlet.bio/account#connectors. Other clients (Claude Code, Cursor, VS Code, ChatGPT): https://singlet.bio/docs/mcp

### Anthropic API (Python, MCP connector)

The Messages API calls the MCP server for you. Three parts:

- beta header `mcp-client-2025-11-20` (`betas=[...]` in the Python SDK, `client.beta.messages.create`);
- `mcp_servers`: one entry `{"type": "url", "url": "https://singlet.bio/mcp", "name": "singlet", "authorization_token": <singlet.bio API key>}`;
- an `mcp_toolset` in `tools` that names the server. Use `configs` to turn tools off. `save_cohort` is the only tool that writes (it saves a cohort to your account); disable it for a read-only agent.

```python
import os
import anthropic

client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY
SINGLET_KEY = open(os.path.expanduser("~/.singlet/api_key")).read().strip()

MCP = dict(
    betas=["mcp-client-2025-11-20"],
    mcp_servers=[{
        "type": "url",
        "url": "https://singlet.bio/mcp",
        "name": "singlet",
        "authorization_token": SINGLET_KEY,
    }],
    tools=[{
        "type": "mcp_toolset",
        "mcp_server_name": "singlet",
        "configs": {"save_cohort": {"enabled": False}},  # the one write tool
    }],
)

messages = [{"role": "user", "content": "How many called cells does GSE270225 contain in the Singlet atlas?"}]
while True:
    r = client.beta.messages.create(model="claude-opus-5-5", max_tokens=16000, messages=messages, **MCP)
    messages.append({"role": "assistant", "content": r.content})
    for b in r.content:
        if b.type == "mcp_tool_use":
            print("tool:", b.name, b.input)
    if r.stop_reason != "pause_turn":  # a long server-side tool loop can pause; send the turn back to continue
        break
print(next(b.text for b in reversed(r.content) if b.type == "text"))
```

Notes:

- Allowlist instead of denylist: `"default_config": {"enabled": False}, "configs": {"search_cells": {"enabled": True}, ...}`.
- Responses carry `mcp_tool_use` blocks (`id`, `name`, `server_name`, `input`) and `mcp_tool_result` blocks (`tool_use_id`, `is_error`, `content`). Only the `content` text reaches Claude, not the server's `structuredContent` (see Pitfalls).
- MCP tools run on Anthropic's side; you can add your own client tools (for example a Python sandbox) in the same `tools` list and run them in the usual tool-use loop.
- The toolset accepts `cache_control`; with the tool list cached, repeated questions cost less.
- Anthropic also documents a newer beta header, `mcp-client-2026-09-15`, that includes everything in `mcp-client-2025-11-20` and adds pinning of a server's tool list. The examples below ran with `mcp-client-2025-11-20`.
- Reference: https://platform.claude.com/docs/en/agents-and-tools/mcp-connector

## 3. The tools and the order to call them

Studies:
`search_datasets` → `assess_study` or `get_study` → `get_sample_qc` → `get_modalities` → `get_download_url` (whole study) or `get_partial_download` (one sample's matrix by HTTP Range) → `export_manifest` for a cohort. `find_matched_controls` and `compare_studies` help pick controls.

Cells:
`search_cells` (count and locate cells atlas-wide) → `get_cells_page` (the cells and the byte ranges of their matrix chunks) or `find_cells` (cells in named samples by statistics and labels) → `slice_cells` (byte ranges for some cells of one sample) → `resolve_features` (matrix row numbers to gene names).

| Tool | Use it for | Main inputs |
|---|---|---|
| search_datasets | Find studies (or samples) from plain English or a GEO accession; filters by organism, tissue, disease, assay, cell type and by the per-cell labels `cell_type_label`, `sex_genetic`, `ancestry_genetic` | query*, level, limit (≤50), page, organism, tissue, disease, assay, min_cells, sex_genetic, ancestry_genetic, cell_type_label, include_unbuilt, include_low_qc |
| get_study | Everything about one study: title, abstract, groups, conditions, first 60 samples, completeness, loaders | gse_id*, known_rev |
| assess_study | Deterministic usability report; with `purpose`, fit checks (e.g. velocity, aging) | gse_id*, purpose |
| get_sample_qc | Per-sample QC read from the files: cells called, median UMI and genes, mapping, mito, input reads | gse_id*, gsm_ids, known_rev |
| get_modalities | What the file carries beyond gene counts, with Python and R readers. Check before promising a modality | gse_id*, gsm_id, modalities |
| list_bundle_files | Every member of every sample object, with sizes and byte ranges | gse_id*, gsm_id, detail, modalities, limit (≤500), after |
| get_download_url | The study manifest URL, size and loaders; optionally the sample objects | gse_id*, include_samples, modalities, limit (≤200), after |
| get_partial_download | Byte range, curl and Python for one member of one sample | gse_id*, gsm_id*, file, modalities |
| export_manifest | TSV, JSON, curl, wget, Python or R manifest for up to 2,000 studies | query / filters / gse_ids, format* |
| find_matched_controls | Candidate control studies: same organism and tissue group, no disease label, with a `why` and caveats | gse_id*, min_samples, same_assay |
| compare_studies | 2–8 studies side by side plus a `differences` list | gse_ids* |
| get_atlas_stats | Live atlas size (studies, usable samples, cells in published files) | — |
| search_cells | Count and locate cells across the atlas by cell type, sex, ancestry, UMIs, genes, tissue, disease, stage, age, assay, study … AND/OR/NOT; ontology terms match descendants | where or question, include_low_qc, limit (≤200), offset |
| get_cells_page | One page (≤10,000 cells, ≤10 studies) of the cells a `search_cells` filter matches, with matrix byte ranges and a one-POST gather body | where or question, page_cells, cursor, modalities |
| find_cells | Cells in chosen samples by per-cell statistics and labels, as [start, length] column runs | gse_ids / gsm_ids / sample_filter, cell_filter, cell_labels, limit_samples (≤25), max_runs_per_sample, after |
| slice_cells | Byte ranges to read only some cells of one sample's matrices (a prefix once, then chunk runs) | gse_id*, gsm_id*, runs / indices / range, file or modalities, max_ranges (≤200) |
| resolve_features | Matrix row numbers to feature names (or column numbers to barcodes), up to 500 | indices*, pack or gse_id + gsm_id + file, axis |
| get_cohort | A saved, version-pinned cohort | id*, token |
| save_cohort | Save up to 2,000 studies as a cohort on your account. The only write tool | name*, gse_ids*, notes, visibility, workspace_id |

`*` = required. Answers about a study carry a `rev`; send it back as `known_rev` to get `{unchanged: true}` instead of the same answer again.

`search_cells` `where` fields: per cell `cell_type` (CL), `sex` (PATO), `ancestry` (HANCESTRO), `n_umi`, `n_genes`; per sample `tissue` (UBERON), `disease` (MONDO/PATO), `development_stage`, `age_years`, `donor_sex`, `donor_ancestry`, `sorted_cell_type`, `organism`, `assay`, `chemistry`, `tissue_group`, `disease_group`, `donor_status`, `perturbation`, `sample_kind`, `median_umi`, `median_genes`, `mito_fraction`, `cells_called`, `mapping_rate`, `qc`, `sample`; per study `study`, `year`, `has_publication`. Flat form: `{"cell_type": "T cell", "sex": "female", "tissue": ["lung"], "not": {"disease": "cancer"}}` (fields AND-ed, list values OR-ed). Tree form: `{"and": [...]}`, `{"or": [...]}`, `{"not": {...}}`, `{"field": "cell_type", "any": ["CL:0000084"], "exact": false}`. Ids and labels both work.

## 4. Limits and costs

- singlet.bio does not charge for tool calls. Calls are counted per account and limited to 60 MCP calls a minute per key; there is no daily or monthly cap on calls.
- AI allowance: only plain-English readings that the built-in vocabulary cannot place call a language model (`search_datasets`, and `question` in `search_cells` / `get_cells_page`). Those count against 200 AI readings a day per account (reset 00:00 UTC) and a monthly AI token allowance. Every result reports the monthly allowance in `_meta.quota` (`used`, `limit`, `remaining`, `resets_at`). When either is used up the question is still answered from the vocabulary alone and the answer says `quota_exceeded: true`. Structured filters (`where`, ids) never use the allowance.
- Per-call caps: `find_cells` reads at most 25 samples and 40 reads of the data host per call (continue with `after`); `slice_cells` takes up to 50,000 indices or 2,000 runs and joins chunk runs to at most `max_ranges` (default 64, ≤200); `get_cells_page` returns ≤10,000 cells and ≤10 studies a page (continue with `cursor`); `search_cells` lists ≤200 rows; `export_manifest` and `save_cohort` take ≤2,000 studies; `resolve_features` ≤500 numbers.
- Downloads from `data.singlet.bio` need no account. The cell gather endpoint has a per-day cell allowance (2 M cells a day with an API key in `Authorization`; a smaller anonymous one).
- Your Anthropic bill: the tool list is about 19 tool definitions, written to the prompt cache on the first turn. In the benchmark pilot below (claude-opus-5-5, effort medium) a question cost $0.08–$0.15 with the MCP server, $0.63 for all six.

## 5. Worked examples (real benchmark transcripts)

Source: singlet-agents `bench/agent-readiness`, pilot of 2026-10-28, model `claude-opus-5-5`, effort medium, MCP connector as above with `save_cohort` disabled, plus a `run_python` tool with network access to `data.singlet.bio`. Tool calls and results below are copied from the transcripts. All six answers were graded correct.

| Arm | Correct | Spend | Median latency | Tool calls / question |
|---|---|---|---|---|
| no tools | 0/6 | $0.07 | 9 s | 0 |
| raw files + Python | 3/6 | $1.57 | 109 s | 12 |
| MCP + raw files + Python | 6/6 | $0.63 | 72 s | 3 |

### Example 1: atlas-wide ontology cell count (search_cells)

Question: How many cells labelled T cell (CL:0000084, including subtypes) are there from samples of lung tissue (or any part of the lung) from donors with cancer whose cells the atlas labels chromosomally male?

```json
search_cells {"where": {"cell_type": "CL:0000084", "tissue": ["UBERON:0002048"], "disease": "MONDO:0004992", "sex": "male"}, "limit": 5}
→ 18,496 cells in 9 samples of 2 studies. Most: GSE144945 (13,931), GSE198896 (4,565).
```

The agent re-ran it with labels (`"cell_type": "T cell", "tissue": ["lung"], "disease": "cancer"`) and with `"disease_group": "Cancer"`; all three gave 18,496. Answer 18496, correct. 3 tool calls, 37 s, $0.09. Without the MCP server the same agent spent 26 tool calls and $0.59 on the raw files, hit the 15-minute deadline and never answered: it could not tell which samples are lung tumour.

### Example 2: one cell type in one study (search_cells, checked in Python)

Question: How many called cells in GSE200253 are labelled CD8-positive, alpha-beta T cell (CL:0000625), including its subtypes?

```json
search_cells {"where": {"study": "GSE200253", "cell_type": "CL:0000625"}, "limit": 5}
→ 2,626 cells in 6 samples of 1 studies. Most: GSE200253 (2,626).
```

The agent then counted from each sample's cells table in Python (called cells whose `cell_type_path` contains CL:0000625): 896 + 187 + 323 + 418 + 427 + 375 = 2626. Correct. 4 tool calls, $0.11.

### Example 3: matched controls (find_matched_controls)

Question: GSE299340 is a human Liver study (Cancer). Propose 3 to 5 candidate control studies: same organism, same tissue group, no disease label other than healthy/control.

```json
find_matched_controls {"gse_id": "GSE299340"}
→ 10 candidate control studies for GSE299340 (Human, Liver).
- GSE299043 — Multimodal profiling reveals tissue-directed signatures of human immune cells altered with age
  why: same organism (Human), tissue Liver, assay 10x 3', same reference GRCh38-2024-A, 310 samples in file, no disease label
- GSE206325 — Intratumoral mregDC and Tfh-like niches enable local reinvigoration of CD8 T cells following PD-1 blockade
  why: same organism (Human), tissue Liver, assay 10x 3', same reference GRCh38-2024-A, 195 samples in file, no disease label
…
```

The agent read the titles and proposed GSE299043, GSE223581, GSE194189 and GSE168933. It left out six candidates whose titles suggest diseased tissue although the catalog gives them no disease label (GSE206325, GSE203608 and GSE306201 are tumour studies, GSE289173 is MASH). Correct, 1 tool call, 19 s, $0.10. The lesson: a missing disease label is not proof of healthy tissue; read the titles or `get_study`.

### Example 4: the cells of one type in one sample, then slice them (Python + slice_cells)

Question: List the matrix column indices (0-based) of the called cells in sample GSM7518425 (study GSE236111) whose cell-type label is exactly 'endothelial cell of artery'.

The agent read the sample's cells table straight from its `.s1` object with one Range request:

```python
import requests
from singlet.s1 import cells
m = requests.get("https://data.singlet.bio/s1/m/GSE236111.json").json()
s = [x for x in m['samples'] if x['gsm'] == 'GSM7518425'][0]
url = "https://data.singlet.bio/" + s['key']; c = s['members']['cells']
blob = requests.get(url, headers={"Range": f"bytes={c['off']}-{c['off']+c['len']-1}"}).content
r = cells.CellsReader(lambda o, l: blob[o:o+l], len(blob))
called = list(r.column('called')); lab = list(r.column('cell_type_label'))
idx = [i for i in range(r.n_rows) if called[i] and lab[i] == 'endothelial cell of artery']
# → 2886 called cells; idx = [395, 461, 474, 565, 730, 745, 755, 856, 1117, 1238, 1274, 1526, 1827, 2016,
#    2058, 2060, 2408, 2422, 2469, 2475, 2790, 2944, 3101, 3205]
```

Correct, $0.10. The agent noted that 'endothelial cell of artery' is a cell-type-level label (per-study accuracy about 0.43), so a preview.

Next step, to fetch only those 24 cells' counts. This call was made live while writing this guide (2026-10-28), not in the benchmark:

```json
slice_cells {"gse_id": "GSE236111", "gsm_id": "GSM7518425", "indices": [395, 461, …, 3205]}
→ url https://data.singlet.bio/s1/s/GSM7518425/583976d2030e045f23a69fbe5c3484bf.s1 (immutable)
  exon_counts.1pz:   prefix bytes=690304-787629 (97,326 B) + 13 chunk ranges (707,258 B); 19 of 129 chunks; member 3,647,846 B
  intron_counts.1pz: prefix bytes=4338176-4405511 (67,336 B) + 1 chunk range (247,132 B); 4 of 20 chunks; member 706,561 B
```

GET the prefix once and the chunk ranges with a Range header on `url`; the chunks decode independently. `singlet.load(gse, samples=[gsm])` does this for you. Row numbers → gene names: `resolve_features` with the `pack` id the result names.

### Example 5: MCP to find the samples, Python on the .s1 files to rank them

Question: Among the atlas samples of lung tissue from donors with cancer, which sample contains the most CD8-positive, alpha-beta T cells (CL:0000625, including subtypes)?

```json
search_cells {"where": {"cell_type": "CL:0000625", "tissue": ["UBERON:0002048"], "disease": "MONDO:0004992"}, "limit": 5}
→ 14,435 cells in 15 samples of 3 studies. Most: GSE144945 (12,022), GSE198896 (2,396), GSE184242 (17).
find_cells {"gse_ids": ["GSE144945"], "cell_labels": {"cell_type": ["CL:0000625"]}, "limit_samples": 25, "max_runs_per_sample": 1}
→ 12,022 cells match in 10 of 10 samples scanned (10 reads of the data host).
```

The text did not list samples (see Pitfall 1), so the agent counted per sample in Python, reading only each sample's cells table:

```python
import requests
from singlet.s1 import cells
for g in ["GSE144945", "GSE198896", "GSE184242"]:
    m = requests.get(f"https://data.singlet.bio/s1/m/{g}.json").json()
    for s in m["samples"]:
        mem = s["members"]["cells"]; off = mem["off"]; url = "https://data.singlet.bio/" + s["key"]
        def fetch(o, l, off=off, url=url):
            return requests.get(url, headers={"Range": f"bytes={off+o}-{off+o+l-1}"}).content
        r = cells.CellsReader(fetch, mem["len"])
        called = r.column("called"); path = r.column("cell_type_path")
        n = sum(1 for c, p in zip(called, path) if c and p is not None and "CL:0000625" in str(p))
        print(g, s["gsm"], n)
# GSE144945 GSM4301254 2283   (top; GSM4301255 2071, GSM4301258 1590; the ten GSE144945 samples sum to 12,022)
```

Answer GSM4301254, correct. 7 tool calls, 212 s, $0.15. A shorter path: the same filter on `GET https://singlet.bio/api/cells` returns the sample list directly (first row `{"gsm_id": "GSM4301254", "gse_id": "GSE144945", "cells": 2283}`).

### Example 6: a study's cell total (get_sample_qc)

Question: How many called cells does GSE270225 contain in total?

```json
get_sample_qc {"gse_id": "GSE270225"}
→ GSE270225 — per-sample QC for 6 samples (read from the .singlet file itself).
  Totals: 36,857 cells called · median 514 UMI and 381.5 genes per cell · 80.71% uniquely mapped · reference GRCh38-2024-A · 10xv3.
```

Answer 36857, correct. 1 tool call, 33 s, $0.08.

<!-- SHOWCASE-EXAMPLES: more worked examples from the 10-question showcase panel (singlet-agents) go here.
     Same rules: copy real tool calls and real results from the transcripts; never invent numbers. -->
### More examples: showcase panel

To be added from the 10-question showcase panel (singlet-agents). Not yet published.

## 6. Pitfalls

1. **search_cells' lists are in `structuredContent`; Claude through the API connector sees only the text.** The text is one summary line ("14,435 cells in 15 samples of 3 studies. Most: …"). The per-sample list, the facet breakdowns and the matched descendant terms are in `structuredContent`, which the Anthropic MCP connector does not pass on. In Example 5 the agent called `search_cells` three times looking for the sample list. Workarounds: give the agent a Python tool and the HTTP endpoint `GET|POST https://singlet.bio/api/cells` (same `where`, `limit`, `offset`; returns the full JSON, no key needed); or use `find_cells` per study; or `get_cells_page`. Clients that read `structuredContent` (an MCP SDK of your own) get the lists directly.
2. **Catalog metadata has gaps, and they look like wrong answers.** Disease and tissue are study- or sample-level labels from GEO text mapped to ontologies. In the pilot, five healthy-donor liver studies (GSE286615, GSE286728, GSE286734, GSE286744, GSE286853) are served but have no tissue group, so `find_matched_controls` does not offer them; and GSM5608037, a lung-cancer tumour sample whose metadata never says "lung", is outside an ontology lung cohort. A missing label is not a negative: read `get_study` or GEO before excluding or including. Conversely, "no disease label" does not mean healthy (Example 3).
3. **Cell-type labels below lineage level are previews.** Per-study accuracy: compartment 0.84, lineage 0.75, cell type 0.43, subtype 0.32. Counts of a lineage (T cell, B cell, myeloid) are solid; counts of e.g. 'endothelial cell of artery' or effector memory CD8 T cells are estimates. Prefer the broadest CL term that answers the question; ontology filters include descendants.
4. **The file is the truth.** Catalog cell counts can differ from a file's own QC; `get_sample_qc` reads the file.
5. **Low-QC samples are left out by default.** Pass `include_low_qc: true` only if you mean it.
6. **Check modalities.** Alpha serves gene counts (spliced and unspliced), junctions and exon inclusion, cell calls, QC and labels. Genotypes, mitochondrial allele data, ambient-RNA and doublet calls are not offered. Call `get_modalities` before promising one.

## License and citation

Data CC0 1.0; code MIT. Cite the original GEO study and "Singlet Research Alpha (October 2026)". Support: https://github.com/Singlet-Bio/singlet/issues

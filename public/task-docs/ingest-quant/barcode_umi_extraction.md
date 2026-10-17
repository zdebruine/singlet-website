---
id: ingest-quant.barcode_umi_extraction
title: Cell barcode and UMI extraction from raw reads
area: ingest-quant
scope: core
paradigm: hybrid
literature_status: routine
priority: P0
depends_on: [ingest-quant.chemistry_detection]
feeds: [ingest-quant.barcode_whitelist_correction, ingest-quant.read_to_gene_mapping, ingest-quant.umi_deduplication, ingest-quant.feature_barcode_counting]
reads: []
writes: [uns/ingest_parse_summary, uns/ingest_geometry]
devices: [cpu, cuda]
mcp_tool: singlet_ingest_quant_barcode_umi_extraction
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Cell barcode and UMI extraction from raw reads

> Splits each raw read pair into a cell barcode, a UMI and a cDNA read under one declared protocol layout, assigns every read that does not fit the layout to a named failure class, and reports a layout-match diagnostic so that a wrong layout cannot go unnoticed.

## 1. Question

Given raw R1 and R2 FASTQ files and a declared layout (a registry key or explicit 1-based spans), which bases of each read pair form the cell barcode (CB), the unique molecular identifier (UMI) and the cDNA, and which pairs cannot be parsed under that layout? The output is a per-read parse stream (CB and UMI strings with base qualities, cDNA read identifier, status, failure class, whitelist diagnostics) and per-class read counts. A correct answer returns the spans exactly as sequenced, assigns each pair to exactly one class, and never reports a pair as parsed when a declared field falls outside the read. Real libraries carry no label for the true layout, so correctness is established on planted simulations (section 8).

## 2. Why this task matters and where the field stands

Every droplet and split-pool UMI workflow starts here. Cell Ranger [R1], STARsolo [R2][R3], kb-python with bustools [R4][R5], alevin-fry with simpleaf [R6][R7], UMI-tools extract [R8] and zUMIs [R9] read the barcode and UMI from declared positions before counting, and whitelist correction, UMI collapsing and cell calling inherit any error made here.

The status is **routine**: for a known protocol the parse is a configuration, not a fitted model. Four points remain unsettled.

1. **Policy.** Tools differ on N bases, short reads, adapter mismatches and orientation. By default STARsolo aborts the run when the barcode read length differs from CB plus UMI length, and it discards UMIs with N and homopolymer UMIs; singlet classifies each read instead. Such choices change counts without changing the parse and must be reported separately.
2. **Layout registries.** The geometry of each chemistry is spread over tool definitions, vendor files and community repositories. For 5' chemistries the sources place the start of the cDNA at different offsets (section 4 defaults, section 10).
3. **Protocols beyond fixed layouts.** Split-pool and inDrop-style barcodes need variable-length, adapter-anchored matching. STARsolo's CB_UMI_Complex covers them on read 2 only, and no published parse-level benchmark for them is cited here.
4. **Layout confidence.** STARsolo keeps library-level counts of exact and one-mismatch whitelist matches; none of the tool documentation in section 4 describes a per-read confidence that the declared layout is right.

Published comparisons are end to end: You et al. benchmark UMI-based preprocessing workflows [R10] and Brüning et al. compare alignment tools [R11]. The best-practices chapter summarises the latter as STARsolo being much faster than Cell Ranger, using less memory and giving almost identical results [R13]. Neither isolates the parse step, so this task is validated by planted simulation.

## 3. Theory and insight

**Notation.** $N_r$ read pairs; $r^{(1)},r^{(2)}$ the two reads over $\{A,C,G,T,N\}$; $[s_c,e_c)$ and $[s_u,e_u)$ the 0-based half-open CB and UMI spans in $r^{(1)}$; $L=e_c-s_c$, $u=e_u-s_u$; $W$ the barcode whitelist, $\lvert W\rvert$ its size; $o$ an observed CB, $w\in W$; $d_H$ Hamming distance and $\mathcal N_k(o)=\{w\in W:d_H(o,w)\le k\}$; $q_i$ Phred quality and $\epsilon_i=10^{-q_i/10}$; $\pi_w$ a prior on whitelist entries and $\pi_c$ the prior that the declared layout is correct.

### 3.1 Deterministic extraction and the parse predicate

Under a declared layout extraction is slicing: $\mathrm{CB}=r^{(1)}_{[s_c,e_c)}$, $\mathrm{UMI}=r^{(1)}_{[s_u,e_u)}$, and cDNA is $r^{(2)}$ (or the remainder of $r^{(1)}$ when `cdna_read` equals `cb_read`). A 1-based start $a$ and length $\ell$ give $s=a-1$, $e=s+\ell$, the conversion STARsolo applies. A fixed adapter of length $a_\ell$ after the UMI occupies $[e_u,e_u+a_\ell)$, so the required length of $r^{(1)}$ is $\mathrm{req}=\max(e_c,e_u,e_u+a_\ell)$, the last term only when an adapter is declared. A pair is assigned to the first failing class of this list, otherwise to `ok`:

1. `r1_too_short`: $\lvert r^{(1)}\rvert<\mathrm{req}$;
2. `length_mismatch`: exact length is required, cDNA is on read 2, and $\lvert r^{(1)}\rvert\ne\mathrm{req}$;
3. `N_in_cb`; 4. `N_in_umi`: an N in the field while the policy excludes N;
5. `adapter_mismatch`: $d_H$ to the declared adapter exceeds $\delta$ (an N counts as a mismatch);
6. `cdna_empty`: the cDNA has zero bases.

The first-failure precedence makes the classes a partition, so the counts sum to $N_r$ and the failure rates are interpretable. The estimand of every count is the number of read pairs in the class. *Regime of validity:* slicing is correct when every read follows the declared layout with fixed cycle counts and no indel inside a declared field. An indel in the CB shifts the UMI and the slicing cannot detect it; only the whitelist diagnostic below can.

### 3.2 Whitelist statistics for a mis-sliced barcode

For a uniformly random string $o$ of length $L$, each whitelist entry lies at distance exactly 1 with probability $3L/4^{L}$, so by linearity, for any list,
$$
\lambda=\mathbb E\,\lvert\mathcal N_1(o)\setminus\{o\}\rvert=\frac{3L\,\lvert W\rvert}{4^{L}},\qquad \Pr[o\in W]=\frac{\lvert W\rvert}{4^{L}},\qquad \Pr[\lvert\mathcal N_1(o)\setminus\{o\}\rvert\ge1]\le\lambda .
$$
The approximation $1-e^{-\lambda}$ for the last probability needs Poisson-distributed neighbour counts, which holds only for unstructured lists. The 10x v3 list 3M-february-2018 has $\lvert W\rvert=6{,}794{,}880$ entries of $L=16$ (file `chemistries/whitelists/3M-february-2018.csv.gz` in Teichlab/scg_lib_structs), so $\lvert W\rvert/4^{L}=0.00158$ and $\lambda=0.0759$. Computed on that file:

| Quantity (estimand) | Uniform model | Computed on the list |
|---|---|---|
| mean number of list members at $d_H=1$ from a uniform random 16-mer ($2\times10^{6}$ draws) | 0.0759 | 0.0747 |
| probability that such a 16-mer has at least one member at $d_H=1$ | $\le0.0759$ (Poisson: 0.0731) | 0.0350 |
| list members with at least one other member at $d_H=1$ (300,000 sampled) | about 0.07 | 0.469 (mean 0.949 neighbours) |
| a list barcode mutated at one position to a non-member has at least two members at $d_H=1$ (about $9.4\times10^{5}$ mutants of 20,000 sampled barcodes) | about 0.07 | 0.810 |

The last row reproduces the roughly 81 percent quoted in the best-practices chapter [R13]. The list is therefore strongly clustered: the expected neighbour count for random strings matches the uniform formula, but neighbour counts are overdispersed, and for barcodes derived from the list by a sequencing error the uniform model understates ambiguity by an order of magnitude. Two consequences follow. A mis-sliced CB is a poor list member (0.16 percent exact, 3.5 percent within one substitution for random strings), so the diagnostic works. And a single-error barcode usually has several list candidates, which is why quality-aware choice among candidates matters (section 3.3). Only the v3 list was computed; shifted barcodes reuse 15 true barcode bases and need not behave like random strings (B2).

### 3.3 Quality-aware barcode posterior and per-read layout confidence

Two model-based quantities are reported beside the parse. With independent substitution errors, uniform over the three alternative bases, and calibrated Phred scores,
$$
P(o\mid w)=\prod_{i=1}^{L}\begin{cases}1-\epsilon_i & o_i=w_i\\ \epsilon_i/3 & o_i\ne w_i\end{cases},\qquad
P(w\mid o)=\frac{P(o\mid w)\,\pi_w}{\sum_{w'\in\mathcal N_1(o)}P(o\mid w')\,\pi_{w'}} .
$$
For two candidates differing from $o$ at one base each, at $i$ for $w$ and $j$ for $w'$, with a uniform prior, $P(o\mid w)/P(o\mid w')=\epsilon_i(1-\epsilon_j)/\bigl(\epsilon_j(1-\epsilon_i)\bigr)$: the candidate whose mismatch sits at the less reliable base wins, whereas a hard distance-1 rule can only break ties arbitrarily. In log space each candidate costs $O(1)$: $\log P(o\mid w)=\sum_i\log(1-\epsilon_i)+\sum_{i:w_i\ne o_i}[\log(\epsilon_i/3)-\log(1-\epsilon_i)]$.

The layout confidence compares the observed CB under the declared layout (a whitelist barcode with errors) with a uniform background $4^{-L}$:
$$
\rho=\frac{\pi_c\,P_c(o)}{\pi_c\,P_c(o)+(1-\pi_c)\,4^{-L}},\qquad P_c(o)=\sum_{w\in\mathcal N_d(o)}\pi_w\,P(o\mid w).
$$
$\rho$ is the posterior probability that the read follows the declared layout given its CB string and qualities, under the stated priors; it is not the probability that the barcode belongs to a real cell. With $d=1$ reads with two errors receive too little confidence; $d=2$ enumerates $3L+9\binom{L}{2}=1128$ strings for $L=16$. The UMI does not enter, because a uniform UMI has the same distribution under both hypotheses. For an exact match with reliable bases and uniform $\pi_w=1/\lvert W\rvert$, $\rho\approx1/(1+\lvert W\rvert/4^{L})=0.998$ at $\pi_c=1/2$ for the v3 list. *Regime of validity:* the whitelist contains the library's barcodes, background barcodes are close to uniform, errors are independent and Phred scores are calibrated. An incomplete list drives $\rho$ towards zero for real cells, and low-complexity background strings violate the uniform background. Hence $\rho$ is a diagnostic, not a filter.

### 3.4 UMI collisions passed downstream

For $M$ distinct molecules of one gene in one cell with uniform $u$-base UMIs, the expected fraction of molecules lost to collisions is $(M-1)/(2\cdot4^{u})$ to first order, valid for $M\ll4^{u}$ and error-free UMIs. For $u=12$ it is $3\times10^{-5}$ at $M=10^{3}$ and $3\times10^{-4}$ at $M=10^{4}$. Real UMIs are not uniform, so this is a lower bound. The parser must report $u$ exactly, since an error of $\Delta u$ bases changes the collision rate by a factor $4^{\Delta u}$.

### 3.5 Why the heuristic works, and what the model adds

Fixed-offset extraction is exact when the layout is right and blind when it is wrong. The whitelist adds a check, strong for 16-mer lists by section 3.2. The model adds a calibrated per-read confidence, a principled choice among near-equal candidates, and a layout-level statistic (the mean of $\rho$) that chemistry detection can use. It cannot repair a wrong layout, only report it.

### 3.6 Pitfalls shown by tool behaviour

- **Coordinates.** STAR's `soloCBstart` and `soloUMIstart` are 1-based while array slicing is 0-based; mixing them shifts every field by one base.
- **Silent defaults.** STAR's default UMI length is 10, the v2 length, and v3 needs 12; a v3 library parsed with the default misreads its UMI without error.
- **Length rule.** STAR requires the barcode read to equal CB plus UMI length and aborts otherwise (defaults table), so a planted short read cannot pass through it in one run.
- **Summary metrics differ.** STAR's "Reads With Valid Barcodes" is computed after barcode matching, so it is not a parse count.
- **Matching options change assignments.** 1MM_multi chooses among whitelist matches by posterior; the N-base variants change the result, so every comparison must state the option.
- **Index hopping** changes sample assignment, not R1 parsing [R12].

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Cell Ranger | heuristic | Per-chemistry table of read type, offset and length for barcode, UMI and cDNA plus the whitelist name (`chemistry_defs.json`); source published for information only | [R1] |
| STARsolo | hybrid | `CB_UMI_Simple` slices one fixed-length CB and one UMI from the barcode read; `CB_UMI_Complex` allows several variable-length CBs and adapters on read 2; `1MM_multi` picks among whitelist matches by posterior | [R2][R3] |
| kb count | heuristic | The `-x` technology name is passed to `kallisto bus`, which writes BUS records; bustools then corrects barcodes and collapses UMIs | [R4][R5] |
| alevin-fry with simpleaf | heuristic | simpleaf takes a chemistry name or a geometry string for barcode, UMI and mappable read (`1{b[16]u[12]x:}2{r:}` for 10x v3); alevin-fry consumes RAD files from piscem or salmon alevin to build permit lists, collate and quantify | [R6][R7] |
| UMI-tools extract | heuristic | String or regex pattern extracts the UMI and optionally the cell barcode into the read name, with optional whitelist filtering and UMI-base quality filtering | [R8] |
| zUMIs | heuristic | YAML `base_definition` lists `BC`, `UMI` and `cDNA` ranges per input file (one to four files), base-quality filters for BC and UMI, then STAR mapping | [R9] |

Cell Ranger is the vendor standard for 10x data, and the chapter reports STARsolo as matching it closely [R13]. All six methods share one assumption, a layout declared before counting, and differ in policy defaults, in how the layout is written, and in whether a length mismatch aborts or is classified.

Exact defaults and behaviours (STAR parameters are in `source/parametersDefault`; the reading code is `source/SoloReadBarcode_getCBandUMI.cpp`):

| Method | Parameter | Value | Source (file:line @ sha, or key) |
|---|---|---|---|
| STARsolo | `soloType` | None | parametersDefault:771 @ b1edc12 |
| STARsolo | `soloCBwhitelist` | none (all barcodes allowed) | parametersDefault:783-785 @ b1edc12 |
| STARsolo | `soloCBstart`, `soloCBlen` | 1, 16 | parametersDefault:787, 790 @ b1edc12 |
| STARsolo | `soloUMIstart`, `soloUMIlen` | 17, 10 (v3 needs 12) | parametersDefault:793, 796 @ b1edc12; docs/STARsolo.md:71-73 |
| STARsolo | `soloBarcodeReadLength` | 1 (must equal CB plus UMI length) | parametersDefault:799-802 @ b1edc12 |
| STARsolo | length violation | fatal error, run aborts; with `soloBarcodeReadLength` 0 no check and a short barcode read is padded with N | SoloReadBarcode_getCBandUMI.cpp:228-238 @ b1edc12 |
| STARsolo | `soloBarcodeMate` | 0 (barcode on a separate read) | parametersDefault:804-808 @ b1edc12 |
| STARsolo | `soloAdapterSequence`, `soloAdapterMismatchesNmax` | none, 1 | parametersDefault:825, 828 @ b1edc12 |
| STARsolo | `soloCBmatchWLtype` | `1MM_multi` (posterior among matches) | parametersDefault:831-840 @ b1edc12 |
| STARsolo | `soloUMIfiltering` | `-`: remove UMIs with N and homopolymers | parametersDefault:886-889 @ b1edc12 |
| STARsolo | maximum `soloCBlen` | 31 | ParametersSolo.cpp:56 @ b1edc12 |
| STARsolo | 5' example | CB 16, UMI 10, adapter 13 (39 bases), `--clip5pNbases 39 0` | docs/STARsolo.md:152-155 @ b1edc12 |
| Cell Ranger | `SC3Pv2` | CB R1 offset 0 length 16; UMI R1 offset 16 length 10; list 737K-august-2016 | chemistry_defs.json key SC3Pv2 @ 669395e |
| Cell Ranger | `SC3Pv3-polyA` | CB R1 offset 0 length 16; UMI R1 offset 16 length 12; list 3M-february-2018_TRU | chemistry_defs.json key SC3Pv3-polyA @ 669395e |
| Cell Ranger | `SC5P-PE`, `SC5P-R1` | UMI 10 at offset 16; cDNA on R1 from offset 26 (`SC5P-PE`) or 41 (`SC5P-R1`) | chemistry_defs.json @ 669395e |
| simpleaf | `10xv2`, `10xv3` geometry | `1{b[16]u[10]x:}2{r:}`, `1{b[16]u[12]x:}2{r:}` | resources/chemistries.json @ 6abee7e |
| kb-python | technology list; `10XV4` | 10XV4 is passed to kallisto as 10XV3 | kb_python/config.py:118-177; count.py:184-188 @ 188d9c7 |
| zUMIs | `BC_filter`, `UMI_filter` | `num_bases` 1, `phred` 20 | zUMIs.yaml:51-57 @ 2039a90 |

## 5. Proposed singlet approach

- **Routes** (licences in section 12). STARsolo: port the slicing, N and UMI rules and the one-mismatch whitelist semantics, keeping the notice; it is a comparator in B1. Cell Ranger: callout; its layout table supplies facts for singlet's own registry, no file is copied. kb count, alevin-fry with simpleaf, UMI-tools extract: callout comparators. bustools: callout, format reference. zUMIs: reimplement only the multi-range `base_definition` idea. scg_lib_structs: reimplement the registry from geometry facts.
- **Model-based formulation.** The parse stays deterministic because a declared layout has no free parameters. The model content is the layout confidence $\rho$ and the quality-weighted posterior (section 3.3), each with a falsifier in B2: $\rho$ must be calibrated on a planted mixture and separate in-layout from shifted reads better than the hard indicator $\mathbb 1[o\in\mathcal N_1(W)]$; the posterior must choose among candidates more accurately than a lexicographic tie-break. Failing either shows the quality weighting adds nothing.
- **Machine learning.** No learned component. The parse, candidate scoring and posterior are small, fixed and embarrassingly parallel, so they are hard-coded CPU and CUDA kernels, not PyTorch graphs. A layout classifier for chemistry detection belongs to that task. One optional scalar recalibration of $\epsilon_i$ may be fitted on planted reads.
- **Kernels and devices.** Chunked FASTQ reader with parallel decompression (CPU only, gzip is sequential within a member); span slicing and 2-bit packing; exact hash probe (2-bit keys, $4\lvert W\rvert=27$ MB for the v3 list); Hamming-1 and Hamming-2 enumeration probes (48 and 1,128 per barcode); log-space posterior; per-chunk counters. On CUDA the packed chunks and the table sit on the device and the probe and posterior kernels run per batch.
- **Streaming.** One pass; memory is bounded by chunk size plus the table; the parse stream is written per chunk.
- **Defaults for an agent.** Always pass an explicit layout, and call chemistry detection when it is unknown. Keep `require_exact_length` true, N excluded, `reverse_complement_cb` false, adapter tolerance 1. Pass a whitelist for any droplet layout, otherwise no geometry warning can be raised. Method `fixed_layout` is the only value.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member or artefact | Type | Description |
|---|---|---|---|
| read | FASTQ files `fastq_r1`, `fastq_r2` | gzip or plain FASTQ | Raw read pair, synchronised by read name; not `.singlet` members. |
| write | uns/ingest_parse_summary | dict (JSON) | Read pairs per class (sums to $N_r$); `parse_rate` = parsed pairs / $N_r$; `whitelist_exact_match_rate` = fraction of parsed CBs in $W$; `whitelist_distance1_rate` = fraction not in $W$ with a member at $d_H=1$; mean $\rho$; `geometry_check` (below); device. |
| write | uns/ingest_geometry | dict (JSON) | Resolved spans and read index for CB, UMI, adapter and cDNA, their source (registry or explicit) and the policy flags. |
| write (sidecar) | parse stream at `parse_out` | one record per pair | `read_id`, `cb_seq`, `cb_qual`, `umi_seq`, `umi_qual`, `cdna_read_id`, `parse_status`, `failure_class`, `cb_in_whitelist`, `cb_candidates` ($\mathcal N_1(o)$), `layout_confidence` ($\rho$). Not a `.singlet` member. |

`geometry_check` is `not_run` without a whitelist, `warning` when the exact-match rate among parsed reads is at most ten times the chance rate $\lvert W\rvert/4^{L}$ (factor ten proposed, to be set on the B2 negative control), otherwise `pass`.

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or workspace handle; created without matrices if absent. |
| `fastq_r1` | string | required | — | Path or URI of read 1 (gzip or plain FASTQ). |
| `fastq_r2` | string | required | — | Path or URI of read 2, in the same order as read 1. Mismatching read names stop the call. |
| `method` | string | "fixed_layout" | `fixed_layout` | Extraction method. fixed_layout slices declared spans, with STARsolo CB_UMI_Simple semantics. |
| `layout` | object | — | — | Protocol layout: a registry key or explicit 1-based spans. Null span fields take the registry value; there is no silent default. |
| `layout.name` | string/null | null | — | Registry key, for example 10xv2, 10xv3 or 10x5p. Required unless all four spans are given. |
| `layout.cb_read` | integer | 1 | `1`, `2` | Read that holds the cell barcode and UMI. |
| `layout.cb_start` | integer/null | null | min 1 | 1-based start of the cell barcode; null takes the registry value. |
| `layout.cb_len` | integer/null | null | min 1; max 32 | Cell barcode length; null takes the registry value. |
| `layout.umi_start` | integer/null | null | min 1 | 1-based start of the UMI; null takes the registry value. |
| `layout.umi_len` | integer/null | null | min 1; max 32 | UMI length; null takes the registry value (10 for v2, 12 for v3). |
| `layout.cdna_read` | integer | 2 | `1`, `2` | Read that holds the cDNA. Equal to cb_read for 5' layouts, where the cDNA is the remainder of the read. |
| `layout.adapter_seq` | string/null | null | — | Fixed segment after the UMI in 5' layouts; null takes the registry value, or no adapter for custom layouts. |
| `policy` | object | — | — | Parse policy. Changes counts, not spans; state it in any comparison. |
| `policy.require_exact_length` | boolean | true | — | Reads longer than the layout fail as length_mismatch. Ignored when cdna_read equals cb_read; shorter reads always fail. |
| `policy.allow_N_in_cb` | boolean | false | — | Accept reads with N in the cell barcode instead of classing them N_in_cb. |
| `policy.allow_N_in_umi` | boolean | false | — | Accept reads with N in the UMI instead of classing them N_in_umi. |
| `policy.reverse_complement_cb` | boolean | false | — | Reverse-complement the barcode before diagnostics and output; only for protocols with the barcode on the opposite strand. |
| `policy.adapter_mismatches_max` | integer | 1 | min 0 | Mismatches tolerated in the adapter (STARsolo default 1); used only when an adapter is declared. |
| `whitelist` | string | — | — | Barcode list for the layout diagnostic and layout confidence; does not change cb_seq. Without it, geometry_check is not_run. |
| `parse_out` | string | — | — | Path of the parse stream sidecar; omitted means a file beside the dataset. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device for candidate scoring; auto picks CUDA when a device with enough memory is available. Decompression stays on CPU. |
| `dry_run` | boolean | false | — | Return estimated time, memory, resolved geometry and device without reading reads. |
| `overwrite` | boolean | false | — | Replace existing uns members and the parse stream instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules across parameters: `layout.name` supplies every span left null; a custom layout needs `cb_start`, `cb_len`, `umi_start` and `umi_len` and has no adapter unless `adapter_seq` is given. Null never falls back to STAR's defaults, and a missing registry value is an error. When `cdna_read` equals `cb_read` (5' layouts) the cDNA is the remainder of the read, `length_mismatch` is not applied, and only `r1_too_short` is. Read names of R1 and R2 must agree, otherwise the call stops and writes nothing. `policy.adapter_mismatches_max` applies only with an adapter. Without `whitelist`, `layout_confidence` is null.

## 7. MCP tool

Tool name `singlet_ingest_quant_barcode_umi_extraction` (definition in `tasks/mcp/singlet_ingest_quant_barcode_umi_extraction.json`). Example call and a schematic result (values illustrate the structure, they are not measurements):

```json
{"dataset": "sample_A.singlet", "fastq_r1": "A_R1.fastq.gz", "fastq_r2": "A_R2.fastq.gz",
 "layout": {"name": "10xv3"}, "whitelist": "3M-february-2018.csv.gz"}
{"dataset": "sample_A.singlet", "status": "completed",
 "wrote": ["uns/ingest_parse_summary", "uns/ingest_geometry"],
 "summary": {"reads_in": 1000, "parse_rate": 0.99, "geometry_check": "pass",
  "failure_counts": {"ok": 990, "length_mismatch": 3, "N_in_cb": 4, "N_in_umi": 2, "cdna_empty": 1},
  "whitelist_exact_match_rate": 0.97, "mean_layout_confidence": 0.99,
  "parse_stream": "sample_A.singlet.ingest/parse.tsv.gz", "device": "cpu"},
 "provenance_id": "prov-example-0001"}
```

Long-running: yes above a server-set input size (queued). Stochastic: no, so there is no seed. Dry run: input sizes, resolved geometry, estimated seconds and peak memory, and the device; no reads are parsed.

## 8. Benchmarks

**Shared protocol.** No published benchmark isolates barcode and UMI extraction, so B1 and B2 are proposed and generated by singlet from the recipe in B1. Use seeds 0 to 4 and report the median and range; score each geometry, then average geometries with equal weight. Run comparators at the commits of section 12 with documented defaults. Report failure classes separately from policy switches, first under default policy and then with `allow_N_in_cb` true. Labels come from the generator's own layout table and never from the parser's coordinate code. All label coordinates are 1-based.

### B1. Planted-layout parse accuracy (proposed)

- **Goal**: whether the parser recovers exact spans and strings for known layouts and reports each planted unparseable pair under its correct class.
- **Ground truth**: planted simulation. Per pair the label is the class, the CB and UMI spans, and the CB and UMI strings as sequenced; scored by exact equality.
- **Generator recipe G**:
  1. Draw each CB uniformly from the 6,794,880-entry 3M-february-2018 list.
  2. Draw each UMI uniformly from $4^{u}$; draw cDNA as 90 uniform bases.
  3. Write $r^{(1)}$ as CB then UMI (G3 adds a fixed 13-base adapter); write $r^{(2)}$ as the cDNA.
  4. Draw each CB and UMI base quality from $\{37,30,20,10\}$ with probabilities $0.90,0.07,0.02,0.01$, apply a substitution to a base with probability $\epsilon_i$ (never N), and write the quality string. Errors are not applied to the adapter.
  5. Plant 2 percent of pairs in each class: `r1_too_short` (truncated by one base), `length_mismatch` (one extra base), `N_in_cb`, `N_in_umi` (one N), `adapter_mismatch` (two substitutions, above the default tolerance of one; G3 only), `cdna_empty`.
  6. Negative controls: parse the same reads with the CB start shifted by one base, and separately with `umi_len` reduced by one.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Planted G1 (10x v2 layout) | recipe G | synthetic; $10^{6}$ pairs per seed; R1 of 26 bases, CB 1-16, UMI 17-26 | — | list-derived CBs |
| Planted G2 (10x v3 layout) | recipe G | synthetic; $10^{6}$ pairs per seed; R1 of 28 bases, UMI 17-28 | — | |
| Planted G3 (5'-style layout) | recipe G | synthetic; $10^{6}$ pairs per seed; R1 of 39 bases, UMI 17-26, adapter 27-39 (STARsolo documentation convention) | — | adapter string fixed once and recorded |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| span_accuracy | Among truth-`ok` pairs, fraction whose reported read index, start and end of CB and UMI equal the planted spans | higher | primary | proposed |
| sequence_accuracy | Among reported-`ok` pairs, fraction whose CB and UMI strings equal the sequenced strings (no whitelist correction) | higher | primary | proposed |
| failure_recall | Per class, planted pairs reported in that class over planted pairs of the class; mean over the classes present in the geometry | higher | primary | proposed |
| silent_misparse_rate | Per class, planted failures reported `ok` over planted failures | lower | guardrail | proposed |
| false_fail_rate | Truth-`ok` pairs reported in any other class over truth-`ok` pairs | lower | guardrail | proposed |

- **Comparators**: STARsolo `CB_UMI_Simple` with `soloBarcodeReadLength` 1, which aborts on length violations, so it is scored on truth-`ok` and N pairs only; UMI-tools extract with the equivalent pattern.
- **Protocol**: as shared; apply the shift controls and record the whitelist exact-match rate for each.
- **Acceptance criterion** (proposed; the rules are deterministic): span_accuracy, sequence_accuracy and failure_recall equal 1.000, silent_misparse_rate and false_fail_rate equal 0, for every geometry and class.
- **Known pitfalls**: a parser tested against labels built from its own coordinate code passes trivially, hence the independent layout table; reads short for cDNA but long enough for CB and UMI are a policy question, so `cdna_empty` is scored per class.

### B2. Layout confidence and barcode posterior (proposed)

- **Goal**: whether $\rho$ is calibrated, separates in-layout from out-of-layout reads better than the hard indicator, and whether the posterior picks the right candidate.
- **Ground truth**: planted mixture from recipe G (geometry G2) with CBs drawn uniformly from the full list and half the pairs out of layout, so the generator matches $\pi_c=1/2$ and the uniform $\pi_w$. Out-of-layout pairs are of two kinds, each a separate set: a random base inserted at position 1 of $r^{(1)}$ (shifted set) and a uniform random 16-mer in place of the CB (random set). Label $y=1$ for in-layout. For the posterior test, a list barcode $w$ receives one quality-weighted substitution; pairs with $o\notin W$ and at least two candidates in $\mathcal N_1(o)$ are kept and the label is $w$.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Planted mixture, shifted set | recipe G with out-of-layout kind 1 | synthetic; $10^{6}$ pairs per seed | — | shifted CBs reuse 15 true barcode bases |
| Planted mixture, random set | recipe G with out-of-layout kind 2 | synthetic; $10^{6}$ pairs per seed | — | uniform background, the model is exact here |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| calibration_error | $\sum_b (n_b/N)\lvert\bar y_b-\bar\rho_b\rvert$ over ten equal-width bins of $\rho$ ($n_b$ pairs, mean label $\bar y_b$, mean $\rho$ $\bar\rho_b$ in bin $b$) | lower | primary | proposed |
| auroc_gain | AUROC of $\rho$ minus AUROC of $\mathbb 1[o\in\mathcal N_1(W)]$ for in-layout versus out-of-layout; ties by mid-rank | higher | primary | proposed |
| posterior_accuracy | Fraction of kept pairs where $\arg\max_w P(w\mid o)$ equals the planted $w$, reported beside lexicographic tie-break and uniform random choice | higher | primary | proposed |
| shift_detection | Exact-match rate on the shifted set over that of the in-layout half; `geometry_check` on a fully shifted library | lower | guardrail | proposed |

- **Comparators**: the hard indicator and the lexicographic tie-break (both implemented in singlet); STARsolo `1MM_multi` posterior on the same candidates where its read-level output allows.
- **Protocol**: as shared; $\pi_c=1/2$, $d=1$.
- **Acceptance criterion** (proposed): calibration_error at most 0.01 on the random set; auroc_gain above 0 on both sets; posterior_accuracy above the tie-break by at least 0.10; shift_detection below 0.5 and `geometry_check` equal to `warning` on a fully shifted library.
- **Known pitfalls**: calibration holds only when the generator's mixing proportion and barcode prior equal the model's, so drawing from a subsample of the list or changing the mixture breaks it by construction; the shifted set is not a uniform background, so a failure there measures that misspecification.

### P1. Performance and scaling (proposed)

Throughput (read pairs per second, input bytes per second), peak resident memory and CPU utilisation of parsing alone on recipe G2 at $10^{6}$, $10^{7}$ and $10^{8}$ pairs, on CPU and CUDA, plus kernel time on CUDA. Hold fixed geometry, whitelist, thread count and storage. Report gzip and plain input separately, cold and warm timings separately (the first includes loading the whitelist), median and range of repeats, with the page cache controlled. Comparators: UMI-tools extract; STARsolo as a full run with alignment (not parse-only) and labelled so. Saturation reference: decompression-only timing on the same input. **Acceptance criterion** (proposed): on gzip input singlet CPU reaches at least 0.8 of the decompression-only throughput, and CUDA is not slower than CPU by more than 5 percent.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.chemistry_detection`: Protocol and chemistry detection from unlabelled reads
- **Feeds**:
  - `ingest-quant.barcode_whitelist_correction`: Cell barcode correction (whitelist-based or inferred barcode set)
  - `ingest-quant.read_to_gene_mapping`: Read-to-gene mapping engine: genome alignment versus pseudoalignment
  - `ingest-quant.umi_deduplication`: UMI deduplication and molecule collapsing
  - `ingest-quant.feature_barcode_counting`: Feature-barcode (ADT, hashtag, lipid-tag and guide) counting from FASTQ
- **Reads**: none
- **Writes**: `uns/ingest_parse_summary`, `uns/ingest_geometry`
<!-- CHAINING:AUTO:END -->

The droplet count workflow runs chemistry detection when the layout is unknown, then extraction, whitelist correction, mapping, UMI deduplication and cell calling; the feature-barcode workflow shares this parse.

## 10. Risks, pitfalls and open questions

- **Geometry sources.** Cell Ranger parse rules are compiled code; only its layout table was read. kb-python passes `-x` to `kallisto bus`, whose coordinates were not read, and the extraction code of piscem, alevin-fry and UMI-tools was not read. For 5' layouts STARsolo's documentation fixes 39 bases (adapter of 13), Cell Ranger places the cDNA at offset 26 or 41, and the adapter sequence is not stated in the sources read, so the `10x5p` registry value is unresolved.
- **Whitelist structure.** The uniform model understates ambiguity by about a factor of ten for list-derived barcodes (section 3.2). Only the 3M-february-2018 list was computed; the 737K-august-2016 list and the 2023 lists named in `chemistry_defs.json` are not in the sources read. The effect of clustering on $\rho$ under a non-uniform $\pi_w$ is tested in B2.
- **Missing real-data benchmark.** Cross-tool agreement on real FASTQ (STARsolo, kb count, simpleaf, UMI-tools extract, same layout, pre-correction fields) needs public 10x v2 and v3 FASTQ pairs with accessions and licences, none of which is named in the sources read, so it is not scheduled. Brüning et al. is known only through [R13].
- **Protocol coverage.** One fixed adapter after the UMI is supported. Floating anchors, indel tolerance and split-pool linkers are not, and no parse-level benchmark for them exists.
- **Data licences.** Scg_lib_structs has no LICENSE file and the Cell Ranger licence forbids redistribution, so the registry stores names and checksums of whitelists and facts about layouts, never copies. Whitelist provenance (file name and checksum) is recorded in every dataset.
- **First experiment.** Run B1 on G1 to G3 with the shift controls, confirm span_accuracy equals 1, then B2 on G2 and compare the extracted fields with STARsolo on one 10x v3 pair.

## 11. References

R1. Zheng GXY, Terry JM, Belgrader P, et al. Massively parallel digital transcriptional profiling of single cells. *Nature Communications* 2017. doi:10.1038/ncomms14049 — verified (corpus)
R2. Kaminow B, Yunusov D, Dobin A. STARsolo: accurate, fast and versatile mapping/quantification of single-cell and single-nucleus RNA-seq data. *bioRxiv* 2021 (preprint). doi:10.1101/2021.05.05.442755 — verified (corpus)
R3. Dobin A, Davis CA, Schlesinger F, Drenkow J, Zaleski C, Jha S, Batut P, Chaisson M, Gingeras TR. STAR: ultrafast universal RNA-seq aligner. *Bioinformatics* 2013. doi:10.1093/bioinformatics/bts635 — verified (corpus)
R4. Melsted P, Booeshaghi AS, Liu L, Gao F, Lu L, Min KH, da Veiga Beltrame E, Hjorleifsson KE, Gehring J, Pachter L. Modular, efficient and constant-memory single-cell RNA-seq preprocessing. *Nature Biotechnology* 2021. doi:10.1038/s41587-021-00870-2 — verified (corpus)
R5. Melsted P, Ntranos V, Pachter L. The barcode, UMI, set format and BUStools. *Bioinformatics* 2019. doi:10.1093/bioinformatics/btz279 — verified (repo)
R6. He D, Zakeri M, Sarkar H, Soneson C, Srivastava A, Patro R. Alevin-fry unlocks rapid, accurate and memory-frugal quantification of single-cell RNA-seq data. *Nature Methods* 2022. doi:10.1038/s41592-022-01408-3 — verified (corpus)
R7. He D, Patro R. simpleaf: a simple, flexible, and scalable framework for single-cell data processing using alevin-fry. *Bioinformatics* 2023;39(10):btad614. doi:10.1093/bioinformatics/btad614 — partial (search)
R8. Smith T, Heger A, Sudbery I. UMI-tools: modeling sequencing errors in Unique Molecular Identifiers to improve quantification accuracy. *Genome Research* 2017;27:491-499. doi:10.1101/gr.209601.116 — verified (corpus)
R9. Parekh S, Ziegenhain C, Vieth B, Enard W, Hellmann I. zUMIs - A fast and flexible pipeline to process RNA sequencing data with UMIs. *GigaScience* 2018. doi:10.1093/gigascience/giy059 — verified (corpus)
R10. You Y, Tian L, Su S, Dong X, Jabbari JS, Hickey PF, Ritchie ME. Benchmarking UMI-based single-cell RNA-seq preprocessing workflows. *Genome Biology* 2021. doi:10.1186/s13059-021-02552-3 — verified (corpus)
R11. Schulze Brüning R, Tombor L, Schulz MH, Dimmeler S, John D. Comparative analysis of common alignment tools for single-cell RNA sequencing. *GigaScience* 2022. doi:10.1093/gigascience/giac001 — verified (corpus)
R12. Farouni R, Djambazian H, Ferri LE, Ragoussis J, Najafabadi HS. Model-based analysis of sample index hopping reveals its widespread artifacts in multiplexed single-cell RNA-sequencing. *Nature Communications* 2020. — verified (corpus)
R13. He D, Srivastava A, Sarkar H, Patro R, Kim SH, Heumos L. Single-cell best practices, chapter "Raw data processing" (online book; `jupyter-book/introduction/raw_data_processing.md` in theislab/single-cell-best-practices). No DOI. — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/alexdobin/STAR | Alexander Dobin (copyright holder in LICENSE); HEAD b1edc12 | MIT | Defaults, documented semantics and barcode reading code | port |
| https://github.com/10XGenomics/cellranger | 10x Genomics (copyright holder in LICENSE); HEAD 669395e | Custom 10x Genomics license: internal use with 10x products, no redistribution; README: source for informational purposes only | Chemistry layout table; comparator through its outputs | callout |
| https://github.com/pachterlab/kb_python | Kyung Hoi (Joseph) Min (setup.py); HEAD 188d9c7 | BSD 2-Clause (LICENSE, Copyright (c) 2019, Pachter Lab) | Technology list, 10XV4 remapping; kb count wrapper | callout |
| https://github.com/BUStools/bustools | BUStools (copyright holder in LICENSE); HEAD d4d7a28 | BSD 2-Clause | BUS format, barcode correction and UMI collapsing (README) | callout |
| https://github.com/COMBINE-lab/alevin-fry | Avi Srivastava, Hirak Sarkar, Dongze He, Noor Pratap Singh, Rob Patro (Cargo.toml); HEAD ad05742 | BSD 3-Clause | RAD consumer; permit lists | callout |
| https://github.com/COMBINE-lab/simpleaf | Rob Patro, Dongze He, Noor Pratap Singh (Cargo.toml); HEAD 6abee7e | BSD 3-Clause | Chemistry presets and geometry strings | callout |
| https://github.com/CGATOxford/UMI-tools | Ian Sudbery (pyproject.toml); copyright holder CGAT; HEAD 79d8b81 | MIT | Pattern-based extraction | callout |
| https://github.com/sdparekh/zUMIs | repository owner sdparekh; paper authors [R9]; HEAD 2039a90 | GNU General Public License v3 (LICENSE) | YAML `base_definition` vocabulary | reimplement |
| https://github.com/Teichlab/scg_lib_structs | Teichlab (repository owner); HEAD 3b61a87 | — (no LICENSE file at the repository root) | Layout definitions; the v3 whitelist used in section 3.2 | reimplement |
| https://github.com/theislab/single-cell-best-practices | chapter authors in section 11 [R13]; HEAD d581689 | Apache-2.0 (LICENSE) | Source of the 81 percent figure and the Brüning summary | callout |

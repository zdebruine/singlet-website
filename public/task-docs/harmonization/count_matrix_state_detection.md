---
id: harmonization.count_matrix_state_detection
title: Count-matrix processing-state detection
area: harmonization
scope: core
paradigm: hybrid
literature_status: routine
priority: P1
depends_on: [harmonization.object_integrity_checks]
feeds: [normalization.size_factor_estimation, dim-reduction.normalized_cell_embedding, harmonization.schema_conformance_validation]
reads: [X or layers/<layer>, obs/total_counts, var/mt, uns/log1p, uns/normalization_id]
writes: [uns/state_report, obs/row_sum, var/col_mean, var/col_var]
devices: [cpu, cuda]
mcp_tool: singlet_harmonization_count_matrix_state_detection
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Count-matrix processing-state detection

> Labels a stored expression matrix as raw counts, normalized, log1p, scaled, z-scored, Pearson residuals or unresolved non-integer data from its values alone, and flags any conflict with the declared state.

## 1. Question

Given a stored cells-by-genes matrix $Y$ (dense or sparse, whole or one layer) and optionally the state its metadata declares or a downstream method requires, which processing state produced its values: raw UMI counts, library-size normalized values, a shifted logarithm, scaled, z-scored or analytic Pearson residuals, or non-integer non-negative data that the values cannot resolve? The output is one label per matrix, its supporting statistics, and a conflict flag against the declared state. A correct label is the state that generated the values, which is known only for planted data (section 8).

## 2. Why this task matters and where the field stands

Methods that accept a matrix usually assume a state and do not check it. Count models need integers [R2][R3]. The shifted logarithm assumes library-size normalized input with pseudo-count one, and its delta-method origin is [R10]. Feeding the wrong state into scran is a real error: the best-practices book records a fix so that `computeSumFactors` receives raw counts (section 12). Such errors produce plausible output without any failure.

The status is **routine** for the sign and integrality tests, which scanpy applies and warns on [R8] and which scvi-tools and CellTypist apply in approximate form. The status is **open** for the state of non-integer data. Ahlmann-Eltze and Huber compare transformations for scRNA-seq data [R1], but their benchmark targets downstream tasks, not the state of a stored matrix.

Open problems:

- Non-integer non-negative matrices can be length-corrected counts, values normalized with pooled size factors [R5], or scaled data. scvi-tools warns with a `UserWarning` when a registered count layer fails its sampled integer and sign check (`src/scvi/data/fields/_layer_field.py:90-91` @ 5555ecc), and the warning does not name the cause. No published taxonomy separates these cases.
- Integer-valued normalized data (rounded CPM, cells whose total equals the target) pass an integrality test, so integrality alone cannot establish raw counts.
- The tools disagree on what to check. scanpy reads every stored entry; scvi-tools samples 20 values; CellTypist probes the maximum of the first 1000 rows; decoupler's default mode tests negatives entrywise but integrality only through the grand total.
- Declared metadata is trusted downstream. The OpenProblems benchmark matches a method's preferred normalization to a dataset's declared `normalization_id` and admits `log_cp10k` data to counts-preferring methods, a pairing the repository does not document (section 12).

## 3. Theory and insight

Notation: $Y_{gc}\ge0$ is the stored value of gene $g$ in cell $c$, $n$ the number of cells, $u_c=\sum_gY_{gc}$ the cell total, $s_c$ a size factor, $L$ a library-size target, $\alpha$ the negative binomial overdispersion ($\alpha=0$ is Poisson) and $y_0$ a pseudo-count. Gene statistics use all $n$ cells, zeros included, unless stated.

**Count model.** A gamma-Poisson mixture with mean $\mu_{gc}$ and overdispersion $\alpha$ gives

$$\operatorname{Var}[Y_{gc}]=\mu_{gc}+\alpha\mu_{gc}^{2},$$

the model that the best-practices book states for UMI data and that underlies [R2] and [R3]. Raw UMI values are integers because each is a deduplicated molecule count [R11]. The model holds per gene and cell for integer counts only.

**Library-size normalization and the shifted logarithm.** With $s_c=u_c/L$ and $x_{gc}=\log(Y_{gc}/s_c+y_0)$, the natural logarithm with $y_0=1$ satisfies

$$\sum_g\big(e^{x_{gc}}-1\big)=\sum_g\frac{Y_{gc}}{s_c}=L\quad\text{for every cell }c.$$

This follows from the definitions. It is exact in exact arithmetic when $y_0=1$, the logarithm is natural and no highly expressed genes are excluded; scanpy's `exclude_highly_expressed` breaks it (see the failure modes below). Float32 storage needs a tolerance. Inverting $b^{x}-1$ for a candidate base $b\in\{e,2,10\}$ recovers the normalized values, whose row sums are constant for the true base and, in general, not for other bases.

**Moments of scaled and z-scored data.** For gene $g$ with sample standard deviation $\hat\sigma_g$ (denominator $n-1$),

$$z_{gc}=\frac{x_{gc}-\bar x_g}{\hat\sigma_g},\qquad \sum_cz_{gc}=0,\qquad \sum_cz_{gc}^{2}=n-1.$$

Scaling a non-negative matrix without centring keeps values non-negative, gives unit variance and leaves non-zero means. The sum of squares bounds every z-score by $\sqrt{n-1}$, and a gene detected in one cell attains $(n-1)/\sqrt n$, which lies within a relative $1/n$ of $\sqrt n$ (derived). A clip bound at $\sqrt n$ therefore does not identify residuals on its own.

**Analytic Pearson residuals.** With $p_g=\sum_cY_{gc}/\sum_{g'c'}Y_{g'c'}$ and $\hat\mu_{gc}=u_cp_g$,

$$r_{gc}=\frac{Y_{gc}-\hat\mu_{gc}}{\sqrt{\hat\mu_{gc}+\hat\mu_{gc}^{2}/\theta}},$$

clipped at $\pm\sqrt n$. [R2] introduces this residual, and the scanpy implementation computes the same margins, denominator and clip (section 4). The regime is integer counts, a shared $\theta$ and enough cells that the margins describe the fit. Residuals of zero counts are not zero, so the output is dense and gene sums are not zero in general.

**Sampling.** A probe that draws $k$ entries independently, with replacement, misses a fraction $f$ of contaminated entries with probability $(1-f)^k$. For $k=20$ this is 0.36 at $f=0.05$ and 0.82 at $f=0.01$ (derived). Decisions therefore need a full scan.

**Floating point.** Integers are exact in float32 up to $2^{24}$, and every float32 value above $2^{23}$ is an integer. A count above $2^{24}$ is therefore rounded silently to a nearby integer, which an integrality test cannot detect (derived).

**Estimands.** The label is one categorical value per matrix, chosen by the rule in section 5; no per-cell label is produced. `integer_fraction` is the share of stored entries with integer values; implicit zeros of sparse input are excluded from the denominator. Row sums $u_c$ run over all genes, and `row_sum_cv` is the sample standard deviation over cells divided by the mean. Gene means and variances use all cells, zeros included, with denominator $n-1$ for variances. The ground truth in B1 is the transform applied to each simulated matrix; in B2 it is the constructed label.

**Regime and assumptions.** The rules assume one state per matrix; mixed blocks are out of scope. Library targets are either declared or taken from a candidate set. Row sums and gene moments are recomputed after any subsetting.

**Failure modes by family.**

- Integrality and sign: wrong for length-corrected non-integer counts; passes integer-valued normalized data, rounded CPM and equal-depth downsampled raw counts.
- Row sums: wrong for size factors not of library-size form, such as pooling and deconvolution [R5], and for `exclude_highly_expressed`.
- Log inversion: wrong for pseudo-counts other than one, for bases outside $\{e,2,10\}$ and for producers that do not record the base.
- Moments and clipping: rare genes approach the $\sqrt n$ bound, and scanpy's `scale` has no default clip.
- Mitochondrial fraction: unchanged by per-cell scaling, so it cannot separate counts from CPM, and undefined for negative values.

**Comparator pitfalls.** decoupler's grand-sum test accepts two entries of 0.5. scanpy's `np.signbit` reports explicit $-0$ as negative, so $-0$ must be normalized before testing. CellTypist's probe checks neither negatives nor all rows.

**Insight.** Values identify depth-variable integers, constant row sums, and sign and moment patterns. They cannot resolve unknown per-cell size factors: a non-integer log matrix can match several raw-count matrices. The detector therefore returns an explicit unresolved class, and a conflict only against declared or required metadata, rather than forcing a label. A likelihood over the same statistics would add calibrated class probabilities and a reject option (section 5).

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Full-scan integer and sign test (scanpy) | heuristic | reject any negative stored value or non-integer over every stored entry | [R8], §12 |
| Sampled integer and sign probe (scvi-tools) | heuristic | test 20 random stored values or rows; approximate | §12 (source); scVI model paper [R9] |
| Prefix-maximum probe (CellTypist) | heuristic | warn if the maximum of the first 1000 rows is not an integer | §12 |
| Grand-sum test (decoupler) | heuristic | reject negatives entrywise; test integrality of the grand total in mode `sum` | §12 |
| Row-sum constancy and target match | heuristic | depth-dependent row sums for counts; library-size normalized rows sum to a target | [R8], §12 |
| Shifted-logarithm inversion | heuristic | invert $b^{x}-1$ for candidate bases and test the row sums | [R10], [R1] |
| Declared-state reconciliation | heuristic | compare declared metadata with the evidence and with a downstream requirement | §12 |
| Mitochondrial fraction plausibility | heuristic | per-cell mitochondrial share against a plausibility bound | [R6]; [R7] as attributed by the QC chapter |
| Scaled and z-scored moment test | heuristic | per-gene means, variances and sign pattern | [R8], §12 |
| Analytic Pearson clipping signature | hybrid | signed values bounded at $\sqrt n$ by a residual model | [R2] |

The full-scan integrality and sign test is the standard that scanpy applies and warns on [R8]; the sampled, prefix and grand-sum checks are approximations or weaker forms and are kept as comparators. The sources read here include no published classifier of these states; the taxonomy and decision rule are singlet's.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| M1 full scan | scope | all stored entries | scanpy `src/scanpy/_utils/__init__.py:762-772` @ 8ed52d9 |
| M1 | negative test | fails on `np.signbit(data).any()` | same file, `:766-767` @ 8ed52d9 |
| M1 | integer test | integer dtype passes; otherwise `not np.any((data % 1) != 0)` | same file, `:770-772` @ 8ed52d9 |
| M2 sampled probe | draws | 20, `np.random.choice` with no seed; rows (dense) or stored values (sparse) | scvi-tools `src/scvi/data/_utils.py:247, 270` @ 5555ecc |
| M2 | backed input | first 100 rows | scvi-tools `src/scvi/data/_utils.py:252` @ 5555ecc |
| M3 prefix probe | test and action | `float(X[:1000].max()).is_integer()`; warning only | CellTypist `celltypist/classifier.py:296-297` @ fe35756 |
| M3 | training step | probe at `celltypist/train.py:88-89`, then `normalize_total(target_sum=1e4)` and `log1p` at `:90-91` | CellTypist @ fe35756 |
| M4 grand sum | default mode | `"sum"` | decoupler `src/decoupler/pp/anndata.py:119` @ 3132edc |
| M4 | checks | skipped if `skip_checks` is set or mode is a dict or callable | decoupler `src/decoupler/pp/anndata.py:121-123` @ 3132edc |
| M4 | grand-sum test | `float(np.sum(X)).is_integer()` | decoupler `src/decoupler/pp/anndata.py:133-137` @ 3132edc |
| M5 row sums | target when None | median of non-zero per-cell totals | scanpy `src/scanpy/preprocessing/_normalization.py:20-26, 104-105` @ 8ed52d9 |
| M5 | candidate targets | 1e4, 1e5, 1e6; 1e4 is the CellTypist training convention | proposal; CellTypist `celltypist/train.py:90` @ fe35756 |
| M5 | row-sum CV threshold; relative tolerance | 0.05; 1e-4 | proposal |
| M6 log | base record | `adata.uns['log1p'] = {'base': base}` | scanpy `src/scanpy/preprocessing/_simple.py:424` @ 8ed52d9 |
| M6 | candidate bases | e, 2, 10 | proposal |
| M7 reconciliation | layer types | `counts` integer; `normalized` double | OpenProblems `src/api/file_common_dataset.yaml:11-19` @ b3da9d6 |
| M7 | normalization_id | required string | OpenProblems `src/api/file_common_dataset.yaml:89-92` @ b3da9d6 |
| M7 | pairing filter | `norm == pref`, or `log_cp10k` for `counts` (not copied) | OpenProblems `src/workflows/run_benchmark/main.nf:121-127` @ b3da9d6 |
| M8 mitochondrial | cutoff | 3 MADs and a fixed 8% share, which the chapter calls not universal | book `jupyter-book/preprocessing_visualization/quality_control.ipynb`, markdown line 502 @ d581689 |
| M8 | plausibility bound | 0.2 | proposal; the chapter states that most cells lie below 20%, line 443 |
| M9 scaled | `max_value` | None (no clip) | scanpy `src/scanpy/preprocessing/_scale.py:92` @ 8ed52d9 |
| M9 | `zero_center` | True under the default preset ScanpyV1 | `_scale.py:91`; `src/scanpy/_settings/presets.py:258`; default at `src/scanpy/_settings/__init__.py:64`, all @ 8ed52d9 |
| M10 residuals | clip | None, meaning $\sqrt{n}$ | scanpy `src/scanpy/experimental/pp/_normalization.py:54-56` @ 8ed52d9 |
| M10 | residual form | margins $\hat\mu$ and denominator $\sqrt{\hat\mu+\hat\mu^2/\theta}$ | same file, `:65-76` @ 8ed52d9 |

## 5. Proposed singlet approach

Routes. **Port**: M1, with the source's copyright notice (section 12). **Reimplement**: M5 to M10 and the decision rule, from section 3. **Callout**: M2 to M4, as benchmark comparators only.

Decision rule. One pass over stored entries accumulates the integer count, negative count, $u_c$ and per-gene sums and squares; zero-variance genes are excluded. Then, in order:

1. Any negative entry: `zscored` if every gene has mean zero and variance one within tolerance; otherwise `pearson_residuals` if the largest absolute value sits at $\sqrt n$ on a gene with non-zero mean; otherwise `unknown`.
2. No negative entries, every gene with variance one and non-zero means: `scaled`.
3. No negative entries, all values integers: `raw_counts` if the row-sum CV exceeds `rowsum_cv_threshold`, otherwise `normalized`, flagged as integer-valued or equal-depth.
4. Non-integer: `normalized` if the row-sum CV is within threshold, reporting a target that matches a candidate within `rowsum_rel_tol`; otherwise `log1p` if a candidate base gives constant inverted row sums; otherwise `nonnegative_noninteger`.

Conflict is set when a determinate label differs from the declared state or from `required_state`; `nonnegative_noninteger` and `unknown` never set it. singlet does not copy the OpenProblems pairing rule. `integrality_only` never returns `raw_counts`.

Model-based formulation (proposed, not in the enum). A probabilistic classifier over the same statistics, with likelihoods from the B1 generator, would return calibrated probabilities and a reject option. It is rejected if its B1 macro-F1 does not exceed the rule's, if its raw false-positive rate exceeds zero on B1 or on B2 cases (a) and (b), or if its calibration error on held-out seeds exceeds 0.05 (proposal).

ML stack and kernels. The rule needs no training. Its reductions are hard-coded in CUDA, with cuSPARSE for sparse input and a CPU reference. PyTorch is justified only if a learned classifier beats the rule on B1.

Streaming. CSR input is read in row blocks; gene accumulators sum across blocks, using $O(n+G)$ memory.

Defaults an agent should use: `method` full_scan; `device` auto; `declared_state` unknown; integer tolerance 0; row-sum CV threshold 0.05; relative tolerance 1e-4; bases e, 2, 10; targets 1e4, 1e5, 1e6; prefix `MT-`; plausibility bound 0.2; residual clip check on.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | `X` or `layers/<layer>` | dense or sparse float | matrix under test; the layer name is a parameter |
| read | `obs/total_counts` | float | per-cell totals; reused if present, otherwise recomputed |
| read | `var/mt` | bool | mitochondrial gene mask; optional, otherwise prefixes are used |
| read | `uns/log1p` | dict | declared log base record; optional |
| read | `uns/normalization_id` | string | declared normalization; optional |
| write | `uns/state_report` | dict | label, conflict, declared state and statistics |
| write | `obs/row_sum` | float32 | per-cell totals over all genes (full scan) |
| write | `var/col_mean` | float32 | per-gene mean over all cells (full scan) |
| write | `var/col_var` | float32 | per-gene sample variance over all cells (full scan) |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `layer` | string/null | null | — | Matrix to test, named as layers/<name>; null tests X. |
| `method` | string | "full_scan" | `full_scan`, `integrality_only` | full_scan checks every stored entry (default). integrality_only applies the integer and sign test only and never returns raw_counts. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `reconciliation` | object | — | — | Declared-state and required-state options for the conflict flag. |
| `reconciliation.declared_state` | string | "unknown" | `raw_counts`, `normalized`, `log1p`, `scaled`, `zscored`, `pearson_residuals`, `nonnegative_noninteger`, `unknown` | State recorded by the producer or metadata; a determinate label that differs raises the conflict flag. |
| `reconciliation.required_state` | string/null | null | — | State a downstream method needs, using the same labels; null skips the requirement check. |
| `integrity` | object | — | — | Integer-test options for full_scan and integrality_only. |
| `integrity.integer_tolerance` | number | 0 | min 0 | Absolute tolerance for integer-valued entries; 0 is exact. |
| `library_size` | object | — | — | Row-sum and log-inversion options for full_scan. |
| `library_size.target_sum_candidates` | array | [10000, 100000, 1000000] | — | Library-size targets tested for a row-sum match. |
| `library_size.log_bases` | array | ["e", "2", "10"] | — | Candidate log bases for inverting shifted logarithms. |
| `library_size.rowsum_cv_threshold` | number | 0.05 | min 0 | Row-sum coefficient of variation above which rows count as depth-variable (proposal). |
| `library_size.rowsum_rel_tol` | number | 0.0001 | min 0 | Relative tolerance for a row sum equal to a candidate target (proposal). |
| `mito` | object | — | — | Mitochondrial plausibility statistic; never changes the label. |
| `mito.prefixes` | array | ["MT-"] | — | Gene-name prefixes for mitochondrial genes; species-dependent. |
| `mito.plausibility_max` | number | 0.2 | min 0; max 1 | Upper bound on median mitochondrial fraction (proposal). |
| `residual_clip_check` | boolean | true | — | Test for a clip bound at sqrt(n_cells) on a gene whose mean is not zero. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules that span parameters. `library_size`, `mito` and `residual_clip_check` apply to `full_scan` only; `integrity` applies to both methods. `reconciliation.required_state` uses the same labels as the output. Inputs containing NaN or infinite values fail with an error rather than being labelled. `mito` only computes a statistic and never changes the label. Existing output members cause failure unless `overwrite` is true.

## 7. MCP tool

Tool name `singlet_harmonization_count_matrix_state_detection` (definition in `tasks/mcp/singlet_harmonization_count_matrix_state_detection.json`). Illustrative call:

```json
{
  "dataset": "/data/pbmc.singlet",
  "layer": "counts",
  "reconciliation": {"declared_state": "raw_counts"}
}
```

Illustrative result:

```json
{
  "dataset": "/data/pbmc.singlet",
  "status": "completed",
  "wrote": ["uns/state_report", "obs/row_sum", "var/col_mean", "var/col_var"],
  "summary": {"label": "normalized", "conflict": true, "declared_state": "raw_counts", "integer_fraction": 0.0, "n_negative": 0, "row_sum_cv": 0.0003, "target_sum_match": 10000},
  "provenance_id": "prov_0001",
  "job_id": null,
  "estimate": null
}
```

Long-running: inline for in-memory inputs; backed inputs too large for one streamed sweep return `queued`. Stochastic: no; both methods are deterministic and use no sampling. Dry run: estimates seconds and peak memory from stored-entry count, density and device, without reading values.

## 8. Benchmarks

Shared protocol. All cases are stored as float32 CSR and as dense arrays of identical shape. The detector code is frozen before the planted set is generated, and generator and detector share no code; the transform code is written in a second language. Each matrix has exactly one planted label. Confusion matrices and per-label rates are reported. Thresholds are calibrated on a separate generator seed, and evaluation uses seeds 1 to 10 (proposal).

### B1. Planted-transform state benchmark

- **Goal**: measure whether the detector recovers the planted state of transformed simulated counts.
- **Ground truth**: planted simulation; one label per matrix, and conflict truth is the planted declared-versus-true mismatch.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Planted matrices from the recipe below | simulated; no external data | simulated counts; $n\in\{10^3,10^4\}$, $G=2000$ (proposed) | — | — |

Recipe. (1) Draw gene rates $q_g$ from a Gamma law with shape 0.5 and depths $d_c$ from a log-normal with log-SD 0.5 (proposal). (2) Draw $\alpha_g$ log-uniformly on $[0.01,1]$ and $Y_{gc}\sim\mathrm{NB}(d_cq_g,1/\alpha_g)$. (3) Apply one transform per matrix: raw $Y$; normalized $YL/u_c$ with $L=10^4$; log1p; scaled (log1p over its per-gene SD); z-scored (centred); Pearson residuals with $\theta=1/\bar\alpha$ clipped at $\sqrt n$; non-integer non-negative ($Y$ times a $\mathrm{Uniform}(0.5,1.5)$ factor per entry). (4) Add rounded normalized matrices, labelled normalized. (5) Declare a different label for 10% of matrices (proposal). (6) Vary sparsity through $q_g$.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| state_accuracy | fraction of matrices whose label equals the planted label | maximize | primary | — |
| macro_F1 | mean over labels present in the truth of $2PR/(P+R)$; predictions of absent labels count as errors for the true label | maximize | primary | — |
| conflict_recall | fraction of planted mismatches that raise the flag | maximize | primary | — |
| raw_false_positive_rate | fraction of non-raw matrices labelled `raw_counts` | minimize | guardrail | — |

- **Comparators**: M1 (as integrality_only), M2, M3 and M4, scored on the raw split only; conflict recall is undefined for them.
- **Protocol**: 20 matrices per label and size-density cell (proposal); M2 over five seeds, since its sampling is unseeded.
- **Acceptance criterion** (proposed, not from the literature): `state_accuracy` at least 0.99, `raw_false_positive_rate` equal to 0, `conflict_recall` at least 0.95; if the proposal fails, re-derive thresholds on the calibration seed.
- **Known pitfalls**: integer-valued normalized matrices are the case the integrality comparators label raw.

### B2. Edge-case benchmark

- **Goal**: probe known failure modes of each check with labels fixed by construction.
- **Ground truth**: planted simulation; the construction sets the label for each case.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Edge cases built from the B1 base matrices | constructed; recipe below | simulated counts at the B1 sizes and densities | — | seven cases |

Recipe. (1) Take the B1 base count matrices at each size and density. (2) Build the cases. (a) Raw counts times $u_{gc}\sim\mathrm{Uniform}(0.5,1.5)$, labelled `nonnegative_noninteger`. (b) Rounded normalized values, labelled `normalized`. (c) Integer counts at most $2^{24}$ stored as float32, labelled `raw_counts`. (d) Raw counts with explicit $-0$ on 5% of stored zeros (proposal), labelled `raw_counts`. (e) Sparse raw counts with explicit zeros stored, labelled `raw_counts`. (f) A fraction $f\in\{0.01,0.05,0.1\}$ of stored entries (sparse) or rows (dense) replaced by a non-integer copy, labelled as any non-raw label. (g) Raw counts downsampled to equal depth per cell, labelled `raw_counts`, reported as a known failure rather than scored.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| case_detection_rate | per case, fraction of matrices whose label equals the constructed label; for (f), any non-raw label counts as correct | maximize | primary | — |
| sampled_miss_rate_vs_f | for M2, fraction of (f) matrices labelled `raw_counts`, beside the expected $(1-f)^{20}$ | minimize | guardrail | §12 |

- **Comparators**: M1, M2, M3 and M4 as in B1, plus the rule of section 5.
- **Protocol**: each case at each size and density, with five seeds for M2; case (g) is reported separately.
- **Acceptance criterion** (proposed): the rule misses no matrix in case (f); the observed M2 miss rate matches $(1-f)^{20}$ within a binomial 95% interval at each $f$.
- **Known pitfalls**: case (a) returning `nonnegative_noninteger` is correct and is not an error; case (d) is a defect of sign tests based on `np.signbit`, so it is scored for every detector and the rule normalizes $-0$ before testing.

### P1. Performance and scaling

Measure wall time, peak memory and throughput in stored entries per second at $10^4$, $10^5$, $10^6$ and $10^7$ cells (the largest size because streaming is claimed), on CPU and CUDA, for the full scan, `integrality_only` and the comparators M2 to M4. Hold fixed the gene count, stored entries per cell, float32 CSR and CSC layouts, thread count and in-memory versus backed input. Acceptance (proposed): full-scan time grows linearly in stored entries, with log-log slope within 0.1 of one; the sampled comparator is flat in stored entries; CPU and CUDA statistics agree within float32 tolerance.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `harmonization.object_integrity_checks`: Matrix and metadata integrity checks
- **Feeds**:
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `harmonization.schema_conformance_validation`: Metadata conformance to a community schema
- **Reads**: `X or layers/<layer>`, `obs/total_counts`, `var/mt`, `uns/log1p`, `uns/normalization_id`
- **Writes**: `uns/state_report`, `obs/row_sum`, `var/col_mean`, `var/col_var`
<!-- CHAINING:AUTO:END -->

This task belongs to the harmonization preflight. It runs after object integrity checks, and it gates count-model and size-factor steps (which need raw counts) and embedding steps (which need normalized values).

## 10. Risks, pitfalls and open questions

- The CELLxGENE schema validator's raw-count requirement is unverified: the corpus has no schema repository, and the one secondary source read does not state the rule. Nothing from it is implemented.
- The thresholds (row-sum CV 0.05, relative tolerance 1e-4, mitochondrial bound 0.2, candidate targets 1e5 and 1e6) are proposals without a literature source. The 3-MAD and 8% mitochondrial rule is the QC chapter's attribution to pipeComp; the pipeComp paper itself was not read.
- No benchmark of processing-state detection was found. The Ahlmann-Eltze and Huber comparison is cited from its title and the chapter text; the paper was not read. Lause et al.'s residual form and √n clip are checked against the scanpy implementation, not against the paper. The corpus record for Dorfman (1938) has a garbled title and no DOI; the title, venue, volume and pages were checked against a web search that cites the paper, and the paper itself was not read.
- Non-integer ambiguity: pooled and deconvolution size factors and length-corrected counts cannot be resolved from values alone, and equal-depth downsampled raw counts are labelled `normalized` by the row-sum rule (B2 case g). The declared state is needed for these cases. The OpenProblems pairing of `log_cp10k` data with counts-preferring methods is undocumented and is not adopted.
- Data: catalogue layers have no verified processing state, so the planted benchmark uses simulated counts only. The pipeline-history benchmark on OpenProblems datasets is omitted because their accessions and licences are not established here.
- First experiment: implement M1, M5, M9 and M10 in the C++ reference, run B1 and B2 on the planted set, and report the confusion matrix before any learned classifier is considered.

## 11. References

R1. Ahlmann-Eltze C, Huber W. Comparison of Transformations for Single-Cell RNA-Seq Data. *Nature Methods* 2023. doi:10.1038/s41592-023-01814-1 — verified (corpus)
R2. Lause J, Berens P, Kobak D. Analytic Pearson residuals for normalization of single-cell RNA-seq UMI data. *Genome Biology* 2021. doi:10.1186/s13059-021-02451-7 — verified (corpus)
R3. Hafemeister C, Satija R. Normalization and variance stabilization of single-cell RNA-seq data using regularized negative binomial regression. *Genome Biology* 2019. doi:10.1186/s13059-019-1874-1 — verified (corpus)
R4. Choudhary S, Satija R. Comparison and evaluation of statistical error models for scRNA-seq. *Genome Biology* 2022;23. doi:10.1186/s13059-021-02584-9 — verified (repo)
R5. Lun ATL, Bach K, Marioni JC. Pooling across cells to normalize single-cell RNA sequencing data with many zero counts. *Genome Biology* 2016. doi:10.1186/s13059-016-0947-7 — verified (corpus)
R6. Ilicic T, Kim JK, Kolodziejczyk AA, Bagger FO, McCarthy DJ, Marioni JC, Teichmann SA. Classification of low quality cells from single-cell RNA-seq data. *Genome Biology* 2016. doi:10.1186/s13059-016-0888-1 — verified (corpus)
R7. Germain PL, Sonrel A, Robinson MD. pipeComp, a general framework for the evaluation of computational pipelines, reveals performant single cell RNA-seq preprocessing tools. *Genome Biology* 2020. doi:10.1186/s13059-020-02136-7 — verified (corpus)
R8. Wolf FA, Angerer P, Theis FJ. SCANPY: Large-Scale Single-Cell Gene Expression Data Analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)
R9. Lopez R, Regier J, Cole MB, Jordan MI, Yosef N. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)
R10. Dorfman RA. A note on the δ-method for finding variance formulae. *Biometric Bulletin* 1:129–137, 1938. — verified (search)
R11. Zheng GXY, Terry JM, Belgrader P, et al. Massively parallel digital transcriptional profiling of single cells. *Nature Communications* 2017. doi:10.1038/ncomms14049 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scanpy | authors listed in pyproject.toml; maintainers Ilan Gold, Philipp Angerer, Severin Dicks | BSD-3-Clause (LICENSE file) | defaults for M1, M5, M6, M9, M10 | port (M1); reimplement (others) |
| https://github.com/scverse/scvi-tools | the scvi-tools development team (pyproject authors) | BSD-3-Clause (LICENSE file) | comparator M2 | callout |
| https://github.com/Teichlab/celltypist | Chuan Xu (setup.py author); Teichmann Lab (copyright) | MIT-style permission text in the LICENSE file | comparator M3 | callout |
| https://github.com/scverse/decoupler | Pau Badia i Mompel (pyproject author) | BSD-3-Clause (LICENSE file) | comparator M4 | callout |
| https://github.com/openproblems-bio/task_batch_integration | Open Problems in Single-Cell Analysis | MIT License (LICENSE file) | M7 layer and normalization_id conventions | reimplement |
| https://github.com/theislab/single-cell-best-practices | Theislab (LICENSE copyright) | Apache-2.0 notice in the LICENSE file | chapter text: mitochondrial rule, scran changelog entry, shifted-logarithm attribution | callout (text only) |
| https://github.com/berenslab/umi-normalization | Jan Lause, Philipp Berens, Dmitry Kobak (README) | AGPL-3.0 (LICENSE file) | residual cross-check for M10 | callout (no code taken) |
| https://github.com/ChristophH/sctransform | Christoph Hafemeister, developed in Rahul Satija's lab (README) | GPL-3 (LICENSE file) | residual context; update described in [R4] | callout (no code taken) |

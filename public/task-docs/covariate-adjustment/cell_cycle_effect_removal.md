---
id: covariate-adjustment.cell_cycle_effect_removal
title: Cell-cycle effect removal
area: covariate-adjustment
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [normalization.size_factor_estimation, covariate-adjustment.covariate_variance_attribution]
feeds: [dim-reduction.normalized_cell_embedding, clustering.cell_partitioning, evaluation.overcorrection_detection]
reads: [X, var_names, uns/cc_gene_sets, obs/batch, obs/cell_type]
writes: [obs/S_score, obs/G2M_score, obs/cc_angle, layers/cc_removed, obsm/X_cc_free, uns/cc_removal_report]
devices: [cpu, cuda]
mcp_tool: singlet_covariate_adjustment_cell_cycle_effect_removal
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Cell-cycle effect removal

> Remove the proliferation (S and G2M) component of expression by regression or latent-factor models, check first how much it is confounded with protected biology, and report what was removed and what was kept.

## 1. Question

Can the S and G2M proliferation program be removed from log-normalised expression while cell-type, lineage and differentiation structure survive, and is removal warranted for a given dataset? The input is a log-normalised matrix with S and G2M gene lists or precomputed scores, plus optional batch and protected labels. The output is a corrected matrix or embedding, the cycle covariates used, and a confounding summary. A correct answer keeps protected structure intact while removing only the cycle variation that is orthogonal to it.

## 2. Why this task matters and where the field stands

Cell-cycle variation can share leading principal components with cell type, so it can mask or mimic the structure an analysis needs. Practitioners commonly score cells on S and G2M lists [R3] and regress the scores out before clustering [R1, R4]. This heuristic standard dominates practice, but its key step is a first-order correction whose validity depends on how well the scores measure the cycle and how the cycle relates to the biology being studied.

Status: **contested**. Barron and Li argue that regression removal risks removing other biological components, and propose ccRemover, which acts on principal-component directions [R5]. Latent models treat the cycle as a hidden or circular factor: scLVM [R6], Cyclum [R8] and CycleVI [R7]. The scIB cell-cycle conservation metric [R13] measures how much cycle variance is kept, not whether the remaining biology is correct.

Open problems:

1. Whether to remove the axis at all. The field has no accepted quantitative rule for this decision.
2. Covariate definition. Scores depend on gene lists and species; the Tirosh lists [R3] are the common choice.
3. Identifiability. Circular latent phases are identified only up to rotation and reflection.
4. Confounding with proliferation-linked biology such as progenitor identity and drug response [R5, R7].

## 3. Theory and insight

Let $y_{gc}$ be the log-normalised expression of gene $g$ in cell $c$, and $\mathbf x_c=(1,S_c,G_c)^\top$ an intercept with the two cycle covariates. Regression removal fits

$$y_{gc}=\mathbf x_c^\top\boldsymbol\beta_g+\varepsilon_{gc},\qquad r_{gc}=y_{gc}-\mathbf x_c^\top\hat{\boldsymbol\beta}_g,\qquad \hat{\boldsymbol\beta}_g=(\mathbf X^\top\mathbf X)^{-1}\mathbf X^\top\mathbf y_g,$$

and the corrected value is $r_{gc}$. The shared design means one projection serves every gene. The regime is first order: additive effects on the log scale and approximately Gaussian residuals. For counts, regularised negative-binomial regression [R14] and analytic Pearson residuals [R15] are the alternatives.

**Confounding attenuation.** Suppose $y_{gc}=\mu_g+a_gT_c+\mathbf b_g^\top\mathbf x_c+\varepsilon_{gc}$, with $T_c$ a single binary label such as cell type. Regressing on $\mathbf x$ alone gives, in population moments,

$$\mathbb E[r_{g}\mid T=1]-\mathbb E[r_{g}\mid T=0]=a_g\bigl(1-R^2(T\mid\mathbf x)\bigr),\qquad R^2(T\mid\mathbf x)=\frac{\mathrm{Cov}(T,\mathbf x)^\top\mathrm{Var}(\mathbf x)^{-1}\mathrm{Cov}(\mathbf x,T)}{\mathrm{Var}(T)}.$$

The fitted coefficient on $\mathbf x$ is $\mathbf b_g+a_g\boldsymbol\gamma$ with $\boldsymbol\gamma=\mathrm{Var}(\mathbf x)^{-1}\mathrm{Cov}(\mathbf x,T)$, so the residual is $a_g(T-\boldsymbol\gamma^\top\mathbf x)+\varepsilon_{gc}$. The group difference then follows from $\mathbb E[\mathbf x\mid T=1]-\mathbb E[\mathbf x\mid T=0]=\mathrm{Cov}(\mathbf x,T)/\mathrm{Var}(T)$. The regime is one binary label, a linear model and population moments; score noise adds bias. The surviving type difference is a fraction $1-R^2$ of the true one, so with $R^2=0.9$ a tenth survives. Progenitor and proliferative populations lose identity signal in proportion to how well the cycle predicts them.

**Scores and angle.** The Tirosh-style score is $s_c=\bar y_{c,\mathcal S}-\bar y_{c,\mathcal C_S}$, the mean over list genes minus the mean over control genes drawn from matched expression bins [R3, R4]; the G2M score is analogous. Its estimand is a difference of means in input log units, not standardised, and the control draw makes it seeded. The scanpy how-to states that cell-cycle scoring on about 20 genes is ineffective, and that almost 70 cell-cycle genes would not be scored as variable in its demonstration data (section 12). The angle $\theta_c=\operatorname{arctan2}(G_c,S_c)\bmod 2\pi$ is only an initial coordinate for latent models [R7], not a fitted phase model.

**Gene-level and direction-level corrections.** scLVM subtracts a predicted cycle effect from each gene,

$$\tilde y_{gc}=s_g\bigl(z_{gc}-\hat u_{gc}\bigr)+m_g,\qquad z_{gc}=\frac{y_{gc}-\bar y_g}{s_g},$$

where $\hat u$ comes from a fitted variance decomposition [R6]. Its estimand is expression on the original scale with the predicted cycle effect removed. ccRemover [R5] works on principal components instead. With $v_k$ the principal components of the non-cell-cycle block $\mathbf X_{\mathcal N}$, and $\mathbf X_{\mathcal C}$ the centred cell-cycle block,

$$\Delta_k=\sqrt{\overline{(\mathbf X_{\mathcal C}v_k)^2}}-\sqrt{\overline{(\mathbf X_{\mathcal N}v_k)^2}},\qquad t_k=\frac{\Delta_k}{\mathrm{sd}^*(\Delta_k)},$$

with $\mathrm{sd}^*$ the bootstrap standard deviation over cells. Components with $t_k\ge 3$ among the top ten are projected out of both blocks, for at most four rounds. The estimand is the corrected matrix in input log units with those directions removed.

**Latent circular model.** CycleVI [R7] represents a cell by a circular phase $\theta_c$ and a residual latent $\mathbf z^{\mathrm{oth}}_c$. Cycle genes follow a truncated Fourier series in $\theta_c$, and an adversarial classifier penalises phase information in $\mathbf z^{\mathrm{oth}}_c$. Its estimand is the residual latent as a cell-cycle-free embedding. Phase is identified only up to rotation and reflection, so the score-based initial angle fixes the frame.

**Proposed singlet model (not yet implemented).** Instead of projecting out a covariate, keep the protected label in the model:

$$\log\mu_{gc}=a_g+\sum_{k=1}^{K}\bigl(\alpha_{gk}\cos k\theta_c+\beta_{gk}\sin k\theta_c\bigr)+\mathbf w_g^\top\mathbf t_c+\boldsymbol\lambda_g^\top\mathbf z_c,\qquad x_{gc}\sim\mathrm{NB}(s_c\mu_{gc},\phi_g),$$

with $\mathbf t_c$ the one-hot protected label, $\theta_c$ carrying a posterior, and $\mathbf z_c$ a residual latent. Its estimand is the expected expression with the cycle term set to zero, per unit size factor, and the posterior of $\theta_c$ gives per-cell uncertainty. Including the protected term avoids the attenuation factor above. The model is rejected if it fails the planted-type guardrail in B3 or the label-agreement guardrail in B2.

**Estimands.**

- Corrected expression $r_{gc}$: expression minus its least-squares projection on the cycle covariates, input log scale, centred per gene.
- Scores $s_c$: difference of mean log-normalised expression, in input log units, not standardised.
- Angle $\theta_c\in[0,2\pi)$: a position on a circle, identified up to rotation and reflection.
- Variance ratio $\rho$: the fraction of top-50-PC variance attributed to the cycle covariates after removal, divided by the same fraction before, per batch.
- Confounding $R^2(T\mid\mathbf x)$: the linear share of a type indicator's variance explained by the cycle covariates, in $[0,1]$.
- Label agreement: ARI and NMI between clusters and author labels, maximised over the resolution grid.
- Planted truth: $a_g$, $\theta_c$ and $T_c$ as generated in section 8.

**Variance attribution.** With $v_i$ the variance share of principal component $i$ of the evaluated matrix, $R^2_+=\max(0,R^2)$ and covariates $B=(S,G)$,

$$V(B)=\sum_{i=1}^{50}v_i\,R^2_+(\mathrm{PC}_i\mid B),\qquad \rho=\frac{V_{\mathrm{after}}(B)}{V_{\mathrm{before}}(B)},\qquad C=\max\!\Bigl(0,\,1-\frac{|V_{\mathrm{after}}-V_{\mathrm{before}}|}{V_{\mathrm{before}}}\Bigr).$$

"Before" uses uncorrected data and "after" the corrected matrix or embedding, aggregated per batch by nan-mean [R13]. $C$ rewards keeping variance and is zero once variance more than doubles, so it is a guardrail only.

**Assumptions and failure modes.** Regression and latent methods assume additive log-scale effects or a low-dimensional circle; error-free scores (in practice they are noisy functions of the regressed genes, so noise leaks into residuals); a covariate uncorrelated with protected biology, or modelled explicitly; and no second axis (stress, mitochondrial, differentiation) loading on the same genes. Seurat's ScaleData regresses inside scaling, which changes what residuals mean, so this task outputs unscaled residuals for every method. Phase rules differ across tools (section 4), so one cell can receive different labels; phase assignment belongs to cell-state.cell_cycle_phase_assignment. Library size can correlate with the scores and should be modelled jointly (covariate-adjustment.technical_covariate_regression). For latent methods, a score-based angle correlated with type lets the cycle axis absorb type structure.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Seurat CellCycleScoring with ScaleData regression | heuristic | Scores S and G2M against expression-matched controls, then regresses both scores out of each gene by least squares. | [R1, R2] |
| scanpy score_genes_cell_cycle with regress_out | heuristic | Binned control-gene scores, then per-gene Gaussian GLM residuals on the two scores. | [R4, R1] |
| ccRemover | hybrid | Projects out principal components of non-cell-cycle genes whose bootstrap cell-cycle excess is significant, up to four rounds. | [R5] |
| scLVM | model-based | Fits a variance decomposition with a cell-cycle random effect and subtracts its predicted effect from each gene. | [R6] |
| CycleVI | model-based | VAE with a circular phase latent, a Fourier decoder for cycle genes and an adversary that removes phase from the residual latent. | [R7] |
| Cyclum | model-based | Autoencoder with a circular bottleneck that learns periodic pseudotime (repository README). | [R8] |
| cyclone (scran) | heuristic | Marker-pair classifier that assigns phase by permutation scoring; used here only as a covariate source. | [R9] |
| tricycle | model-based | Transfer-learned predictor of continuous cell-cycle position from a reference. | [R10] |
| Revelio | model-based | Linear invertible transform that extracts cell-cycle information (repository README). | [R11] |
| peco | model-based | Periodic model of cell-cycle gene expression fitted to reference data, predicting continuous progression. | [R12] |

The published standard for removal is linear regression of Seurat or scanpy scores [R1, R4], and both appear as comparators in every benchmark. ccRemover is the main alternative that claims higher reliability [R5]. Cyclum, cyclone, tricycle, peco and Revelio are covariate sources or callouts and are not in the MCP enum.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| Seurat CellCycleScoring | control genes when NULL | min(length of S list, length of G2M list) | R/utilities.R:650-662 @ 5f67c70 |
| Seurat AddModuleScore (internal) | bins / controls | 24 / 100 | R/utilities.R:309-318 @ 5f67c70 |
| Seurat ScaleData | regression model | linear | R/preprocessing.R:5388-5394; RegressOutMatrix at 6473 @ 5f67c70 |
| Seurat phase rule | labels | G1 if all scores < 0; Undecided on ties | R/utilities.R:650-700 @ 5f67c70 |
| scanpy score_genes | control genes | 50, overridden to min(\|S\|,\|G2M\|) in score_genes_cell_cycle | src/scanpy/tools/_score_genes.py:102, 362 @ 8ed52d9 |
| scanpy score_genes | bins | 25 | src/scanpy/tools/_score_genes.py:104 @ 8ed52d9 |
| scanpy score_genes_cell_cycle | phase rule | default S; G2M if G2M > S; G1 if all scores < 0 | src/scanpy/tools/_score_genes.py:309-380 @ 8ed52d9 |
| scanpy regress_out | model | Gaussian GLM per gene; perfect separation yields zeros | src/scanpy/preprocessing/_simple.py:513, 649-684 @ 8ed52d9 |
| ccRemover | cutoff, max_it, nboot, ntop | 3, 4, 200, 10 | R/ccRemover.R:76, 186 @ 39249bf |
| scLVM | varianceDecomposition max_iter | 10 | scLVM/core.py:137 @ b6ada74 |
| scLVM | corrected expression | standardised Y minus predicted effect, rescaled | scLVM/core.py:260-284 @ b6ada74 |
| CycleVI | n_fourier; n_hidden / n_layers | 3; 128 / 1 | cyclevi/model.py:350-362 @ 6f79d1f |
| CycleVI | weight_decay | 1e-6 | cyclevi/model.py:178 @ 6f79d1f |
| CycleVI | scale_adversarial_loss | auto (equals 1 - kl_weight) | cyclevi/model.py:187, 260 @ 6f79d1f |
| CycleVI | adversary optimiser | Adam, lr 1e-3, eps 0.01 | cyclevi/model.py:318 @ 6f79d1f |
| CycleVI | initial angle | arctan2(G2M, S) mod 2 pi, then quantile transform | cyclevi/prepare.py:237-250 @ 6f79d1f |

## 5. Proposed singlet approach

**Routes.** seurat_regress and scanpy_regress are ported from permissive code and share one least-squares kernel. The scanpy GLM is Gaussian, so it reduces to least squares on the same covariates. The two therefore differ only in score binning (24 versus 25 bins) and tie rules, and both stay in the enum so that their comparator results are reproducible. ccremover is reimplemented from the published algorithm (reason in section 12). sclvm is ported for the linear mixed-model path only; the experimental GP-LVM path is a callout. cyclevi is ported as the latent baseline. Cyclum, cyclone, tricycle, peco and Revelio are callouts.

**Defaults an agent should use without asking.** Method seurat_regress; the built-in Tirosh-derived gene lists; a control size equal to the smaller list; 50 principal components; seed 0; no batch or protected labels. A removal should follow a low confounding summary. The decision threshold is not yet calibrated, so the tool reports the summary but does not enforce a cutoff.

**Core kernel.** The linear removal is a small, hot kernel with $k\le 3$ covariates. With $Y$ genes by cells and $\mathbf X$ cells by $k$ including the intercept, the residual is $R=Y-(YX)(X^\top X)^{-1}X^\top$. $YX$ is a sparse-by-dense product (cuSPARSE SpMM of width $k$), the inverse is $k\times k$, and the subtraction is a rank-$k$ dense update. Each gene is independent, so the kernel streams over gene blocks. Hand-written CUDA and cuSPARSE code is used only for this kernel. ccRemover's PCA and bootstrap use cuBLAS and cuSOLVER on the GPU. CycleVI and the proposed model use PyTorch with minibatches, following the scvi-tools-style training used by CycleVI [R7] and the covariate-conditioned VAE template [R16]. The corrected layer is dense, so atlas-scale output is written in gene blocks (P1).

**Falsification.** The proposed conditional model (section 3) enters the enum only after B3 and B2 meet their acceptance criteria. Until then, removal is conditioned on the confounding summary alone.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | X | float32 | Log-normalised expression; scaled data are refused |
| read | var_names | str | Gene symbols or Ensembl IDs, used to match gene lists |
| read | uns/cc_gene_sets | str lists | Built-in S and G2M lists when no lists are supplied |
| read | obs/batch | category | Batch labels named by `labels.batch_key` |
| read | obs/cell_type | category | Protected labels named by `labels.protect_key`; used only for the summary |
| write | obs/S_score, obs/G2M_score | float32 | Cycle scores per cell, in input log units |
| write | obs/cc_angle | float32 | Circular angle in [0, 2 pi); cyclevi only |
| write | layers/cc_removed | float32 | Corrected log expression; seurat_regress, scanpy_regress, ccremover, sclvm |
| write | obsm/X_cc_free | float32 | Cell-cycle-free latent embedding; cyclevi only |
| write | uns/cc_removal_report | dict | Method, parameters, per-batch variance and conservation, confounding summary |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "seurat_regress" | `seurat_regress`, `scanpy_regress`, `ccremover`, `sclvm`, `cyclevi` | Removal method. seurat_regress is linear and the default when the confounding summary is low. |
| `scoring` | object | — | — | Gene lists and control settings for the S and G2M scores used by every method. |
| `scoring.s_genes` | array | — | — | S-phase genes as symbols or Ensembl IDs; default is the built-in Tirosh-derived list. |
| `scoring.g2m_genes` | array | — | — | G2/M genes as symbols or Ensembl IDs; default is the built-in Tirosh-derived list. |
| `scoring.ctrl_size` | integer | — | min 1 | Control genes per score; default is the smaller of the two list lengths. Warns below about 20 genes. |
| `labels` | object | — | — | obs columns for batches and protected labels. |
| `labels.batch_key` | string/null | null | — | obs column of batch labels; scores and variance are computed per batch. Null means one batch. |
| `labels.protect_key` | string/null | null | — | obs column of protected labels such as cell type; enables the confounding summary. |
| `n_pcs` | integer | 50 | min 2 | Principal components used for the variance attribution before and after removal. |
| `ccremover` | object | — | — | Options for method ccremover. |
| `ccremover.cutoff` | number | 3 | — | Bootstrap t threshold for removing a principal component. |
| `ccremover.max_it` | integer | 4 | min 1 | Maximum removal rounds. |
| `ccremover.nboot` | integer | 200 | min 10 | Bootstrap replicates for the variability of each component's excess. |
| `ccremover.ntop` | integer | 10 | min 1 | Top components tested in each round. |
| `sclvm` | object | — | — | Options for method sclvm. |
| `sclvm.max_iter` | integer | 10 | min 1 | Maximum iterations of the variance decomposition in the linear mixed-model path (varianceDecomposition max_iter). |
| `cyclevi` | object | — | — | Options for method cyclevi. |
| `cyclevi.n_fourier` | integer | 3 | min 1 | Fourier harmonics in the cycle-gene decoder. |
| `cyclevi.n_hidden` | integer | 128 | min 8 | Hidden units in the decoder layer. |
| `cyclevi.adv_lr` | number | 0.001 | — | Adam learning rate for the phase adversary. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for control-gene sampling, ccRemover bootstraps and CycleVI training. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

`scoring` and `labels.batch_key` apply to every method. `labels.protect_key` changes only the confounding summary, never the correction, and `n_pcs` affects only the summary. Each method object applies only to its own method, and an option for another method is an error. Genes absent from the data are dropped and their count is reported, because a symbol-versus-Ensembl mismatch otherwise yields zero scored genes. The cyclevi method also uses the scores to set its initial angle.

## 7. MCP tool

Tool name `singlet_covariate_adjustment_cell_cycle_effect_removal` (definition in `tasks/mcp/singlet_covariate_adjustment_cell_cycle_effect_removal.json`). Example call and compact result, with placeholder values in angle brackets:

```json
{"dataset": "hsc.singlet", "method": "seurat_regress", "labels": {"batch_key": "batch", "protect_key": "cell_type"}, "seed": 0}
```

```json
{"dataset": "hsc.singlet", "status": "completed", "wrote": ["obs/S_score", "obs/G2M_score", "layers/cc_removed", "uns/cc_removal_report"],
 "summary": {"method": "seurat_regress", "variance_ratio": {"<batch>": "<float>"}, "cc_conservation": {"<batch>": "<float>"}, "confounding_r2": {"<cell_type>": "<float>"}},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: cyclevi and ccremover may return `queued` on large inputs; the linear methods are expected to complete inline. Stochastic: `seed` fixes control-gene sampling, ccRemover bootstraps and CycleVI training. Dry run: returns estimated seconds, peak memory and device without writing.

## 8. Benchmarks

**Shared protocol.** All benchmarks use one log-normalised input from a single size-factor normalisation, a fixed set of highly variable genes chosen before any correction, 50 principal components, and the same neighbour settings across methods. Each method uses the defaults of section 4 unless a benchmark says otherwise. Stochastic methods are summarised as median and range over seeds. Hardware, thread count and storage format are fixed and reported with every result. Comparators are uncorrected input, seurat_regress, scanpy_regress, ccremover, sclvm and cyclevi.

### B1. Cell-cycle variance removal on real data

- **Goal**: Measure how much of the cycle covariates' variance in the top 50 principal components each method removes, per batch, relative to uncorrected data.
- **Ground truth**: consistency, not an independent truth. The covariates are S and G2M scores computed on uncorrected data within each batch by the score method of section 4; the reported quantity is $\rho$ from section 3.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Nestorowa murine haematopoietic progenitor counts (corrected log2) | [R17]; http://blood.stemcells.cam.ac.uk/data/nestorowa_corrected_log2_transformed_counts.txt.gz | Murine haematopoietic progenitors; size — | — | Dataset of the scanpy cell-cycle how-to |
| singlet catalogue, author-annotated progenitor and mature lineages | singlet catalogue (internal, no accession) | scRNA-seq, species as annotated; subset of the 354M-cell catalogue (about 40% annotated) chosen for this benchmark | — | Same lineage families as B2 |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Variance ratio $\rho$ | $V_{\mathrm{after}}/V_{\mathrm{before}}$ for $B=(S,G2M)$ over 50 PCs; $R^2$ clipped at 0; per batch, nan-mean | minimise | primary | [R13] |
| Cell-cycle conservation $C$ | $\max(0,1-\lvert V_{\mathrm{after}}-V_{\mathrm{before}}\rvert/V_{\mathrm{before}})$; per batch, nan-mean | maximise | guardrail (reported only) | [R13] |

- **Comparators**: uncorrected input; seurat_regress; scanpy_regress; ccremover; sclvm; cyclevi.
- **Protocol**: score each batch on uncorrected data and compute $V_{\mathrm{before}}$ with one linear-regression backend throughout. Apply each method with its defaults, then compute $V_{\mathrm{after}}$ on the corrected layer, or on the cell-cycle-free embedding for cyclevi. Stochastic methods use seeds 0 to 2.
- **Acceptance criterion**: PROPOSED, not from the literature: $\rho\le 0.10$ on a dataset with a strong proliferation axis, with the B2 guardrail inside its threshold.
- **Known pitfalls**: the scores that define the removed covariate also define the metric, so evaluate on score genes disjoint from those removed where possible; $\rho$ is unstable when $V_{\mathrm{before}}$ is near zero after feature selection.

### B2. Retention of protected cell-type structure

- **Goal**: Check that removing the cycle axis does not erase author-labelled cell types, especially in proliferation-linked lineages.
- **Ground truth**: expert labels. Each annotated cell carries one author cell-type label. The estimands are ARI and NMI between Leiden clusters on the corrected embedding and these labels, maximised over the resolution grid; the label silhouette rescaled to $[0,1]$ as $(\mathrm{asw}+1)/2$; and $\Delta\mathrm{ARI}$, the corrected minus uncorrected ARI at the same resolutions.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| singlet catalogue, author-annotated progenitor and mature lineages | singlet catalogue (internal, no accession) | scRNA-seq, species as annotated; subset of the annotated cells chosen for this benchmark | — | Annotation provenance recorded per cell |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| ARI | Best over the resolution grid; Leiden on the corrected kNN graph | maximise | primary | [R13] |
| NMI | Same clusters, library-default normalisation | maximise | guardrail | [R13] |
| Silhouette | Label silhouette rescaled as $(\mathrm{asw}+1)/2$ | maximise | guardrail | [R13] |
| $\Delta$ARI | $\mathrm{ARI}_{\mathrm{corrected}}-\mathrm{ARI}_{\mathrm{uncorrected}}$ on the same grid; $\ge 0$ means no loss | maximise | guardrail | — |

- **Comparators**: uncorrected input; seurat_regress; scanpy_regress; ccremover; cyclevi.
- **Protocol**: fix the HVG set, 50 PCs and neighbour settings; embed each corrected matrix; cluster across the resolution grid; report per dataset and per lineage (progenitor versus mature), because proliferation-linked losses concentrate in progenitors. Seeds 0 to 2.
- **Acceptance criterion**: PROPOSED: $\Delta\mathrm{ARI}\ge -0.02$ on proliferation-confounded lineages, and ARI no worse than the best regression comparator minus 0.01.
- **Known pitfalls**: cycling clusters can be a genuine cell type, so "cycling" counts as a label only where annotated; silhouette depends on PC count and neighbour settings.

### B3. Planted cycle and type simulation (proposed)

- **Goal**: With exact truth, test whether removal keeps a planted type effect and removes the planted cycle across levels of cycle-type predictability.
- **Ground truth**: planted simulation of $\theta_c$, $T_c$, $a_g$ and cycle coefficients. Estimands: residual cycle $R^2$ on the true $K=3$ harmonics; AUROC for $a_g\neq 0$; attenuation deviation $\lvert\bar\Delta_g/a_g-(1-R^2(T\mid\mathbf x))\rvert$, with $\bar\Delta_g$ the corrected group difference on planted genes.

Generator recipe:

1. For seeds 0 to 9 and $n\in\{2{,}000;5{,}000\}$ cells, draw $\theta_c\sim\mathrm{Uniform}[0,2\pi)$.
2. Draw $T_c$ from a logistic model in $\cos(\theta_c-\varphi)$, with the slope set by bisection so that $R^2(T\mid\cos\theta,\sin\theta)$ equals 0, 0.25, 0.5 or 0.9.
3. Take $\mu_g$ from B2 gene means; set $a_g$ on a random gene subset from observed B2 type differences.
4. Draw $\alpha_{gk},\beta_{gk}\sim\mathcal N(0,\sigma_c^2)$, $k\le 3$, on a random gene subset; vary $\sigma_c$ over target variance shares.
5. Draw $y_{gc}=\mu_g+a_gT_c+\sum_k(\alpha_{gk}\cos k\theta_c+\beta_{gk}\sin k\theta_c)+\varepsilon_{gc}$; add noise on the log scale or as counts.
6. Use disjoint S and G2M gene sets among cycle-responsive genes; compute scores as in practice.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated per the recipe | simulated; no accession | Log or count expression; $n$ cells, 2,000 genes (proposed design) | — | Seeds 0 to 9 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Residual cycle $R^2$ | Mean over genes, corrected expression on the true $K=3$ harmonics | minimise | primary | — |
| Planted-type AUROC | Genes with $a_g\neq 0$ against the rest; Welch $t$ on corrected values | maximise | guardrail | — |
| Attenuation deviation | As defined above; regression methods only | minimise | guardrail | — |

- **Comparators**: seurat_regress; scanpy_regress; ccremover; cyclevi; oracle regression on the true harmonics (upper bound).
- **Protocol**: align latent angles for rotation and reflection before computing $R^2$.
- **Acceptance criterion**: PROPOSED: regression attenuation deviation at most 0.05; oracle residual $R^2$ at most 0.05; oracle AUROC at least 0.9.
- **Known pitfalls**: simulated phase is cleaner than real data, so add cycle-independent programmes and noise.

### P1. Performance and scaling

Wall time, peak memory and throughput at $10^4$, $10^5$ and $10^6$ cells, and at $10^7$ if streaming is claimed, on CPU and CUDA, for every method in section 8 and for uncorrected input. Also time the reference scanpy regress_out implementation, which fits one GLM per gene. Hold fixed 2,000 HVGs, 50 PCs, thread count, seed and storage format; report dense and sparse separately over three repeats. No timings are reported here. Hypotheses to test: the linear path is fastest and scales linearly in cells for fixed $k$; the per-gene GLM reference is slowest (inferred from its per-gene fitting). Acceptance criterion: PROPOSED; linear-path peak memory within a small constant factor of the dense corrected output, fixed after the first measurement.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `covariate-adjustment.covariate_variance_attribution`: Covariate variance attribution and confounding check before removal
- **Feeds**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `evaluation.overcorrection_detection`: Over-correction after batch or covariate removal
- **Reads**: `X`, `var_names`, `uns/cc_gene_sets`, `obs/batch`, `obs/cell_type`
- **Writes**: `obs/S_score`, `obs/G2M_score`, `obs/cc_angle`, `layers/cc_removed`, `obsm/X_cc_free`, `uns/cc_removal_report`
<!-- CHAINING:AUTO:END -->

Workflow: cell-cycle-aware preprocessing, in which size-factor normalisation comes first, the confounding summary is checked, this task removes the axis, and over-correction is checked before embedding and clustering.

## 10. Risks, pitfalls and open questions

- **Unverified claim.** A secondary summary of a Gaussian-mixture phase model (CycleMix) reports that Seurat and cyclone label mature non-cycling cells, such as neurons, as cycling on droplet data. It has not been checked and is not used as evidence here.
- **Evidence gaps.** No independent benchmark of lost non-cell-cycle biology after regression was identified. CycleVI's protein-level validation and drug-response results were not checked against the paper. No reporter-based cell-cycle dataset with an accession was identified, so an orthogonal-reporter benchmark is not defined.
- **Unsettled science.** The order of removal relative to batch correction is untested. The scanpy regress_out docstring warns that the function tends to overcorrect in certain circumstances, citing issue 526. Quiescent and G1 boundaries are unsettled.
- **Code and metadata gaps.** scLVM's GP-LVM path is experimental and imports limix_legacy, whose availability is untested. Cyclum's model defaults were not checked, and Revelio's invertibility claim is its README's. The ccRemover claims are not checked against the full paper. The resolution sweep follows scIB conventions, and its code was not checked; the scIB year is taken as 2022 (volume), while corpus records give 2021 (online).
- **Data and licence risk.** The Nestorowa matrix's size, cell labels and licence were not identified, so it is used only in B1. The catalogue is internal, so its redistribution terms need review before any cell-level results are published.
- **First experiment.** Check the seurat_regress implementation against the closed-form attenuation prediction using the B3 generator with seeds 0 to 9, then calibrate the confounding decision threshold on B1 and B2 before changing any default.

## 11. References

R1. Satija R, Farrell JA, Gennert D, Schier AF, Regev A. Spatial reconstruction of single-cell gene expression data. *Nature Biotechnology* 2015. doi:10.1038/nbt.3192 — verified (corpus)
R2. Stuart T, Butler A, Hoffman P, Hafemeister C, Papalexi E, Mauck WM, Hao Y, Stoeckius M, Smibert P, Satija R. Comprehensive integration of single-cell data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — verified (corpus)
R3. Tirosh I, Izar B, Prakadan SM, et al. Dissecting the multicellular ecosystem of metastatic melanoma by single-cell RNA-seq. *Science* 2016. doi:10.1126/science.aad0501 — verified (corpus)
R4. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)
R5. Barron M, Li J. Identifying and removing the cell-cycle effect from single-cell RNA-sequencing data. *Scientific Reports* 2016. doi:10.1038/srep33892 — verified (corpus)
R6. Buettner F, et al. Computational analysis of cell-to-cell heterogeneity in single-cell RNA-sequencing data reveals hidden subpopulations of cells. *Nature Biotechnology* 2015. doi:10.1038/nbt.3102 — verified (corpus)
R7. Mozdzanowski P, Tarbier M, Jeuken GS. CycleVI: Isolating cell cycle variation with an interpretable deep generative model. *Bioinformatics* 2026. doi:10.1093/bioinformatics/btag372 — verified (repo)
R8. Liang S, Wang F, Han J, Chen K. Latent periodic process inference from single-cell RNA-seq data. *Nature Communications* 2020. doi:10.1038/s41467-020-15295-9 — verified (repo)
R9. Scialdone A, Natarajan KN, Saraiva LR, Proserpio V, Teichmann SA, Stegle O, Marioni JC, Buettner F. Computational assignment of cell-cycle stage from single-cell transcriptome data. *Methods* 2015. doi:10.1016/j.ymeth.2015.06.021 — verified (corpus)
R10. Zheng SC, Stein-O’Brien G, Augustin J, et al. Universal prediction of cell cycle position using transfer learning. *Genome Biology* 2022. doi:10.1186/s13059-021-02581-y — verified (repo)
R11. Schwabe D, Formichetti S, Junker JP, Falcke M, Rajewsky N. The transcriptome dynamics of single cells during the cell cycle. *Molecular Systems Biology* 2020. doi:10.15252/msb.20209946 — verified (repo)
R12. Hsiao CJ, et al. Characterizing and inferring quantitative cell cycle phase in single-cell RNA-seq data analysis. *Genome Research* 2020. doi:10.1101/gr.247759.118 — verified (corpus)
R13. Luecken MD, Büttner M, Chaichoompu K, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2022. doi:10.1038/s41592-021-01336-8 — verified (corpus)
R14. Hafemeister C, Satija R. Normalization and variance stabilization of single-cell RNA-seq data using regularized negative binomial regression. *Genome Biology* 2019. doi:10.1186/s13059-019-1874-1 — verified (corpus)
R15. Lause J, Berens P, Kobak D. Analytic Pearson residuals for normalization of single-cell RNA-seq UMI data. *Genome Biology* 2021. doi:10.1186/s13059-021-02451-7 — verified (corpus)
R16. Lopez R, Regier J, Cole MB, Jordan MI, Yosef N. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)
R17. Nestorowa S, Hamey FK, Pijuan Sala B, et al. A single-cell resolution map of mouse hematopoietic stem and progenitor cell differentiation. *Blood* 2016. doi:10.1182/blood-2016-05-716480 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/satijalab/seurat | Seurat authors (LICENSE copyright holder; Authors@R in DESCRIPTION) | MIT (LICENSE file; DESCRIPTION) | Scoring and linear regression; comparator | port |
| https://github.com/scverse/scanpy | LICENSE copyright F. Alexander Wolf, P. Angerer, Theis Lab; pyproject.toml authors include Adam Gayoso, Alex Wolf, Davide Cittaro and Ilan Gold; maintainers Ilan Gold, Philipp Angerer, Severin Dicks | BSD-3-Clause (LICENSE; pyproject.toml) | score_genes and regress_out semantics; cell-cycle how-to notebook | port |
| https://github.com/cran/ccRemover | Jun Li (aut, cre); Martin Barron (aut) | GPL-3 (DESCRIPTION; no LICENSE file at repository root) | Algorithm for ccremover; CRAN mirror | reimplement |
| https://github.com/PMBio/scLVM | Florian Buettner, F Paolo Casale, Oliver Stegle | Apache-2.0 (license.txt; setup.py) | Variance decomposition and correction | port (linear mixed-model path); GP-LVM path callout |
| https://github.com/jeuken/CycleVI | Gustavo Jeuken (LICENSE copyright holder); Pia Mozdzanowski and Gustavo S. Jeuken (pyproject.toml) | BSD-3-Clause (LICENSE) | Latent baseline (cyclevi) | port |
| https://github.com/KChen-lab/cyclum | KChen-lab; Shaoheng Liang (setup.py) | MIT (LICENSE) | Latent comparator | callout |
| https://github.com/MarioniLab/scran | Aaron Lun (aut, cre); Karsten Bach (aut); further authors in DESCRIPTION | GPL-3 (DESCRIPTION; no LICENSE file at repository root) | cyclone phase classifier as covariate source | callout |
| https://github.com/hansenlab/tricycle | Shijie Zheng (aut, cre) (DESCRIPTION) | GPL-3 (DESCRIPTION; no LICENSE file at repository root) | Continuous position predictor | callout |
| https://github.com/danielschw188/Revelio | Not stated (DESCRIPTION is a template) | Not stated (DESCRIPTION is an unfilled template) | Linear transform (repository README) | callout |
| https://github.com/jhsiao999/peco | Chiaowen Joyce Hsiao (DESCRIPTION) | GPL (>= 3) (DESCRIPTION; LICENSE contains GPL-3 text) | Periodic phase model as covariate source | callout |

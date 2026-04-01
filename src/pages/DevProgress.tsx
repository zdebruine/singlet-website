import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { ArrowLeft, ChevronDown, ChevronRight, Lock } from "lucide-react";
import katex from "katex";
import "katex/dist/katex.min.css";

/* ── KaTeX helper ─────────────────────────────────────────────── */
const K = ({ math, display = false }: { math: string; display?: boolean }) => {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) {
      katex.render(math, ref.current, { displayMode: display, throwOnError: false });
    }
  }, [math, display]);
  return <span ref={ref} />;
};

/* ── Collapsible detail block ─────────────────────────────────── */
const Detail = ({ title, children }: { title: string; children: React.ReactNode }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border/60 rounded-lg mt-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-muted/30 transition-colors rounded-lg"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title}
      </button>
      {open && <div className="px-4 pb-4 text-sm text-muted-foreground space-y-3">{children}</div>}
    </div>
  );
};

/* ── Reusable table ───────────────────────────────────────────── */
const SubTable = ({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) => (
  <div className="overflow-x-auto mt-3">
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border">
          {headers.map((h) => (
            <th key={h} className="px-4 py-2 text-left font-semibold text-foreground whitespace-nowrap">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-b border-border/50">
            {row.map((cell, j) => (
              <td key={j} className={`px-4 py-2 ${j === 0 ? "font-medium text-foreground" : "text-muted-foreground"}`}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/* ── Section nav data ─────────────────────────────────────────── */
const sections = [
  { id: "overview", label: "Overview" },
  { id: "phase1-data", label: "1.1 Data Foundation" },
  { id: "phase1-nmf", label: "1.2 NMF Training" },
  { id: "phase1-annotation", label: "1.3 Factor Annotation" },
  { id: "phase1-encoder", label: "1.4 CPM Encoder" },
  { id: "phase1-generative", label: "1.5 Generative Capabilities" },
  { id: "phase1-ai", label: "1.6 AI Reasoning Layer" },
  { id: "phase1-releases", label: "1.7 Sub-Releases" },
  { id: "phase1-metrics", label: "1.8 Success Metrics" },
  { id: "phase1-confidence", label: "1.9 Confidence Scores" },
  { id: "phase1-crossspecies", label: "1.10 Cross-Species" },
  { id: "phase2", label: "Phase 2: v2.0" },
  { id: "phase3", label: "Phase 3: v3.0" },
  { id: "phase4", label: "Phase 4: v4.0" },
  { id: "timeline", label: "Execution Timeline" },
  { id: "dependencies", label: "Dependencies" },
  { id: "risks", label: "Risk Factors" },
];

/* ══════════════════════════════════════════════════════════════ */
const DevProgress = () => {
  const [active, setActive] = useState("overview");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );
    sections.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Header */}
      <section className="pt-36 pb-8 px-6">
        <div className="max-w-5xl mx-auto">
          <Link to="/invest" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8">
            <ArrowLeft size={14} /> Back
          </Link>
          <div className="flex items-center gap-2 mb-4">
            <Lock size={14} className="text-primary" />
            <p className="font-mono text-xs text-primary uppercase tracking-widest">Confidential — Development Roadmap</p>
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground tracking-tightest mb-2">
            Development Progress
          </h1>
          <p className="text-muted-foreground mt-4 max-w-3xl">
            Four-phase product roadmap: v1.0 Transcriptomics Intelligence → v2.0 Expanded Transcriptomics → v3.0 Genomics Intelligence → v4.0 Clinical Intelligence.
          </p>
          <div className="gradient-line mt-6" />
        </div>
      </section>

      {/* Content with sidebar */}
      <div className="max-w-5xl mx-auto px-6 pb-24 flex gap-10">
        {/* Scrollspy sidebar */}
        <nav className="hidden lg:block w-56 flex-shrink-0 sticky top-28 self-start max-h-[calc(100vh-8rem)] overflow-y-auto">
          <ul className="space-y-1 text-xs">
            {sections.map(({ id, label }) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className={`block px-3 py-1.5 rounded transition-colors ${active === id ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Sections */}
        <div className="flex-1 space-y-20 min-w-0">

          {/* ─── Overview ─── */}
          <section id="overview">
            <h2 className="font-display text-2xl font-bold text-foreground mb-3">Overview</h2>
            <SubTable
              headers={["Phase", "Name", "Core Capability", "Revenue Target"]}
              rows={[
                [<strong>v1.0</strong>, "Transcriptomics Intelligence", "Generative single-cell model + AI reasoning", "Pharma pilots, academic adoption"],
                [<strong>v2.0</strong>, "Expanded Transcriptomics", "Multi-modal prediction + splicing dynamics", "Pharma enterprise deals"],
                [<strong>v3.0</strong>, "Genomics Intelligence", "DNA sequence → single-cell prediction", "Diagnostics partnerships"],
                [<strong>v4.0</strong>, "Clinical Intelligence", "Variant → clinical consequence reasoning", "Clinical deployment, Epic integration"],
              ]}
            />
            <p className="text-sm text-muted-foreground mt-4">Each phase builds on the previous. v1.0 is the foundation — it must be shipped, validated, and monetized before v2.0 begins.</p>
          </section>

          {/* ─── 1.1 Data Foundation ─── */}
          <section id="phase1-data">
            <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Phase 1: v1.0 — Transcriptomics Intelligence</p>
            <h2 className="font-display text-2xl font-bold text-foreground mb-3">1.1 Data Foundation: 100M Human Transcriptomes</h2>
            <p className="text-muted-foreground mb-4">
              Target: ~100 million human single-cell transcriptomes, uniformly reprocessed from FASTQ, available by <strong>April 12, 2026</strong>.
            </p>

            <Detail title="1.1.1 Data Source and Scope">
              <p>All data from NCBI GEO, reprocessed through the <code>scgeo</code> pipeline from raw FASTQ reads (not author-processed counts). Produces:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>S/U/A count layers</strong> via simpleaf/alevin-fry for every sample</li>
                <li><strong>Kraken2 non-host classification</strong> per cell (bacteria, virus, fungi)</li>
                <li><strong>Unified gene references</strong> (GENCODE v44 human)</li>
                <li><strong>Consistent QC</strong> (doublet scoring, ambient RNA, mitochondrial fraction)</li>
              </ul>
              <p className="mt-2">Initial 100M cells: human-only, droplet-based (10x Chromium, Drop-seq, inDrop). Plate-based protocols deferred to v2.0.</p>
            </Detail>

            <Detail title="1.1.2 Metadata Annotations">
              <SubTable
                headers={["Annotation Source", "Fields", "Method"]}
                rows={[
                  ["Automated cell typing", "Cell type, cell state", "SingleR against curated atlases (HCA, Tabula Sapiens, LungMAP)"],
                  ["GEO/GSM metadata", "Tissue, disease, perturbation, assay, sex, dev stage", "LLM extraction from GEO series descriptions"],
                  ["Pipeline QC", "Doublet score, mito fraction, library size, S/U/A ratios", "Computed during reprocessing"],
                ]}
              />
              <p className="mt-2">Standardized to controlled vocabularies: Uberon (tissue), Cell Ontology (cell type), MONDO (disease), HsapDv (dev stage), ChEMBL/DrugBank (perturbation).</p>
            </Detail>

            <Detail title="1.1.3 Pipeline Failure Remediation">
              <p>Concurrent remediation of all human droplet-based series that failed in the first pass. Failure modes: corrupt FATSQs, unsupported barcode whitelists, genome reference mismatches, memory/timeout failures. <strong>Target:</strong> Recover 90%+ of failed series → 10–20M additional cells.</p>
            </Detail>
          </section>

          {/* ─── 1.2 NMF Training ─── */}
          <section id="phase1-nmf">
            <h2 className="font-display text-2xl font-bold text-foreground mb-3">1.2 NMF Model Training</h2>
            <p className="text-muted-foreground mb-4">
              Train NMF on 100M cells using speckled holdout CV, hierarchical depth evaluation, and CUDA streaming out-of-core multiplicative updates.
            </p>

            <Detail title="1.2.1 Rank Determination — Speckled Holdout Cross-Validation">
              <p>Optimal rank <K math="k" /> selected empirically via speckled holdout:</p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>Mask ~1% of nonzero entries in <K math="X" /> uniformly at random</li>
                <li>Train NMF on masked matrix for each candidate <K math="k \in \{256, 512, 1024, 2048, 4096\}" /></li>
                <li>Evaluate reconstruction on held-out entries</li>
                <li>Select rank at the reconstruction elbow</li>
              </ol>
              <p className="mt-2">Ranks constrained to powers of 2 for GPU tensor alignment efficiency.</p>
            </Detail>

            <Detail title="1.2.2 Hierarchical Depth Determination">
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>1 layer:</strong> <K math="X \approx W_1 H_1" /> — flat programs</li>
                <li><strong>2 layers:</strong> <K math="X \approx W_1 W_2 H_2" /> — coarse → fine hierarchy (tissue → cell type)</li>
                <li><strong>3 layers:</strong> <K math="X \approx W_1 W_2 W_3 H_3" /> — third level (risk of overfitting)</li>
              </ul>
              <p className="mt-2">Deeper model selected only if it justifies complexity with better reconstruction on the speckled holdout set at matched parameter count.</p>
            </Detail>

            <Detail title="1.2.3 Regularization Selection">
              <p><strong>Angular regularization:</strong></p>
              <div className="my-3 overflow-x-auto"><K math="\mathcal{L}_{\text{ang}} = \lambda_{\text{ang}} \sum_{j \neq j'} \max(0, \cos(W_{:,j}, W_{:,j'}) - \epsilon)^2" display /></div>
              <p>Penalizes cosine similarity between gene program columns — prevents near-duplicate programs. Tuned to maximize <em>revealable rank</em> (distinct programs with Jaccard distance {">"} 0.6).</p>

              <p className="mt-3"><strong>L1 sparsity:</strong></p>
              <div className="my-3 overflow-x-auto"><K math="\mathcal{L}_{\text{L1}} = \lambda_{\text{L1}}(\|W\|_1 + \|H\|_1)" display /></div>
              <p>Promotes sparse, interpretable programs. Tuned to maximize enrichment fraction (FDR {"<"} 0.05) while maintaining per-cell Gini {">"} 0.7.</p>

              <p className="mt-3"><strong>Combined objective:</strong></p>
              <div className="my-3 overflow-x-auto"><K math="\min_{W,H \geq 0} \|X - WH\|_F^2 + \lambda_{\text{L1}}(\|W\|_1 + \|H\|_1) + \lambda_{\text{ang}} \sum_{j \neq j'} \max(0, \cos(W_{:,j}, W_{:,j'}) - \epsilon)^2" display /></div>
            </Detail>

            <Detail title="1.2.4 Final Model Training">
              <p>Train definitive NMF on 100M cells (spliced counts). CUDA streaming engine features:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Out-of-core:</strong> Data streams from disk (StreamPress <code>.spz</code> format, ~10× compression) in column blocks</li>
                <li><strong>Multiplicative updates:</strong> Lee & Seung (1999) — guaranteed non-negativity at every iteration</li>
                <li><strong>CUDA acceleration:</strong> Double-buffered streaming I/O overlapped with GPU compute</li>
                <li><strong>Deep NMF:</strong> Alternating block coordinate descent for hierarchical models</li>
              </ul>
              <p className="mt-2">Estimate: 8× H100 GPUs, 30–130 GPU-hours.</p>
            </Detail>
          </section>

          {/* ─── 1.3 Factor Annotation ─── */}
          <section id="phase1-annotation">
            <h2 className="font-display text-2xl font-bold text-foreground mb-3">1.3 Factor Annotation</h2>
            <p className="text-muted-foreground mb-4">
              Every NMF gene program annotated with biological meaning via enrichment analysis and LLM-powered naming.
            </p>

            <Detail title="1.3.1 Quantitative Enrichment Analysis">
              <p>For each program: enrichment against GO, Reactome, KEGG pathways + mean activity across cell types/tissues/diseases.</p>
            </Detail>

            <Detail title="1.3.2 LLM-Powered Factor Naming">
              <p>LLM generates 2–4 word short names (e.g., "Hepatocyte lipid metabolism") and 3–5 sentence descriptions, validated against enrichment results.</p>
            </Detail>
          </section>

          {/* ─── 1.4 Conditional Program Encoder ─── */}
          <section id="phase1-encoder">
            <h2 className="font-display text-2xl font-bold text-foreground mb-3">1.4 Conditional Program Encoder (CPM)</h2>
            <p className="text-muted-foreground mb-4">
              Neural network mapping metadata conditions to NMF program activities, enabling generative prediction of cell states.
            </p>

            {/* Architecture diagram */}
            <div className="rounded-xl border border-border bg-card p-5 md:p-7 mb-4">
              <div className="flex flex-col md:flex-row items-center justify-center gap-3">
                {[
                  { label: "Metadata", sub: "species · tissue · cell type\ndisease · perturbation", accent: false },
                  { label: "Encoder fθ", sub: "cross-attention + MLP\nlearned embeddings", accent: true },
                  { label: "Activities ĥ", sub: "k interpretable dims\n\"lipid metabolism: 2.3\"", accent: true },
                  { label: "W · ĥ = x̂", sub: "one matrix multiply\n~30K genes decoded", accent: true },
                ].map((step, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <ChevronRight size={18} className="text-primary flex-shrink-0 hidden md:block" />}
                    <div className={`rounded-lg border px-5 py-3 text-center flex-1 min-w-[150px] ${step.accent ? "bg-primary/[0.05] border-primary/25" : "bg-muted/50 border-border"}`}>
                      <p className="font-mono text-xs font-bold text-foreground mb-0.5">{step.label}</p>
                      <p className="text-[10px] text-muted-foreground whitespace-pre-line leading-relaxed">{step.sub}</p>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>

            <Detail title="1.4.1 Architecture">
              <p>Multi-head cross-attention over 8 metadata embeddings (cell type, tissue, disease, stage, sex, perturbation, assay, donor):</p>
              <div className="my-3 overflow-x-auto"><K math="\text{Attention}(Q, K, V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V" display /></div>
              <p>MLP backbone: cross-attention → Linear(512) → LayerNorm → GELU → Dropout(0.1) → Linear(256) → bottleneck <K math="z \in \mathbb{R}^{256}" /></p>
              <p className="mt-2"><strong>Output heads</strong> (from <K math="z" />):</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Gate head: <K math="\alpha = W_\alpha \cdot z \in \mathbb{R}^k" /> — which programs are active</li>
                <li>Magnitude head: <K math="\mu = W_\mu \cdot z \in \mathbb{R}^k" /> — log-mean of active magnitudes</li>
                <li>Spread head: <K math="\sigma = \text{softplus}(W_\sigma \cdot z) \in \mathbb{R}_{>0}^k" /> — log-magnitude variance</li>
              </ul>
            </Detail>

            <Detail title="1.4.2 Spike-and-Slab Reparameterization">
              <div className="my-3 overflow-x-auto"><K math="h_j = g_j \cdot m_j" display /></div>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><K math="g_j \in \{0, 1\}" /> — binary gate (hard concrete relaxation during training)</li>
                <li><K math="m_j = \exp(\mu_j + \sigma_j \cdot \epsilon_j)" />, <K math="\epsilon_j \sim \mathcal{N}(0,1)" /> — log-normal magnitude</li>
              </ul>
              <p className="mt-2">A typical cell has ~20–50 active programs out of 2,048 (Gini {">"} 0.7). Spike-and-slab produces exact zeros for inactive programs — matching NMF structure by construction.</p>
            </Detail>

            <Detail title="1.4.3 Training Objective">
              <p><strong>Spike-and-slab NLL per program <K math="j" />:</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-2 my-2">
                <li>If <K math="h_j^* = 0" />: <K math="\ell_j = -\log(1 - \pi_j)" /></li>
                <li>If <K math="h_j^* > 0" />: <K math="\ell_j = -\log(\pi_j) - \log \mathcal{N}(\log h_j^* \mid \mu_j, \sigma_j^2)" /></li>
              </ul>
              <p><strong>Total loss:</strong></p>
              <div className="my-3 overflow-x-auto"><K math="\mathcal{L} = \sum_{j=1}^{k} \ell_j + \lambda_{\text{sparse}} \sum_j \pi_j + \lambda_{\text{consist}} \mathcal{L}_{\text{consist}} + \lambda_{\text{diversity}} \mathcal{L}_{\text{diversity}}" display /></div>
              <p>Sparsity (few active programs/cell), consistency (identical metadata → similar predictions), diversity (sampling recovers within-condition heterogeneity).</p>
            </Detail>

            <Detail title="1.4.5 Validation Protocol">
              <p>Hold out specific (tissue, disease) combinations — tests <strong>combinatorial generalization</strong>:</p>
              <SubTable
                headers={["Metric", "Target"]}
                rows={[
                  ["Program cosine similarity", <><K math="\cos(\hat{h}, h^*)" /> {">"} 0.8</>],
                  ["Per-gene reconstruction R²", <><K math="R^2" /> of <K math="W\hat{h}" /> vs <K math="Wh^*" /> {">"} 0.5</>],
                  ["Gate accuracy", "> 85%"],
                  ["Magnitude calibration", "Within 20%"],
                  ["Sparsity match (Gini)", "Within 0.05"],
                  ["Combinatorial generalization", "< 15% degradation on unseen combos"],
                ]}
              />
            </Detail>
          </section>

          {/* ─── 1.5 Generative Capabilities ─── */}
          <section id="phase1-generative">
            <h2 className="font-display text-2xl font-bold text-foreground mb-3">1.5 Generative Capabilities (v1.0 Launch)</h2>
            <p className="text-muted-foreground mb-4">Five core queries enabled at launch.</p>

            <div className="grid md:grid-cols-2 gap-4">
              {[
                { q: "What does this cell look like?", desc: "Fully specified condition → predicted expression + program decomposition + confidence intervals" },
                { q: "How does my gene express across cell types?", desc: "Gene + tissue + disease → expression across cell types, decomposed by program contributions" },
                { q: "How does this perturbation affect this cell?", desc: "Cell type + perturbation → program activity shift + gene-level changes" },
                { q: "What does this rare disease look like in other tissues?", desc: "Disease + measured tissue → predicted expression in unmeasured tissues" },
                { q: "Generate a reference panel", desc: "Condition + cell count → synthetic population with realistic heterogeneity" },
              ].map(({ q, desc }, i) => (
                <div key={i} className="rounded-xl border border-border bg-card p-4">
                  <p className="font-mono text-xs font-bold text-foreground mb-1">"{q}"</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ─── 1.6 AI Reasoning Layer ─── */}
          <section id="phase1-ai">
            <h2 className="font-display text-2xl font-bold text-foreground mb-3">1.6 AI Reasoning Layer (v1.0)</h2>
            <p className="text-muted-foreground mb-4">
              LLM translates natural language to structured query, calls CPM, synthesizes response. Exposes CPM as MCP tool.
            </p>

            <Detail title="1.6.1 Natural Language → Structured Query">
              <p>LLM (GPT-4o) parses user questions into structured API calls. Example:</p>
              <p className="italic text-foreground mt-2">"How does PCSK9 expression change in hepatocytes when you knock down LDLR?"</p>
              <p className="mt-2">→ Parses to differential_program query → executes CPM → synthesizes mechanistic response citing specific programs (e.g., Program 847: cholesterol biosynthesis, SREBP2-dependent).</p>
            </Detail>

            <Detail title="1.6.2 MCP Tool Exposure">
              <p>CPM exposed as MCP (Model Context Protocol) tool with 8 input parameters: species, cell_type, tissue, disease, sex, developmental_stage, perturbation, n_cells. Enables AI models to call <code>predict_expression</code> programmatically for multi-step reasoning.</p>
            </Detail>

            <Detail title="1.6.3 Plot Code Generation">
              <p>AI generates executable Python/R code for UMAP, violin, heatmap, volcano plots. Code executed in sandboxed environment, plots returned with interpretation.</p>
            </Detail>
          </section>

          {/* ─── 1.7 Sub-Releases ─── */}
          <section id="phase1-releases">
            <h2 className="font-display text-2xl font-bold text-foreground mb-3">1.7 v1.0 Sub-Releases</h2>
            <SubTable
              headers={["Version", "Capability Added"]}
              rows={[
                [<strong>v1.0-alpha</strong>, "NMF model trained, factor annotations, NNLS projection API"],
                [<strong>v1.0-beta</strong>, "CPM encoder deployed (fully specified), confidence scores + empirical p-values"],
                [<strong>v1.0</strong>, "AI reasoning layer, MCP tool, natural language queries, plot generation"],
                [<strong>v1.1</strong>, "Composition head for underspecified queries (tissue atlas generation)"],
                [<strong>v1.2</strong>, "Expanded human data (~300M+ cells), retrained NMF + encoder"],
                [<strong>v1.3</strong>, "Cross-species alignment — mouse, then top-10 model organisms (201 species)"],
                [<strong>v1.4</strong>, "Multi-species CPM encoder + cross-species reasoning in AI layer"],
              ]}
            />
          </section>

          {/* ─── 1.8 Success Metrics ─── */}
          <section id="phase1-metrics">
            <h2 className="font-display text-2xl font-bold text-foreground mb-3">1.8 v1.0 Success Metrics</h2>
            <SubTable
              headers={["Metric", "Target"]}
              rows={[
                ["NMF reconstruction accuracy", <><K math="R^2 > 0.3" /> (speckled holdout)</>],
                ["Programs with meaningful annotation", "> 80% enrichment FDR < 0.05"],
                ["Revealable rank", "> 75% of k programs unique (Jaccard > 0.6)"],
                ["Encoder combinatorial generalization", "< 15% degradation on held-out combos"],
                ["Gate accuracy", "> 85% correct active/inactive calls"],
                ["Confidence calibration", "90% CI covers 90% ± 3%"],
                ["P-value discrimination", "AUROC > 0.85 for in-distribution vs OOD"],
                ["Cross-species transfer (v1.3+)", "> 70% correct cell type transfer (mouse→human)"],
                [<>Adapter cycle fidelity (v1.3+)</>, <><K math="\|H_m - A^T A H_m\|_F^2 / \|H_m\|_F^2 < 0.05" /></>],
                ["Query latency (point)", "< 200ms"],
                ["Query latency (100-cell gen)", "< 2s"],
              ]}
            />
          </section>

          {/* ─── 1.9 Confidence Scores ─── */}
          <section id="phase1-confidence">
            <h2 className="font-display text-2xl font-bold text-foreground mb-3">1.9 Prediction Confidence Scores and Empirical P-Values</h2>
            <p className="text-muted-foreground mb-4">
              Every prediction carries quantitative confidence grounded in cross-validation performance — not theoretical uncertainty, but empirical accuracy on held-out data.
            </p>

            <Detail title="1.9.2 Cross-Validation Design">
              <p><strong>Structured holdout scheme:</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Level 1 — Interpolation:</strong> Random cells within known combos (easiest)</li>
                <li><strong>Level 2 — Single-axis extrapolation:</strong> All cells of one metadata value (e.g., all hepatocytes)</li>
                <li><strong>Level 3 — Combinatorial extrapolation:</strong> Multi-axis combos (e.g., all hepatocyte + NASH cells — hardest)</li>
              </ul>
              <p className="mt-2">
                For each held-out combo: cosine similarity, gate accuracy, magnitude error, per-gene <K math="R^2" />.
              </p>
            </Detail>

            <Detail title="1.9.3 Empirical Null Distribution">
              <p>At inference, characterize prediction by metadata distance to training data:</p>
              <div className="my-3 overflow-x-auto"><K math="p = \Pr(\text{accuracy} \geq \hat{a} \mid \text{null model at distance } d)" display /></div>
              <p>Null from worst-performing holdout combinations at similar distances. Regression model maps (distance, holdout level, n_nearby_cells) → expected accuracy.</p>
            </Detail>

            <Detail title="1.9.5 Calibration Requirement">
              <p>Enforced via Platt scaling, temperature scaling, and calibration curve monitoring. Max deviation {"<"} 3%. <strong>v1.0-beta launch requirement</strong> — no prediction ships without a confidence score.</p>
            </Detail>
          </section>

          {/* ─── 1.10 Cross-Species Alignment ─── */}
          <section id="phase1-crossspecies">
            <h2 className="font-display text-2xl font-bold text-foreground mb-3">1.10 Cross-Species Alignment (v1.3–v1.4)</h2>
            <p className="text-muted-foreground mb-4">
              Extends model to 201 species via cycle-consistent adapter NMF without paired cells or gene homology.
            </p>

            <Detail title="1.10.2 Cycle-Consistent Adapter NMF">
              <p>Learn adapter <K math="A \in \mathbb{R}_{\geq 0}^{k_h \times k_m}" /> mapping mouse → human program space, with <K math="B = A^T" /> as reverse:</p>
              <div className="my-3 overflow-x-auto">
                <K math="\mathcal{L} = \|X_m - W_m H_m\|_F^2 + \lambda_{\text{cyc}}(\|H_m - A^T A H_m\|_F^2 + \|H_h - A A^T H_h\|_F^2) + \lambda_{\text{str}}\|C_h - A C_m A^T\|_F^2" display />
              </div>
              <p>Non-negativity + approximate orthogonality forces <K math="A" /> toward a <strong>permutation matrix</strong> — crisp 1-to-1 program correspondences. Optimized via multiplicative updates on CUDA.</p>
            </Detail>

            <Detail title="1.10.3 Hub-and-Spoke Architecture">
              <p>Human is the hub. One adapter per species. Cross-species transfer routes through human:</p>
              <div className="my-3 overflow-x-auto"><K math="\hat{h}_{\text{zebrafish}} = (A^{(\text{zf})})^T \cdot A^{(\text{mouse})} \cdot h_{\text{mouse}}" display /></div>
              <p>Avoids <K math="O(N^2)" /> pairwise adapters. New species added without retraining existing adapters.</p>
            </Detail>

            <Detail title="1.10.5 Cross-Species Confidence Scores">
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><K math="S_{jj} = (A^T A)_{jj}" />: Round-trip fidelity. Near 1.0 = conserved. Near 0 = species-divergent.</li>
                <li><K math="(I - AA^T)_{ii}" />: Identifies human-specific programs absent from other species.</li>
                <li>Structural residual per program block quantifies geometry transfer quality.</li>
              </ul>
              <p className="mt-2">These are direct outputs of adapter algebra — ground-truth confidence without calibration.</p>
            </Detail>
          </section>

          {/* ─── Phase 2: v2.0 ─── */}
          <section id="phase2">
            <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Phase 2</p>
            <h2 className="font-display text-2xl font-bold text-foreground mb-3">v2.0 — Expanded Transcriptomics Intelligence</h2>
            <p className="text-muted-foreground mb-4">
              Scales to 500M–1B cells, adds multi-modal prediction (ATAC, CITE-seq, Visium), splicing dynamics, and next-cell prediction.
            </p>

            <Detail title="2.1 Expanded Data Corpus">
              <p>Integrate plate-based protocols (Smart-seq2, CEL-seq2) requiring assay-aware normalization. <strong>Target:</strong> ~500M–1B human cells. Re-run full rank/depth/regularization protocol on expanded corpus.</p>
            </Detail>

            <Detail title="2.2 Multi-Modal Prediction">
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>ATAC-seq:</strong> Train NMF on peaks from 10x Multiome → predict chromatin accessibility from condition metadata</li>
                <li><strong>CITE-seq:</strong> Predict surface protein expression (ADT counts) — relevant for flow panel design and CAR-T targets</li>
                <li><strong>Spatial (10x Visium):</strong> Deconvolve spots → cell type proportions, predict spatial neighborhoods</li>
              </ul>
            </Detail>

            <Detail title="2.3 Splicing Dynamics & Next-Cell Prediction">
              <p>Factor velocities: <K math="V_j = H_{U,j} - \gamma \odot H_{S,j}" /> — direction of transcriptional trajectory in program space.</p>
              <p className="mt-2">Next-cell prediction head on the encoder: <K math="h_{\text{next}} = f_{\theta,\text{next}}(z)" /> → chain predictions for full trajectory reconstruction (naive → activated → effector).</p>
            </Detail>

            <Detail title="2.4 Composition Head">
              <p>Predicts cell type proportions via <K math="\pi = \text{softmax}(W_\pi \cdot z)" /> when cell type unspecified. Label dropout during training (<K math="p_{\text{drop}} \sim 0.1{-}0.3" />). Unlocks: "Generate a complete fetal lung atlas at gestational week 32."</p>
            </Detail>

            <Detail title="2.6 v2.0 Success Metrics">
              <SubTable
                headers={["Metric", "Target"]}
                rows={[
                  ["RNA → ATAC prediction", "Pearson r > 0.6 per peak"],
                  ["Spatial neighbor prediction", "Top-5 accuracy > 40%"],
                  ["Next-cell prediction", "Cosine sim > 0.7"],
                  ["Composition head calibration", "KL divergence < 0.1"],
                  ["Multi-modal query success", "> 80% biologically plausible (expert eval)"],
                ]}
              />
            </Detail>
          </section>

          {/* ─── Phase 3: v3.0 ─── */}
          <section id="phase3">
            <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Phase 3</p>
            <h2 className="font-display text-2xl font-bold text-foreground mb-3">v3.0 — Genomics Intelligence</h2>
            <p className="text-muted-foreground mb-4">
              Bridges DNA sequence to single-cell transcriptomics prediction via sequence-to-function models.
            </p>

            <Detail title="3.1 The Bridge: DNA → Single-Cell">
              <p><strong>Sequence-to-Function Foundation:</strong> Train model (or fine-tune Borzoi, Apache 2.0) on GTEx to predict gene expression + chromatin accessibility + splicing from DNA sequence ±500kb per gene.</p>
              <p className="mt-2"><strong>Single-Cell Prediction Head:</strong> Extend trunk with cell-type-conditioned head predicting program activities in NMF space. Trained on TenK10K paired WGS + scRNA-seq (~5M+ cells).</p>
              <p className="mt-2"><strong>Unlocks:</strong> For any variant (SNP, indel, SV), predict cell-type-specific transcriptional consequences — not just "this gene changes" but "Program 847 (hepatocyte cholesterol biosynthesis) is disrupted."</p>
            </Detail>

            <Detail title="3.2 Variant Interpretation at Single-Cell Resolution">
              <p>For each variant: <K math="\Delta h = h_{\text{alt}} - h_{\text{ref}}" /> across all (cell type, tissue) combinations. Map to gene-level changes via <K math="W \cdot \Delta h" />.</p>
              <p className="mt-2"><strong>Validation:</strong> TenK10K held-out donors, ClinVar pathogenic variants ({">"} 60% top program matches known mechanism), rare disease blood draws with tissue extrapolation.</p>
            </Detail>

            <Detail title="3.3 v3.0 Success Metrics">
              <SubTable
                headers={["Metric", "Target"]}
                rows={[
                  ["Genotype → expression (GTEx)", "Pearson r > 0.7 per gene"],
                  ["Genotype → scRNA (TenK10K)", "Cosine sim > 0.6 per cell type"],
                  ["ClinVar variant effect", "Top program matches mechanism > 60%"],
                  ["Rare disease blood draw", <><K math="R^2 > 0.4" /> per gene</>],
                ]}
              />
            </Detail>
          </section>

          {/* ─── Phase 4: v4.0 ─── */}
          <section id="phase4">
            <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Phase 4</p>
            <h2 className="font-display text-2xl font-bold text-foreground mb-3">v4.0 — Clinical Intelligence</h2>
            <p className="text-muted-foreground mb-4">
              Clinical variant reasoning via fine-tuned LLM with MCP access to full v1.0–v3.0 stack, Epic EHR integration, and FDA pathway.
            </p>

            <Detail title="4.1 Clinical Variant Reasoning">
              <p>Clinical LLM chains genomic prediction → transcriptomic analysis → literature grounding → clinical reasoning. Trained on thousands of PubMed case reports. Validated on 1,000+ held-out cases — must outperform ClinVar, PolyPhen, SIFT on VUS variants.</p>
            </Detail>

            <Detail title="4.2 Clinical Product Development">
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Epic App Orchard:</strong> Genetic test → VUS triggers app → mechanistic explanation + affected tissues + confidence score embedded in chart</li>
                <li><strong>FDA Pathway:</strong> Initial "information only" (CDS exemption under 21st Century Cures Act); pursue 510(k) once validated</li>
                <li><strong>Clinical Pilots:</strong> 2–3 academic medical centers, 100+ cases per site, publish in clinical genetics journals</li>
              </ul>
            </Detail>

            <Detail title="4.3 v4.0 Success Metrics">
              <SubTable
                headers={["Metric", "Target"]}
                rows={[
                  ["Clinical case prediction", "> 70% of clinical details correct"],
                  ["VUS reclassification rate", "> 20% get mechanistic explanation"],
                  ["Clinician satisfaction", "NPS > 50"],
                  ["Time to diagnosis (rare disease)", "< 1 year (from 5–7 years)"],
                ]}
              />
            </Detail>
          </section>

          {/* ─── Execution Timeline ─── */}
          <section id="timeline">
            <h2 className="font-display text-2xl font-bold text-foreground mb-3">Execution Timeline</h2>
            <div className="space-y-4">
              {[
                { q: "2026 Q2", label: "v1.0-alpha", items: ["100M cells processed", "Rank/depth/regularization determined", "NMF trained, annotations complete", "NNLS projection API live"] },
                { q: "2026 Q3", label: "v1.0-beta", items: ["Encoder trained + validated", "Empirical p-values + confidence scores", "Calibration verified (90% CI ± 3%)", "Generation API live", "Pipeline remediation → +10–20M cells"] },
                { q: "2026 Q3", label: "v1.0", items: ["Natural language queries", "MCP tool exposure", "Plot generation", "First pharma pilot conversations"] },
                { q: "2026 Q3–Q4", label: "v1.1", items: ["Composition head", "Underspecified query support", "Tissue atlas generation"] },
                { q: "2026 Q4", label: "v1.2", items: ["~300M+ cells from remediation", "Retrained NMF + encoder"] },
                { q: "2026 Q4", label: "v1.3–v1.4", items: ["Mouse adapter (Algorithm 1)", "Hub-and-spoke (201 species)", "Multi-species encoder + AI reasoning", "Pre-seed raise"] },
                { q: "2027 Q1", label: "v2.0", items: ["Full human corpus (500M–1B)", "ATAC + CITE-seq + Visium", "Splicing dynamics / next-cell prediction"] },
                { q: "2027 Q2", label: "v3.0", items: ["GTEx + sequence model", "TenK10K bridge training", "Variant effect prediction + ClinVar validation"] },
                { q: "Post seed", label: "v4.0", items: ["Clinical LLM fine-tuning", "Epic App Orchard", "Clinical partner pilots", "FDA pathway analysis"] },
              ].map(({ q, label, items }) => (
                <div key={label} className="flex gap-4">
                  <div className="w-28 flex-shrink-0 text-right">
                    <p className="font-mono text-xs text-primary font-bold">{q}</p>
                  </div>
                  <div className="border-l-2 border-primary/30 pl-4 pb-2">
                    <p className="font-display text-sm font-bold text-foreground mb-1">{label}</p>
                    <ul className="text-xs text-muted-foreground space-y-0.5">
                      {items.map((item, i) => <li key={i}>• {item}</li>)}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ─── Technical Dependencies ─── */}
          <section id="dependencies">
            <h2 className="font-display text-2xl font-bold text-foreground mb-3">Technical Dependencies</h2>
            <div className="rounded-xl border border-border bg-card p-5 font-mono text-xs text-muted-foreground space-y-1">
              <p>v1.0-alpha ← 100M cells + CUDA NMF + StreamPress</p>
              <p>v1.0-beta  ← alpha + encoder + holdout CV + confidence</p>
              <p>v1.0       ← beta + LLM integration + MCP</p>
              <p>v1.1       ← v1.0 + composition head</p>
              <p>v1.2       ← v1.1 + expanded data (~300M+)</p>
              <p>v1.3       ← v1.2 + species NMF + cycle-consistent adapters</p>
              <p>v1.4       ← v1.3 + multi-species encoder + AI</p>
              <p>v2.0       ← v1.4 + multiome/Visium + splicing</p>
              <p>v3.0       ← v2.0 + GTEx + TenK10K + sequence model</p>
              <p>v4.0       ← v3.0 + clinical corpus + Epic + regulatory</p>
            </div>
          </section>

          {/* ─── Risk Factors ─── */}
          <section id="risks">
            <h2 className="font-display text-2xl font-bold text-foreground mb-3">Risk Factors</h2>

            <Detail title="v1.0 Risks">
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>NMF rank suboptimal at 100M cells:</strong> Re-run rank selection at v1.2</li>
                <li><strong>Encoder overfits:</strong> Held-out combo testing, label noise, dropout</li>
                <li><strong>Noisy cell type annotations:</strong> Cross-reference with author annotations; soft labels</li>
                <li><strong>AI hallucination:</strong> Every claim traced to specific program + enrichment</li>
                <li><strong>Poor confidence calibration:</strong> Platt scaling + continuous monitoring</li>
                <li><strong>Cross-species adapter underfit:</strong> Start frozen (Alg 1), escalate to joint (Alg 2) if needed</li>
              </ul>
            </Detail>

            <Detail title="v2.0 Risks">
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Plate-based integration:</strong> Assay-aware encoder terms + integration metrics</li>
                <li><strong>Cross-modal noise:</strong> Start with gold-standard paired datasets (10x Multiome)</li>
                <li><strong>Splicing dynamics complexity:</strong> Additive encoder head, NMF unchanged</li>
              </ul>
            </Detail>

            <Detail title="v3.0 Risks">
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>TenK10K is blood-dominated:</strong> GTEx tissue priors + emerging multi-tissue datasets</li>
                <li><strong>Massive compute:</strong> Use pre-trained Borzoi (Apache 2.0)</li>
                <li><strong>Subtle variant effects:</strong> Focus on high-penetrance rare variants first</li>
              </ul>
            </Detail>

            <Detail title="v4.0 Risks">
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Regulatory uncertainty:</strong> Launch as "information only" CDS first</li>
                <li><strong>Expensive clinical validation:</strong> Academic partnerships (shared cost)</li>
                <li><strong>LLM reliability:</strong> Confidence scores + mandatory human review</li>
              </ul>
            </Detail>
          </section>

          {/* ─── Back link ─── */}
          <div className="text-center pt-8">
            <Link to="/invest" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft size={14} className="inline mr-1.5" />Back to Investor Overview
            </Link>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default DevProgress;

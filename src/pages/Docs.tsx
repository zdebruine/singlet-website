import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Lock, Crown, Copy, Check,
  Cpu, Zap, Package, Github,
  Search, Filter, BarChart3, FlaskConical,
  Key,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

/* ── Scrollspy ── */
function useScrollspy(ids: string[], offset = 120) {
  const [activeId, setActiveId] = useState(ids[0]);
  useEffect(() => {
    const onScroll = () => {
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= offset) current = id;
      }
      setActiveId(current);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [ids, offset]);
  return activeId;
}

/* ── Code Block ── */
const CodeBlock = ({
  code,
  pro = false,
  title,
  comment,
}: {
  code: string;
  pro?: boolean;
  title?: string;
  comment?: string;
}) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`rounded-lg border overflow-hidden my-4 ${pro ? "border-primary/30 bg-primary/[0.02]" : "border-border"}`}>
      {(title || pro) && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-muted/30">
          <div className="flex items-center gap-2">
            {title && <span className="text-xs font-mono text-muted-foreground">{title}</span>}
            {pro && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-primary/15 text-primary">
                <Crown size={10} /> Pro
              </span>
            )}
          </div>
          <button onClick={copy} className="text-muted-foreground hover:text-foreground transition-colors p-1">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      )}
      <div className="relative">
        {!title && !pro && (
          <button onClick={copy} className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors p-1 z-10">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        )}
        <pre className="p-4 overflow-x-auto">
          <code className="font-mono text-xs leading-6 text-foreground">{code}</code>
        </pre>
      </div>
      {comment && (
        <div className="px-4 py-2 border-t border-border/50 bg-muted/20">
          <p className="text-[11px] text-muted-foreground italic">{comment}</p>
        </div>
      )}
    </div>
  );
};

/* ── Pro gate callout ── */
const ProGate = ({ feature }: { feature: string }) => (
  <div className="rounded-lg border border-primary/20 bg-primary/[0.04] px-4 py-3 my-4 flex items-start gap-3">
    <Lock size={14} className="text-primary mt-0.5 flex-shrink-0" />
    <div>
      <p className="text-xs text-foreground font-medium">{feature} — free tier included, Pro for higher limits.</p>
      <Link to="/pricing" className="text-xs text-primary hover:underline">See plans →</Link>
    </div>
  </div>
);

/* ── Tier badge ── */
const TierBadge = ({ tier }: { tier: string }) => {
  if (tier === "free") return null;
  const isAcademic = tier === "academic";
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider flex-shrink-0 ${isAcademic ? "bg-emerald-500/15 text-emerald-600" : "bg-primary/15 text-primary"
      }`}>
      {!isAcademic && <Crown size={8} />} {tier}
    </span>
  );
};

/* ── Section anchors ── */
const SECTIONS = [
  { id: "install", label: "Install" },
  { id: "quickstart", label: "Quick Start" },
  { id: "predict", label: "Predict" },
  { id: "generate", label: "Generate" },
  { id: "analyze", label: "Analyze" },
  { id: "mcp", label: "MCP Tools" },
  { id: "reference", label: "API Reference" },
  { id: "citation", label: "Citation" },
] as const;

/* ── Grouped API Reference table ── */
const RefGroup = ({
  icon,
  label,
  fns,
}: {
  icon: React.ReactNode;
  label: string;
  fns: { fn: string; desc: string; tier: string }[];
}) => (
  <>
    <h3 className="font-display text-base font-semibold text-foreground mb-4 flex items-center gap-2">
      {icon} {label}
    </h3>
    <div className="rounded-lg border border-border divide-y divide-border mb-8 overflow-hidden">
      {fns.map((item) => (
        <div key={item.fn} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-4 py-3">
          <code className="font-mono text-xs text-foreground break-all sm:whitespace-nowrap flex-shrink-0 mt-0.5">{item.fn}</code>
          <span className="text-xs text-muted-foreground flex-1">{item.desc}</span>
          <TierBadge tier={item.tier} />
        </div>
      ))}
    </div>
  </>
);

/* ══════════════════════════════════════════════════════════════════
   PAGE
   ══════════════════════════════════════════════════════════════════ */
const Docs = () => {
  const sectionIds = SECTIONS.map((s) => s.id);
  const activeId = useScrollspy(sectionIds);
  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* ═══ HERO ═══ */}
      <section className="pt-28 pb-14 md:pt-32 md:pb-16 px-6 border-b border-border relative">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] rounded-full bg-primary/[0.05] blur-[100px]" />
        </div>
        <div className="max-w-4xl mx-auto relative">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/[0.08] text-xs font-mono text-primary mb-4">
            Python API
          </span>
          <h1 className="font-display text-4xl md:text-6xl font-bold text-foreground tracking-tightest mb-4">
            <span className="font-mono">singlet</span>
          </h1>
          <p className="text-base md:text-lg text-muted-foreground max-w-2xl leading-relaxed mb-6">
            Predict expression for any condition. Generate cells on your device. Analyze with interpretable programs.{" "}
            <span className="gradient-text font-semibold">All from one package.</span>
          </p>
          <div className="flex flex-wrap gap-3">
            <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-muted border border-border font-mono text-sm text-foreground">
              pip install singletai
            </div>
            <a href="https://github.com/singletdb/singlet" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground transition-colors">
              <Github size={16} /> GitHub
            </a>
            <a href="https://pypi.org/project/singlet/" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground transition-colors">
              <Package size={16} /> PyPI
            </a>
          </div>
        </div>
      </section>

      {/* ═══ SIDEBAR + CONTENT ═══ */}
      <div className="max-w-7xl mx-auto flex">
        <nav className="hidden lg:flex fixed left-0 top-16 bottom-0 w-56 flex-col justify-center pl-8 pr-4 z-30">
          <ul className="space-y-3">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => scrollTo(s.id)}
                  className={`text-left text-[13px] leading-tight transition-all duration-200 ${activeId === s.id
                      ? "text-primary font-semibold translate-x-1"
                      : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="lg:ml-56 flex-1 max-w-3xl mx-auto px-6 lg:px-10 pb-24">

          {/* ────────────────────────── INSTALL ────────────────────────── */}
          <section id="install" className="pt-16">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6">Install</h2>

            <CodeBlock
              code={`pip install singletai\n\n# GPU acceleration (optional)\npip install singletai[cuda]`}
              title="Terminal"
            />

            <div className="rounded-lg border border-border bg-card p-5 mt-4">
              <h4 className="font-display text-sm font-semibold text-foreground mb-2">Requirements</h4>
              <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                <div><span className="text-foreground font-medium">Python</span> ≥ 3.9</div>
                <div><span className="text-foreground font-medium">PyTorch</span> ≥ 2.0</div>
                <div><span className="text-foreground font-medium">CUDA</span> ≥ 11.8 (optional)</div>
                <div><span className="text-foreground font-medium">Memory</span> 4 GB+</div>
              </div>
            </div>

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8 flex items-center gap-2">
              <Key size={14} className="text-primary" /> API Key
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              Downloads and inference require a free API key.{" "}
              <Link to="/pricing" className="text-primary hover:underline">Create one here</Link>, then configure:
            </p>

            <CodeBlock
              code={`# Environment variable (recommended for servers & CI)\nexport SINGLET_API_KEY="sdb_live_..."\n\n# Or: programmatic login\nsinglet.login(key="sdb_live_...")\n\n# Or: config file at ~/.config/singlet/credentials (0600 permissions)`}
              title="Authentication"
            />

            <div className="rounded-lg border border-border overflow-x-auto mt-4 mb-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-2.5 text-left font-semibold text-foreground">Tier</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-foreground">Functions</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["No key needed", "programs(), pp.*, tl.pca(), tl.umap(), DataLoader — all local analysis"],
                    ["Free key", "predict(), compare(), perturb(), gene_profile(), generate(), MCP tools"],
                    ["Pro ($100/mo)", "Batch API, BYOD, higher rate limits"],
                  ].map((row) => (
                    <tr key={row[0]} className="border-b border-border/50">
                      <td className="px-4 py-2 font-medium text-foreground whitespace-nowrap">{row[0]}</td>
                      <td className="px-4 py-2 font-mono text-muted-foreground">{row[1]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground">
              Keys use prefixes: <code className="bg-muted px-1 py-0.5 rounded text-[11px]">sdb_live_</code> (production), <code className="bg-muted px-1 py-0.5 rounded text-[11px]">sdb_test_</code> (sandbox).
              Never commit keys to version control. <Link to="/pricing" className="text-primary hover:underline">Rate limits &amp; plans →</Link>
            </p>
          </section>

          <div className="glow-line mx-auto" />

          {/* ────────────────────────── QUICK START ────────────────────────── */}
          <section id="quickstart" className="pt-20">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6">Quick Start</h2>

            <CodeBlock
              code={`import singlet

# Predict expression for any condition — returns named biological programs
result = singlet.predict(
    species="human", tissue="liver",
    cell_type="hepatocyte", disease="NASH"
)
result.programs       # lipid_metabolism (+2.3×), inflammatory_signaling (+1.8×)
result.confidence     # {'overall': 0.87, 'p_value': 0.003}
result.top_genes(5)   # ['FASN', 'SCD', 'TNF', 'IL6', 'CCL2']

# Generate cells on your device from the prediction
adata = result.generate(n_cells=500)
# AnnData — 500 cells × ~30,000 genes, generated locally via W · ĥ

# One-liner convenience
adata = singlet.generate(
    species="human", tissue="liver",
    cell_type="hepatocyte", n_cells=1000
)`}
              title="quick_start.py"
            />

            <div className="rounded-lg border border-border/60 bg-muted/20 px-5 py-3 mt-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="text-foreground font-semibold">Free:</span> Full CPM inference + local cell generation + MCP tools.{" "}
                <span className="text-foreground font-semibold">Pro ($100/mo):</span> Batch API, BYOD, higher rate limits.{" "}
                <Link to="/pricing" className="text-primary hover:underline">See plans →</Link>
              </p>
            </div>
          </section>

          <div className="glow-line mx-auto" />

          {/* ────────────────────────── PREDICT ────────────────────────── */}
          <section id="predict" className="pt-20">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6">Predict</h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              The <span className="text-foreground font-semibold">Conditional Program Model</span> (CPM) predicts gene expression for any biological condition.
              Every prediction decomposes as{" "}
              <span className="font-mono text-foreground"><em>x̂</em> = <em>W</em> · <em>ĥ</em></span>{" "}
              — a single matrix multiply through named biological programs. The API returns program activities (<em>ĥ</em>) and confidence scores;
              your device generates cells locally using the open-source W matrix.
            </p>

            <h3 className="font-display text-base font-semibold text-foreground mb-3">Predict expression</h3>
            <CodeBlock
              code={`result = singlet.predict(
    species="human", tissue="liver",
    cell_type="hepatocyte", disease="NASH"
)

result.programs
# Programs UP:   lipid_metabolism (+2.3×), inflammatory_signaling (+1.8×)
# Programs DOWN: oxidative_phosphorylation (−0.6×), bile_acid_synthesis (−0.5×)

result.confidence     # {'overall': 0.87, 'p_value': 0.003}
result.top_genes(5)   # ['FASN', 'SCD', 'TNF', 'IL6', 'CCL2']
result.expression     # full ~30,000-gene profile`}
              title="singlet.predict()"
            />

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">Predict perturbation effects</h3>
            <CodeBlock
              code={`# What happens when you knock out PCSK9 in hepatocytes?
delta = singlet.perturb(
    cell_type="hepatocyte", tissue="liver",
    perturbation="PCSK9_KO"
)
delta.affected_programs
# cholesterol_biosynthesis (−1.4×), LDLR_regulatory (+0.8×)

# Generate cells for control and perturbed conditions
adata_ctrl = delta.generate_control(n_cells=200)
adata_pert = delta.generate_perturbed(n_cells=200)

# Check safety across cell types
safety = singlet.perturb(
    perturbation="PCSK9_KO",
    cell_types=["hepatocyte", "cardiomyocyte", "macrophage"]
)
safety.cross_cell_type_effects`}
              title="singlet.perturb()"
            />

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">Compare conditions</h3>
            <CodeBlock
              code={`diff = singlet.compare(
    condition_a={"tissue": "liver", "cell_type": "hepatocyte", "disease": "NASH"},
    condition_b={"tissue": "liver", "cell_type": "hepatocyte", "disease": "healthy"}
)
diff.programs  # ranked differential programs with magnitudes and confidence intervals

# Generate cells for both sides to analyze locally
adata_nash    = diff.generate_a(n_cells=300)
adata_healthy = diff.generate_b(n_cells=300)`}
              title="singlet.compare()"
            />

            <div className="rounded-lg border-2 border-primary/20 bg-primary/[0.04] p-5 mt-6">
              <p className="text-sm text-foreground leading-relaxed mb-3">
                <span className="font-semibold">Every prediction is decomposed.</span> Every gene in the output traces to specific named biological programs —
                not opaque attention layers or latent dimensions. The full program dictionary (10,000+ programs) is open source.
              </p>
              <div className="grid grid-cols-3 gap-4 text-xs text-muted-foreground">
                <div><span className="text-foreground font-medium">~5 ms</span> inference per call</div>
                <div><span className="text-foreground font-medium">~30,000</span> genes per prediction</div>
                <div><span className="text-foreground font-medium">10,000+</span> named programs</div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-4 mt-4">
              <h4 className="text-xs font-semibold text-foreground mb-2">Coming soon</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="text-foreground">singlet.velocity()</span> — factor velocities from spliced/unspliced NMF.{" "}
                <span className="text-foreground">singlet.predict_atac()</span> — chromatin accessibility from transcriptomic conditions.{" "}
                <span className="text-foreground">singlet.predict_protein()</span> — surface protein levels via CITEseq bridges.{" "}
                <span className="text-foreground">singlet.deconvolve_spatial()</span> — Visium spot deconvolution via NMF projection.
              </p>
            </div>
          </section>

          <div className="glow-line mx-auto" />

          {/* ────────────────────────── GENERATE ────────────────────────── */}
          <section id="generate" className="pt-20">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6">Generate</h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              Singlet generates cells <span className="text-foreground font-semibold">on your device</span>.
              The API returns seeding vectors (program activities <em>ĥ</em>) — your local singlet package combines them
              with the open-source W matrix to produce full expression profiles:{" "}
              <span className="font-mono text-foreground"><em>x̂</em> = <em>W</em> · <em>ĥ</em></span>.
              You control how many cells to generate and all data stays local.
            </p>

            <div className="rounded-lg border border-border/60 bg-muted/20 px-5 py-3 mb-6">
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="text-foreground font-semibold">How it works:</span> The W matrix (10,000+ gene programs × ~30,000 genes) is open source and cached
                locally on first use (~50 MB). Each API call returns a lightweight program activity vector (<em>ĥ</em>).
                Cell generation is a single matrix multiply on your machine — no raw data ever leaves or enters the server.
              </p>
            </div>

            <h3 className="font-display text-base font-semibold text-foreground mb-3">Generate from a prediction</h3>
            <CodeBlock
              code={`result = singlet.predict(
    species="human", tissue="liver",
    cell_type="hepatocyte", disease="NASH"
)

# Generate cells locally — you control the sample size
adata = result.generate(n_cells=500)
# AnnData — 500 cells × ~30,000 genes
# Heterogeneity modeled from program variance estimates

adata.X           # expression matrix (sparse)
adata.obs         # cell metadata (condition, programs, confidence)
adata.var         # gene annotations`}
              title="result.generate()"
              comment="W matrix cached locally (~50 MB). Generation runs entirely on your device."
            />

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">One-liner convenience</h3>
            <CodeBlock
              code={`# Predict + generate in one call
adata = singlet.generate(
    species="human", tissue="liver",
    cell_type="hepatocyte", disease="NASH",
    n_cells=1000
)

# Generate for multiple conditions
conditions = [
    {"tissue": "liver", "cell_type": "hepatocyte", "disease": "NASH"},
    {"tissue": "liver", "cell_type": "hepatocyte", "disease": "healthy"},
    {"tissue": "liver", "cell_type": "kupffer_cell", "disease": "NASH"},
]
panels = [singlet.generate(species="human", n_cells=200, **c) for c in conditions]`}
              title="singlet.generate()"
            />

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">Explore the program dictionary</h3>
            <CodeBlock
              code={`# Browse all 10,000+ named programs
programs = singlet.programs()
# DataFrame: program_id, name, top_genes, GO_terms, ...

# Gene-centric view — which programs use this gene?
profile = singlet.gene_profile("TREM2")
# Expression across cell types, tissues, diseases
# Programs where TREM2 is a top contributor`}
              title="singlet.programs() / singlet.gene_profile()"
            />
          </section>

          <div className="glow-line mx-auto" />

          {/* ────────────────────────── ANALYZE ────────────────────────── */}
          <section id="analyze" className="pt-20">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6">Analyze</h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              All analysis runs <span className="text-foreground font-semibold">locally on your device</span> using
              standard AnnData objects from generated cells. Compatible with scanpy, scvi-tools, and any AnnData-based workflow.
            </p>

            <h3 className="font-display text-base font-semibold text-foreground mb-3">Preprocessing</h3>
            <CodeBlock
              code={`# Generated cells come as scanpy-compatible AnnData
adata = singlet.generate(
    species="human", tissue="liver",
    cell_type="hepatocyte", disease="NASH",
    n_cells=1000
)

# Standard preprocessing — runs locally, no auth needed
singlet.pp.normalize(adata)               # log-normalization
singlet.pp.highly_variable_genes(adata)   # feature selection (Seurat v3)
singlet.pp.scale(adata)                   # unit variance`}
              title="singlet.pp.* — runs locally, no auth needed"
            />

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">Embeddings &amp; NMF</h3>
            <CodeBlock
              code={`# PCA — free, runs locally
singlet.tl.pca(adata, n_comps=50)
singlet.tl.umap(adata)

# NMF projection — project generated cells into the program space
singlet.tl.nmf(adata, k=50)
# Each factor is a named program: "alveolar type 2 — surfactant production"

# Differential programs between conditions
adata_nash = singlet.generate(species="human", tissue="liver",
    cell_type="hepatocyte", disease="NASH", n_cells=500)
adata_healthy = singlet.generate(species="human", tissue="liver",
    cell_type="hepatocyte", disease="healthy", n_cells=500)

singlet.tl.differential_programs(adata_nash, adata_healthy)`}
              title="Embeddings &amp; differential analysis"
              comment="Gene programs (W matrix) are open source — 10,000+ named programs. Free for any use."
            />

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">PyTorch integration</h3>
            <CodeBlock
              code={`from singlet.torch import DataLoader

# Stream generated cells into PyTorch for downstream ML
loader = DataLoader(adata, batch_size=512, shuffle=True, device="cuda")

for batch in loader:
    loss = model(batch)   # sparse float32, already on GPU
    loss.backward()`}
              title="singlet.torch.DataLoader"
            />

            <div className="rounded-lg border-2 border-emerald-500/20 bg-emerald-500/[0.04] p-4 mt-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="text-emerald-600 font-semibold">Open Source</span> — The full 10,000+ program gene dictionary (W matrix) is freely available.
                Use for NNLS projection, GSEA, or as features for downstream ML. CZI hosts our proof-of-concept NMF models on CELLxGENE Census alongside
                transformer models (Geneformer, scGPT) — the only non-transformer model chosen.
              </p>
            </div>

            <div className="rounded-lg border-2 border-primary/20 bg-primary/[0.04] p-4 mt-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="text-foreground font-semibold">Why NMF over PCA?</span> PCA gives you principal components with no biological meaning.
                NMF gives you <span className="text-primary font-semibold">non-negative factors</span> that correspond to cell types, pathways, and regulatory circuits —
                interpretable by construction.
              </p>
            </div>
          </section>

          <div className="glow-line mx-auto" />

          {/* ────────────────────────── MCP TOOLS ────────────────────────── */}
          <section id="mcp" className="pt-20">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6">MCP Tools</h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              Query the atlas from your AI coding assistant via{" "}
              <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Model Context Protocol
              </a>.
              Tool names mirror the Python API — same functions, same parameters.
            </p>

            <div className="grid gap-4 md:grid-cols-2 mb-6">
              <CodeBlock
                code={`// .vscode/mcp.json
{
  "servers": {
    "singlet": {
      "type": "http",
      "url": "https://mcp.singletdb.com"
    }
  }
}`}
                title="VS Code / Cursor"
              />
              <CodeBlock
                code={`# CLI
$ claude mcp add singlet \\
    --transport http \\
    https://mcp.singletdb.com

# Or .mcp.json
{
  "mcpServers": {
    "singlet": {
      "type": "url",
      "url": "https://mcp.singletdb.com"
    }
  }
}`}
                title="Claude Code"
              />
            </div>

            <h3 className="font-display text-base font-semibold text-foreground mb-3">Example prompts</h3>
            <div className="rounded-lg border border-border divide-y divide-border mb-6 overflow-hidden">
              {[
                { prompt: "Predict expression for human liver hepatocytes with NASH", tier: "Free" },
                { prompt: "What programs are upregulated in Crohn's macrophages vs healthy?", tier: "Free" },
                { prompt: "Simulate a PCSK9 knockout in hepatocytes and show affected programs", tier: "Free" },
                { prompt: "Generate 500 alveolar type 2 cells from a healthy human lung", tier: "Free" },
                { prompt: "What does the gene TREM2 do across cell types?", tier: "Free" },
              ].map((item) => (
                <div key={item.prompt} className="flex items-center gap-4 px-4 py-2.5">
                  <span className="text-xs text-foreground italic flex-1">"{item.prompt}"</span>
                  <span className={`text-[10px] font-mono font-bold flex-shrink-0 ${item.tier === "Free" ? "text-emerald-600" : "text-primary"}`}>{item.tier}</span>
                </div>
              ))}
            </div>

            <h3 className="font-display text-base font-semibold text-foreground mb-3">Supported platforms</h3>
            <div className="rounded-lg border border-border overflow-x-auto mb-4">
              <table className="w-full text-xs">
                <tbody>
                  {[
                    ["GitHub Copilot (VS Code)", ".vscode/mcp.json"],
                    ["Claude Code", ".mcp.json or CLI"],
                    ["Cursor", ".cursor/mcp.json"],
                    ["Claude Desktop", "claude_desktop_config.json"],
                    ["ChatGPT (OpenAI)", "Working Connections"],
                    ["Any MCP client", "HTTP transport"],
                  ].map((row) => (
                    <tr key={row[0]} className="border-b border-border/50">
                      <td className="px-4 py-2 font-medium text-foreground">{row[0]}</td>
                      <td className="px-4 py-2 font-mono text-muted-foreground">{row[1]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ProGate feature="MCP tools — predict, compare, perturb, generate, and gene_profile are free; batch API requires Pro" />
          </section>

          <div className="glow-line mx-auto" />

          {/* ────────────────────────── API REFERENCE ────────────────────────── */}
          <section id="reference" className="pt-20">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6">API Reference</h2>

            <RefGroup
              icon={<Cpu size={16} className="text-primary" />}
              label="CPM Inference"
              fns={[
                { fn: "singlet.predict(species, tissue, cell_type, disease, ...)", desc: "Predict expression profile for any condition. Returns program activities (ĥ), confidence scores, and p-values.", tier: "free" },
                { fn: "singlet.perturb(cell_type, perturbation, ...)", desc: "Predict perturbation effects (KO, drug, overexpression). Returns affected programs with control/perturbed seeding vectors.", tier: "free" },
                { fn: "singlet.perturb_batch(perturbations, ...)", desc: "Batch perturbation screening — hundreds of perturbations in one call.", tier: "pro" },
                { fn: "singlet.compare(condition_a, condition_b)", desc: "Differential program analysis between two conditions. Returns ranked programs with confidence intervals.", tier: "free" },
                { fn: "singlet.velocity(cell_type, trajectory)", desc: "(Roadmap) Factor velocities from spliced/unspliced NMF.", tier: "free" },
                { fn: "singlet.predict_atac(tissue, cell_type, ...)", desc: "(Roadmap) Predict chromatin accessibility from transcriptomic conditions.", tier: "free" },
                { fn: "singlet.predict_protein(tissue, cell_type, ...)", desc: "(Roadmap) Predict surface protein levels via CITEseq bridges.", tier: "free" },
                { fn: "singlet.deconvolve_spatial(visium_data, atlas)", desc: "(Roadmap) Deconvolute Visium spots into cell type programs.", tier: "free" },
              ]}
            />

            <RefGroup
              icon={<Zap size={16} className="text-primary" />}
              label="Generate"
              fns={[
                { fn: "result.generate(n_cells)", desc: "Generate cells locally from a prediction result. Uses cached W matrix × ĥ on your device.", tier: "free" },
                { fn: "singlet.generate(species, tissue, ..., n_cells)", desc: "One-liner: predict + generate in a single call. Returns AnnData.", tier: "free" },
                { fn: "diff.generate_a(n_cells) / diff.generate_b(n_cells)", desc: "Generate cells for each side of a compare() result.", tier: "free" },
                { fn: "delta.generate_control(n_cells) / delta.generate_perturbed(n_cells)", desc: "Generate control and perturbed cells from a perturb() result.", tier: "free" },
              ]}
            />

            <RefGroup
              icon={<Search size={16} className="text-primary" />}
              label="Discovery"
              fns={[
                { fn: "singlet.programs()", desc: "Browse the full program dictionary (10,000+ named programs). Returns DataFrame.", tier: "free" },
                { fn: "singlet.gene_profile(gene)", desc: "Atlas-wide summary: expression by cell type, tissue, disease, and contributing programs.", tier: "free" },
              ]}
            />

            <RefGroup
              icon={<Filter size={16} className="text-primary" />}
              label="Preprocessing"
              fns={[
                { fn: "singlet.pp.normalize(adata)", desc: "Log-normalization with library size correction.", tier: "free" },
                { fn: "singlet.pp.highly_variable_genes(adata)", desc: "Highly variable gene selection (Seurat v3).", tier: "free" },
                { fn: "singlet.pp.filter_cells(adata, ...)", desc: "QC filtering by min_genes, max_genes, mito_pct.", tier: "free" },
                { fn: "singlet.pp.filter_genes(adata, ...)", desc: "Filter genes by min_cells expressing.", tier: "free" },
                { fn: "singlet.pp.scale(adata)", desc: "Scale to unit variance.", tier: "free" },
              ]}
            />

            <RefGroup
              icon={<BarChart3 size={16} className="text-primary" />}
              label="Analysis"
              fns={[
                { fn: "singlet.tl.pca(adata, n_comps)", desc: "PCA dimensionality reduction.", tier: "free" },
                { fn: "singlet.tl.umap(adata)", desc: "UMAP embedding.", tier: "free" },
                { fn: "singlet.tl.nmf(adata, k)", desc: "GPU-accelerated NMF — interpretable biological programs.", tier: "free" },
                { fn: "singlet.tl.differential_programs(adata_a, adata_b)", desc: "Differential NMF program activation between generated panels.", tier: "free" },
                { fn: "singlet.tl.enrichment(gene_list)", desc: "Gene set enrichment against GO, KEGG, Reactome.", tier: "free" },
              ]}
            />

            <RefGroup
              icon={<FlaskConical size={16} className="text-primary" />}
              label="PyTorch"
              fns={[
                { fn: "singlet.torch.DataLoader(adata, ...)", desc: "PyTorch DataLoader from generated AnnData. Sparse tensors, GPU via CuSPARSE.", tier: "free" },
                { fn: "singlet.torch.SingletDataset(adata)", desc: "PyTorch Dataset wrapper for AnnData.", tier: "free" },
              ]}
            />
          </section>

          <div className="glow-line mx-auto" />

          {/* ────────────────────────── CITATION ────────────────────────── */}
          <section id="citation" className="pt-20">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6">Citation &amp; Licensing</h2>

            <div className="rounded-lg border border-border bg-card p-5 mb-6">
              <h3 className="font-display text-sm font-semibold text-foreground mb-3">Cite Singlet AI</h3>
              <div className="rounded-md bg-muted/40 p-4 font-mono text-xs text-muted-foreground leading-relaxed">
                DeBruine ZJ, Melber K, Bhatt D, et al. Fast and interpretable non-negative matrix
                factorization for single-cell data. <em>Bioinformatics</em>, 2024.
                <br />
                DOI:{" "}
                <a href="https://doi.org/10.1093/bioinformatics/btae003" target="_blank" rel="noopener noreferrer"
                  className="text-primary hover:underline">
                  10.1093/bioinformatics/btae003
                </a>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                If you use generated data in a publication, please cite this paper.
              </p>
            </div>

            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-display text-sm font-semibold text-foreground mb-3">Licensing</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold mt-0.5">•</span>
                  <span><strong>NMF gene programs (W matrix)</strong> — MIT license. 10,000+ named programs. Free for any use.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold mt-0.5">•</span>
                  <span><strong>CPM model outputs</strong> — Free for research; commercial use requires Pro plan.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold mt-0.5">•</span>
                  <span><strong>Singlet package</strong> — MIT license (open source).</span>
                </li>
              </ul>
              <p className="text-xs text-muted-foreground mt-3">
                See{" "}
                <Link to="/pricing" className="text-primary hover:underline">pricing &amp; plans</Link>{" "}
                for details on rate limits and commercial use.
              </p>
            </div>
          </section>

          {/* ────────────────────────── FINAL CTA ────────────────────────── */}
          <section className="pt-20 pb-8">
            <div className="border-t border-border pt-14 text-center">
              <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-2">
                <span className="font-mono">pip install singletai</span> <span className="gradient-text">and go.</span>
              </h2>
              <p className="text-sm text-muted-foreground mb-6 max-w-lg mx-auto">
                Predict, generate, analyze. Start free.
              </p>
              <div className="flex flex-wrap gap-3 justify-center">
                <Link
                  to="/pricing"
                  className="shimmer-border inline-flex items-center gap-2 px-6 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  See Plans <ArrowRight size={14} />
                </Link>
                <Link
                  to="/gene-programs"
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md border border-border bg-secondary text-secondary-foreground text-sm font-medium hover:bg-muted transition-colors"
                >
                  Explore Technology
                </Link>
              </div>
            </div>
          </section>

        </div>
      </div>

      <Footer />
    </div>
  );
};

export default Docs;

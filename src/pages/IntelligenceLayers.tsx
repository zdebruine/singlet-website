import { ArrowRight, Brain, Dna, Bug, Tag, Microscope, TrendingUp, Layers, Map, ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const Expandable = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <details className="group">
    <summary className="inline-flex items-center gap-1.5 text-xs font-mono text-primary cursor-pointer hover:underline select-none">
      {label} <ChevronDown size={12} className="expand-icon" />
    </summary>
    <div className="mt-3">{children}</div>
  </details>
);

const DATA_LAYERS = [
  {
    icon: Tag,
    name: "Cell Type Annotations",
    tier: "Included",
    short: "Atlas-reconciled Cell Ontology labels — consistent across thousands of datasets",
    output: ".obs['cell_type']",
    example: "CD8-positive, alpha-beta T cell",
  },
  {
    icon: Brain,
    name: "NMF Gene Programs",
    tier: "MIT",
    short: "10,000+ named programs. GSEA, NNLS projection, ML features — all MIT-licensed.",
    output: ".obsm['X_nmf']",
    example: "Factor 12: EMT program",
  },
  {
    icon: Dna,
    name: "RNA Velocity",
    tier: "Included",
    short: "Splicing-resolved from raw FASTQ. Cannot be computed from count matrices — a structural moat.",
    output: ".layers['spliced'], ['unspliced']",
    example: "scvelo.tl.velocity(adata)",
  },
  {
    icon: Bug,
    name: "Microbiome Profiling",
    tier: "Included",
    short: "Non-host species from unmapped reads. Requires FASTQ. Tumor microbiome, gut bacteria, viral load.",
    output: ".obs['frac_nonhost']",
    example: "2.3% non-host (E. coli, S. aureus)",
  },
  {
    icon: Microscope,
    name: "Curated Metadata",
    tier: "Included",
    short: "9 dimensions: disease, perturbation, stage, sex, ancestry, cell cycle, tissue region — harmonized atlas-wide.",
    output: ".obs['disease'], .obs['perturbation']",
    example: "disease='COVID-19 (severe)'",
  },
];

const INFERENCE_LAYERS = [
  {
    icon: TrendingUp,
    name: "Trajectory & Factor Velocities",
    short: "RNA velocity in program space. dĥ/dt per program — 'EMT activating at 0.3/hr' instead of 'gene X up.'",
    code: "singlet.velocity(adata)",
  },
  {
    icon: Layers,
    name: "Multimodal Prediction",
    short: "Bridge networks map program activities to ATAC-seq peaks or surface protein levels. No multiome assay needed.",
    code: "singlet.predict_atac(adata)",
  },
  {
    icon: Map,
    name: "Spatial Deconvolution",
    short: "Deconvolve Visium spots into cell-type proportions using CPM-predicted references. No matched scRNA-seq needed.",
    code: "singlet.deconvolve_spatial(visium)",
  },
];

const IntelligenceLayers = () => (
  <div className="min-h-screen bg-background">
    <Navbar />

    {/* ═══ HERO ═══ */}
    <section className="pt-28 pb-16 md:pt-36 md:pb-20 px-6 relative">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-primary/[0.06] blur-[100px]" />
      </div>
      <div className="max-w-4xl mx-auto text-center relative">
        <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Model Capabilities</p>
        <h1 className="font-display text-4xl md:text-6xl font-bold text-foreground tracking-tightest mb-4">
          Eight layers. <span className="gradient-text">One query.</span>
        </h1>
        <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          Five data layers from FASTQ reprocessing. Three inference capabilities from the CPM. Every layer returned with every call — free for academic researchers.
        </p>
      </div>
    </section>

    <div className="max-w-5xl mx-auto px-6 pb-20">

      {/* ═══ API PREVIEW ═══ */}
      <div className="rounded-xl border border-border overflow-hidden mb-14">
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border bg-muted/30">
          <div className="w-2.5 h-2.5 rounded-full bg-destructive/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
          <span className="ml-2 font-mono text-[10px] text-muted-foreground">singlet — intelligence layers</span>
        </div>
        <div className="bg-background p-5 font-mono text-xs leading-6 overflow-x-auto">
          <div className="text-muted-foreground"># CPM inference — all layers in one call</div>
          <div className="text-foreground">result = singlet.predict(species=<span className="text-primary">"human"</span>, tissue=<span className="text-primary">"lung"</span>, cell_type=<span className="text-primary">"macrophage"</span>)</div>
          <div className="text-foreground">result.programs<span className="text-muted-foreground">          # Named program activities</span></div>
          <div className="text-foreground">result.expression<span className="text-muted-foreground">        # Full expression profile</span></div>
          <div className="h-2" />
          <div className="text-muted-foreground"># Perturbation + velocity + multimodal + spatial</div>
          <div className="text-foreground">singlet.perturb(cell_type=<span className="text-primary">"hepatocyte"</span>, perturbation=<span className="text-primary">"PCSK9_KO"</span>)</div>
          <div className="text-foreground">singlet.velocity(adata)<span className="text-muted-foreground">  # dĥ/dt per program</span></div>
          <div className="text-foreground">singlet.predict_atac(adata)</div>
          <div className="text-foreground">singlet.deconvolve_spatial(visium_adata)</div>
        </div>
      </div>

      {/* ═══ DATA LAYERS ═══ */}
      <section className="mb-16">
        <p className="section-dot font-mono text-xs text-primary uppercase tracking-widest mb-3">From FASTQ Reprocessing</p>
        <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground tracking-tightest mb-3">
          Five data layers. <span className="gradient-text">Zero batch effects.</span>
        </h2>
        <p className="text-sm text-muted-foreground mb-8 max-w-xl">
          Every dataset — across species, chemistries, and formats — reprocessed through one pipeline. Same parameters, same references, same QC.
        </p>

        <div className="grid md:grid-cols-6 gap-4 stagger-fade">
          {DATA_LAYERS.map((layer, i) => {
            const Icon = layer.icon;
            const span = i < 2 ? 3 : 2;
            return (
              <div key={layer.name} className={`md:col-span-${span} rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/30`}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={16} className="text-primary" />
                  <h3 className="font-display text-sm font-bold text-foreground">{layer.name}</h3>
                  <span className={`ml-auto px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${layer.tier === "MIT" ? "bg-emerald-500/15 text-emerald-600" : "bg-primary/15 text-primary"}`}>
                    {layer.tier}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed mb-3">{layer.short}</p>
                <div className="flex gap-2">
                  <div className="flex-1 rounded-md bg-muted/30 px-2 py-1.5">
                    <div className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">Output</div>
                    <div className="text-[10px] text-foreground font-mono mt-0.5 truncate">{layer.output}</div>
                  </div>
                  <div className="flex-1 rounded-md bg-muted/30 px-2 py-1.5">
                    <div className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">Example</div>
                    <div className="text-[10px] text-primary font-mono mt-0.5 truncate">{layer.example}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="glow-line mx-auto max-w-4xl" />

      {/* ═══ INFERENCE LAYERS ═══ */}
      <section className="py-16">
        <p className="section-dot font-mono text-xs text-primary uppercase tracking-widest mb-3">CPM Inference</p>
        <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground tracking-tightest mb-3">
          Three inference <span className="gradient-text">capabilities.</span>
        </h2>
        <p className="text-sm text-muted-foreground mb-8 max-w-lg">
          Built on the data layers. Predict trajectories, modalities, and spatial composition — all via the same API.
        </p>

        <div className="grid md:grid-cols-3 gap-4 stagger-fade">
          {INFERENCE_LAYERS.map((layer) => {
            const Icon = layer.icon;
            return (
              <div key={layer.name} className="rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/30">
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={16} className="text-primary" />
                  <h3 className="font-display text-sm font-bold text-foreground">{layer.name}</h3>
                  <span className="ml-auto px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-violet-500/15 text-violet-600">CPM</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed mb-3">{layer.short}</p>
                <code className="font-mono text-[10px] text-primary/70">{layer.code}</code>
              </div>
            );
          })}
        </div>
      </section>

      <div className="glow-line mx-auto max-w-4xl" />

      {/* ═══ ACCESS COMPARISON ═══ */}
      <section className="py-16">
        <h2 className="font-display text-2xl font-bold text-foreground text-center tracking-tightest mb-3">
          Academic vs. <span className="gradient-text">Commercial</span>
        </h2>
        <p className="text-sm text-muted-foreground text-center mb-8 max-w-lg mx-auto">
          Academics get every layer and every inference capability — free. Commercial teams add rate limits, bulk API, and BYOD.
        </p>

        <Expandable label="Full feature comparison table">
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider" />
                  <th className="text-center px-4 py-3 text-xs font-bold text-primary uppercase tracking-wider border-x border-border bg-primary/[0.04]">Academic (Free)</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Pro ($149/mo)</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { feat: "All 5 data layers", acad: "✓", pro: "✓" },
                  { feat: "CPM inference (predict, perturb, compare)", acad: "✓", pro: "✓" },
                  { feat: "Trajectory & factor velocities", acad: "✓", pro: "✓" },
                  { feat: "Multimodal prediction (ATAC / protein)", acad: "✓", pro: "✓" },
                  { feat: "Spatial deconvolution", acad: "✓", pro: "✓" },
                  { feat: "NMF gene programs (MIT)", acad: "✓", pro: "✓" },
                  { feat: "MCP tools", acad: "✓", pro: "✓" },
                  { feat: "Rate limit", acad: "10/min", pro: "100/min" },
                  { feat: "Bulk API access", acad: "—", pro: "✓" },
                  { feat: "Commercial license", acad: "—", pro: "✓" },
                  { feat: "Bring Your Own Data", acad: "—", pro: "✓" },
                ].map((row) => (
                  <tr key={row.feat} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 text-xs font-medium text-foreground">{row.feat}</td>
                    <td className={`px-4 py-2.5 text-center text-xs border-x border-border ${row.acad === "✓" ? "text-green-600 font-bold bg-primary/[0.02]" : row.acad === "—" ? "text-muted-foreground/40 bg-primary/[0.02]" : "text-muted-foreground font-mono bg-primary/[0.02]"}`}>{row.acad}</td>
                    <td className={`px-4 py-2.5 text-center text-xs ${row.pro === "✓" ? "text-green-600 font-bold" : row.pro === "—" ? "text-muted-foreground/40" : "text-muted-foreground font-mono"}`}>{row.pro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Expandable>
      </section>

      <div className="glow-line mx-auto max-w-4xl" />

      {/* ═══ CTA ═══ */}
      <section className="py-14 text-center">
        <p className="font-display text-xl md:text-2xl font-bold text-foreground leading-snug tracking-tight mb-6">
          Every layer. Every query. Free for research.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link to="/docs" className="shimmer-border inline-flex items-center gap-2 px-6 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
            Start Building <ArrowRight size={14} />
          </Link>
          <Link to="/pricing" className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md border border-border bg-secondary text-secondary-foreground text-sm font-medium hover:bg-muted transition-colors">
            See Plans
          </Link>
        </div>
      </section>
    </div>

    <Footer />
  </div>
);

export default IntelligenceLayers;

import { ArrowRight, ChevronDown, ChevronRight, Sparkles, Search, FlaskConical, Dna, BarChart3, Target } from "lucide-react";
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

const GenePrograms = () => (
  <div className="min-h-screen bg-background">
    <Navbar />

    {/* ═══ HERO ═══ */}
    <section className="pt-28 pb-16 md:pt-36 md:pb-24 px-6 relative">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-primary/[0.06] blur-[100px]" />
      </div>
      <div className="max-w-4xl mx-auto text-center relative">
        <div className="flex justify-center mb-4">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/[0.08] text-xs font-mono text-emerald-600">
            MIT Open Source
          </span>
        </div>
        <h1 className="font-display text-4xl md:text-6xl font-bold text-foreground tracking-tightest mb-4">
          The vocabulary of <span className="gradient-text">cellular intelligence.</span>
        </h1>
        <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          10,000+ named biological programs — each a real process like "surfactant production" or "inflammatory signaling." The building blocks that let Singlet explain what every cell is doing and why.
        </p>
      </div>
    </section>

    <div className="max-w-5xl mx-auto px-6 pb-20">

      {/* ═══ WHAT + WHY ═══ */}
      <div className="grid md:grid-cols-5 gap-5 mb-12">
        <div className="md:col-span-3 rounded-xl border border-border bg-card p-6">
          <h2 className="font-display text-lg font-bold text-foreground mb-3">What are gene programs?</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-3">
            NMF decomposes gene expression into additive programs — each representing a real biological process. Trained with angular regularization for minimal overlap and L1 sparsity for focused gene memberships.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed mb-3">
            These programs form the <span className="text-foreground font-semibold">interpretable vocabulary of the CPM</span>. The decode is a matrix multiply: <span className="text-foreground font-mono"><em>x̂</em> = <em>W</em> · <em>ĥ</em></span> — every predicted gene traces to specific named programs.
          </p>
          <div className="pt-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Early NMF models hosted by CZI on CELLxGENE Census — the only non-transformer model selected.
            </p>
          </div>
        </div>
        <div className="md:col-span-2 rounded-xl border-2 border-primary/30 bento-highlight p-6 flex flex-col justify-center">
          <p className="font-mono text-3xl font-bold text-primary mb-2">10,000+</p>
          <p className="text-sm text-muted-foreground mb-1">gene programs</p>
          <p className="text-xs text-muted-foreground/70">GO / Reactome annotated · MIT licensed</p>
          <div className="mt-4 pt-3 border-t border-primary/15 flex items-center gap-1.5">
            {["GSEA", "NNLS", "ML features", "CPM vocab"].map((tag, i) => (
              <span key={tag} className="px-2 py-0.5 rounded-full border border-border bg-muted/30 text-[9px] font-mono text-muted-foreground">{tag}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="glow-line mx-auto max-w-4xl" />

      {/* ═══ CODE EXAMPLE ═══ */}
      <section className="py-12">
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border bg-muted/30">
            <div className="w-2.5 h-2.5 rounded-full bg-destructive/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
            <span className="ml-2 font-mono text-[10px] text-muted-foreground">gene_programs.py</span>
          </div>
          <div className="bg-background p-5 font-mono text-xs leading-6 overflow-x-auto">
            <div className="text-foreground"><span className="text-primary">import</span> singlet</div>
            <div className="h-3" />
            <div className="text-muted-foreground"># Access programs from any query</div>
            <div className="text-foreground">adata = singlet.query(species=<span className="text-primary">"human"</span>, tissue=<span className="text-primary">"lung"</span>)</div>
            <div className="text-foreground">factors = adata.obsm[<span className="text-primary">"X_nmf"</span>]  <span className="text-muted-foreground"># (n_cells, k) matrix</span></div>
            <div className="h-3" />
            <div className="text-muted-foreground"># Named programs — not cryptic factors</div>
            <div className="text-foreground">singlet.top_genes(adata, program=<span className="text-primary">12</span>)</div>
            <div className="text-primary"># → ['SFTPC', 'SFTPB', 'SFTPA1', 'NAPSA', 'SLC34A2']</div>
            <div className="text-primary"># → Alveolar Type 2 — surfactant production</div>
          </div>
        </div>
      </section>

      <div className="glow-line mx-auto max-w-4xl" />

      {/* ═══ USE CASES ═══ */}
      <section className="py-12">
        <p className="section-dot font-mono text-xs text-primary uppercase tracking-widest mb-3 text-center">Applications</p>
        <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground text-center tracking-tightest mb-3">
          Six ways to use <span className="gradient-text">gene programs</span>
        </h2>
        <p className="text-sm text-muted-foreground text-center max-w-xl mx-auto mb-8">
          From enrichment analysis to drug discovery — one vocabulary for every question.
        </p>
        <div className="grid md:grid-cols-6 gap-4 stagger-fade">
          {[
            { icon: BarChart3, title: "GSEA", desc: "10,000+ data-driven gene sets. Like MSigDB, but trained on the full atlas.", span: 3 },
            { icon: Sparkles, title: "NNLS Projection", desc: "Project any dataset onto program space locally. No API key — MIT-licensed W matrix.", span: 3 },
            { icon: Search, title: "Cross-disease discovery", desc: "Which programs are active in both IPF and lung cancer? Find shared mechanisms at atlas scale.", span: 2 },
            { icon: FlaskConical, title: "ML feature engineering", desc: "10,000+ factors vs. 20,000 genes → faster training, comparable accuracy.", span: 2 },
            { icon: Target, title: "Drug targets", desc: "Map resistance programs to druggable targets with pathway enrichment.", span: 2 },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className={`md:col-span-${item.span} rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/30`}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={16} className="text-primary" />
                  <h3 className="font-display text-sm font-bold text-foreground">{item.title}</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            );
          })}
          <div className="md:col-span-6 rounded-xl border border-border bg-card p-5 flex items-start gap-3 transition-all hover:border-primary/30">
            <Dna size={16} className="text-primary mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-display text-sm font-bold text-foreground mb-1">Cross-species factor alignment</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">Compare gene programs between human and mouse. Is the inflammatory macrophage program conserved across species?</p>
            </div>
          </div>
        </div>
      </section>

      <div className="glow-line mx-auto max-w-4xl" />

      {/* ═══ PROGRAM DICTIONARY ═══ */}
      <section className="py-12">
        <div className="rounded-xl border-2 border-primary/30 bg-primary/[0.03] p-6">
          <div className="flex items-center gap-3 mb-3">
            <h2 className="font-display text-lg font-bold text-foreground">The Program Dictionary</h2>
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 text-[9px] font-bold uppercase tracking-wider">MIT</span>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Every program named, GO/Reactome annotated, and downloadable. Browse by tissue or disease via the API, or download for local analysis.
          </p>
          <div className="rounded-lg bg-background border border-border p-4 font-mono text-xs leading-6 overflow-x-auto mb-4">
            <div className="text-foreground"><span className="text-primary">import</span> singlet</div>
            <div className="h-2" />
            <div className="text-muted-foreground"># Browse programs active in a tissue</div>
            <div className="text-foreground">programs = singlet.programs(<span className="text-primary">"lung"</span>)</div>
            <div className="text-primary"># → ['Alveolar Type 2 — surfactant production',</div>
            <div className="text-primary">#    'Macrophage activation — inflammatory', ...]</div>
            <div className="h-2" />
            <div className="text-muted-foreground"># Enrichment across conditions</div>
            <div className="text-foreground">singlet.program_enrichment(tissue=<span className="text-primary">"lung"</span>, disease=<span className="text-primary">"IPF"</span>, vs=<span className="text-primary">"normal"</span>)</div>
            <div className="text-primary"># → Factor 23 (EMT program): 3.2× enriched, p &lt; 1e-12</div>
          </div>
          <p className="text-[10px] text-muted-foreground/70 italic">
            Pre-computed across the full atlas. The intelligence is in the cross-atlas aggregation — not reproducible from individual dataset downloads.
          </p>
        </div>
      </section>

      <div className="glow-line mx-auto max-w-4xl" />

      {/* ═══ NMF vs. TRANSFORMERS ═══ */}
      <section className="py-12">
        <h2 className="font-display text-2xl font-bold text-foreground text-center tracking-tightest mb-3">
          Why NMF? <span className="gradient-text">Why not transformers?</span>
        </h2>
        <p className="text-sm text-muted-foreground text-center max-w-lg mx-auto mb-8">
          Transformers compress biology into opaque embeddings. NMF decomposes it into named programs you can act on.
        </p>

        <Expandable label="Full NMF vs. Transformer comparison">
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider" />
                  <th className="text-left px-4 py-3 text-xs font-bold text-primary uppercase tracking-wider border-l border-border bg-primary/[0.04]">NMF (Singlet AI)</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Transformers</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Interpretability", "Each factor = named program", "Opaque 768-dim embeddings"],
                  ["Additivity", "Non-negative, additive", "No guarantee"],
                  ["Speed", "CPU-only, seconds/dataset", "GPU, minutes–hours"],
                  ["Validation", "Published, CZI-selected", "Emerging"],
                  ["Dimensions", "Data-driven (flexible)", "512–768 (fixed)"],
                  ["License", "MIT open source", "Varies"],
                  ["GSEA / gene sets", "10,000+ ready-to-use", "Not applicable"],
                ].map((row) => (
                  <tr key={row[0]} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 text-xs font-medium text-muted-foreground">{row[0]}</td>
                    <td className="px-4 py-2.5 text-xs font-semibold text-primary border-l border-border bg-primary/[0.02]">{row[1]}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{row[2]}</td>
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
        <p className="font-display text-xl md:text-2xl font-bold text-foreground leading-snug tracking-tight mb-2">
          Open source. MIT licensed. Ready to use.
        </p>
        <p className="text-sm text-muted-foreground mb-6 max-w-lg mx-auto">
          Download the full program dictionary. Run GSEA, NNLS, or feed into your own models. For CPM inference — free for academic researchers.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link to="/docs" className="shimmer-border inline-flex items-center gap-2 px-6 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
            Get Started <ArrowRight size={14} />
          </Link>
          <Link to="/intelligence" className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md border border-border bg-secondary text-secondary-foreground text-sm font-medium hover:bg-muted transition-colors">
            All Intelligence Layers
          </Link>
        </div>
      </section>
    </div>

    <Footer />
  </div>
);

export default GenePrograms;

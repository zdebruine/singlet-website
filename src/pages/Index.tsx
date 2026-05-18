import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Github, ChevronRight, ChevronDown, Check, Brain, Microscope, Activity, Target, Beaker, Clock, Layers, MapPin, Sparkles, Zap, Dna, FlaskConical, Shield, Users, BookOpen } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

/* ── Animated Counter ── */
function useCountUp(end: number, duration = 2000, suffix = "", prefix = "") {
  const [display, setDisplay] = useState(prefix + "0" + suffix);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const start = performance.now();
          const step = (now: number) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(eased * end);
            setDisplay(prefix + current.toLocaleString() + suffix);
            if (progress < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [end, duration, suffix, prefix]);
  return { ref, display };
}

/* ── Floating Cells Background ── */
const FloatingCells = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let animId: number;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener("resize", resize);

    const cells: { x: number; y: number; r: number; vx: number; vy: number; opacity: number }[] = [];
    for (let i = 0; i < 30; i++) {
      cells.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: 2 + Math.random() * 4,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        opacity: 0.08 + Math.random() * 0.12,
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const c of cells) {
        c.x += c.vx;
        c.y += c.vy;
        if (c.x < -10) c.x = canvas.width + 10;
        if (c.x > canvas.width + 10) c.x = -10;
        if (c.y < -10) c.y = canvas.height + 10;
        if (c.y > canvas.height + 10) c.y = -10;

        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(174, 84%, 42%, ${c.opacity})`;
        ctx.fill();

        // Draw connection lines between nearby cells
        for (const other of cells) {
          const dx = c.x - other.x;
          const dy = c.y - other.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120 && dist > 0) {
            ctx.beginPath();
            ctx.moveTo(c.x, c.y);
            ctx.lineTo(other.x, other.y);
            ctx.strokeStyle = `hsla(174, 84%, 42%, ${0.03 * (1 - dist / 120)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />;
};

/* ── Expandable ── */
const Expandable = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <details className="group">
    <summary className="inline-flex items-center gap-1.5 text-xs font-mono text-primary cursor-pointer hover:underline select-none">
      {label} <ChevronDown size={12} className="expand-icon" />
    </summary>
    <div className="mt-3">{children}</div>
  </details>
);

/* ── Hero Terminal ── */
const HeroTerminal = () => (
  <div className="w-full max-w-2xl mx-auto rounded-xl border border-border overflow-hidden shadow-2xl shadow-primary/5">
    <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border bg-muted/30">
      <div className="w-2.5 h-2.5 rounded-full bg-destructive/60" />
      <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
      <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
      <span className="ml-2 font-mono text-[10px] text-muted-foreground">python3 — singlet</span>
    </div>
    <div className="bg-background p-4 font-mono text-xs leading-relaxed text-left">
      <div className="text-muted-foreground">{`>>> `}<span className="text-foreground">import singlet</span></div>
      <div className="text-muted-foreground">{`>>> `}<span className="text-foreground">result = singlet.predict(</span></div>
      <div className="text-foreground">{"...     "}species=<span className="text-primary">"human"</span>, tissue=<span className="text-primary">"lung"</span>,</div>
      <div className="text-foreground">{"...     "}cell_type=<span className="text-primary">"alveolar_type_2"</span>, disease=<span className="text-primary">"IPF"</span></div>
      <div className="text-foreground">{"... "}<span className="text-foreground">)</span></div>
      <div className="h-2" />
      <div className="text-muted-foreground">{`>>> `}<span className="text-foreground">result.programs</span></div>
      <div className="text-muted-foreground/70 mt-1">{"  fibroblast_ECM_remodeling    +2.1×   p=0.002"}</div>
      <div className="text-muted-foreground/70">{"  AT2_senescence               +1.8×   p=0.005"}</div>
      <div className="text-muted-foreground/70">{"  inflammatory_signaling       +1.4×   p=0.011"}</div>
      <div className="h-2" />
      <div className="text-muted-foreground">{`>>> `}<span className="text-foreground">adata = result.generate(n_cells=500)</span></div>
      <div className="text-muted-foreground/70 mt-1">{"Generating 500 cells via W · ĥ..."}</div>
      <div className="text-muted-foreground/70">{"AnnData: 500 × 28,476 genes"}</div>
      <div className="h-2" />
      <div className="text-primary font-semibold">{`>>> `}# Predicted · Decomposed · Generated locally</div>
    </div>
  </div>
);

/* ───────────────────── PAGE ───────────────────── */
const Index = () => {
  const [codeTab, setCodeTab] = useState<"python" | "r" | "mcp">("python");
  const stats = [
    { end: 10, suffix: "K+", prefix: "", label: "biological programs" },
    { end: 16, suffix: "+", prefix: "", label: "species supported" },
    { end: 5, suffix: "ms", prefix: "~", label: "inference latency" },
    { end: 319, suffix: "K+", prefix: "", label: "CRAN downloads" },
  ];
  const counters = stats.map((s) =>
    useCountUp(s.end, s.end > 1000 ? 2400 : 1600, s.suffix, s.prefix)
  );

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* ═══ HERO ═══ */}
      <section className="relative pt-28 pb-16 md:pt-36 md:pb-24 px-6 overflow-hidden">
        <FloatingCells />
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[700px] rounded-full bg-primary/[0.06] blur-[140px]" />
          <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full bg-primary/[0.04] blur-[100px]" />
        </div>
        <div className="relative max-w-4xl mx-auto text-center">
          <div className="flex justify-center mb-5">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/[0.08] text-xs font-mono text-primary">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              Early access open — launching Q3 2026
            </span>
          </div>

          <h1 className="font-display text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-[0.95] tracking-tightest mb-5">
            <span className="block whitespace-nowrap">We learned the transcriptional</span>
            <span className="block whitespace-nowrap gradient-text">grammar of every human cell.</span>
          </h1>

          <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            A completely harmonized human cell atlas distilled into over 10,000 biological programs. Predict gene expression for any condition, explain every result, and generate cells that have never been observed — in milliseconds.
          </p>

          <div className="flex flex-wrap gap-4 justify-center mt-8">
            <Link to="/docs" className="shimmer-border inline-flex items-center gap-2 px-7 py-3 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90 transition-opacity">
              Start free <ArrowRight size={14} />
            </Link>
            <Link to="/gene-programs" className="inline-flex items-center gap-2 px-7 py-3 rounded-md border border-border bg-secondary text-secondary-foreground text-sm font-medium hover:bg-muted transition-colors">
              Explore programs
            </Link>
          </div>

          <p className="text-xs text-muted-foreground/50 mt-5 font-mono tracking-wide">
            pip install singlet · Open source · Permissive licensing
          </p>
        </div>
      </section>

      {/* ═══ STATS RIBBON ═══ */}
      <section className="border-y border-border relative">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/[0.04] via-transparent to-primary/[0.04] pointer-events-none" />
        <div className="max-w-5xl mx-auto px-6 py-6 grid grid-cols-4 gap-4 relative">
          {stats.map((s, i) => (
            <div key={s.label} className="text-center" ref={counters[i].ref}>
              <div className="font-mono text-xl md:text-2xl font-bold text-foreground">{counters[i].display}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wider">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ THE SHIFT ═══ */}
      <section className="py-24 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.02] via-transparent to-primary/[0.02] pointer-events-none" />
        <div className="max-w-5xl mx-auto relative">
          <p className="font-display text-2xl md:text-4xl font-bold text-foreground leading-snug tracking-tightest text-center mb-14">
            You shouldn't need weeks of bioinformatics{" "}
            <span className="text-muted-foreground">to ask a simple biological question.</span>
          </p>

          <div className="grid md:grid-cols-5 gap-5">
            <div className="md:col-span-2 rounded-xl border border-border bg-card p-6 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-destructive/[0.02] to-transparent pointer-events-none" />
              <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest mb-3 relative">The old way</p>
              <div className="space-y-2 relative">
                {["Download data — hope it parses", "Normalize across labs and batches", "Differential expression — get gene lists", "Run enrichment — get vague pathway names", "Still can't predict what you haven't seen"].map((s, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="font-mono text-[10px] text-muted-foreground/40 mt-0.5 w-3">{i + 1}.</span>{s}
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-3 border-t border-border relative">
                <span className="font-mono text-xs text-muted-foreground/60">Weeks of pipeline work. Zero predictions.</span>
              </div>
            </div>
            <div className="md:col-span-3 rounded-xl border-2 border-primary/40 bg-primary/[0.03] p-6 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.04] to-transparent pointer-events-none" />
              <div className="absolute -top-3 left-5 px-2.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-mono font-bold uppercase tracking-wider">With Singlet</div>
              <div className="rounded-lg bg-background/80 border border-border p-3 mb-4 font-mono text-xs relative">
                <span className="text-muted-foreground">result = </span>singlet.predict(<br />
                {"    "}species=<span className="text-primary">"human"</span>, tissue=<span className="text-primary">"liver"</span>,<br />
                {"    "}cell_type=<span className="text-primary">"hepatocyte"</span>, disease=<span className="text-primary">"NASH"</span><br />
                )
              </div>
              <div className="grid grid-cols-2 gap-2 relative">
                {["Predict any condition — even unobserved ones", "Get named biological programs, not gene lists", "See perturbation effects before the experiment", "Trace every gene back to its biological program"].map((item) => (
                  <div key={item} className="flex items-start gap-2 text-xs">
                    <Check size={13} className="text-primary mt-0.5 flex-shrink-0" />
                    <span className="text-foreground/80">{item}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-3 border-t border-primary/20 relative">
                <span className="font-mono text-xs text-primary font-semibold">~5 ms · Fully interpretable · Generative</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="glow-line mx-auto max-w-4xl" />

      {/* ═══ TERMINAL DEMO ═══ */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <p className="section-dot font-mono text-xs text-primary uppercase tracking-widest mb-3">Live Preview</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-3">
            Five lines. <span className="gradient-text">Full prediction.</span>
          </h2>
          <p className="text-sm text-muted-foreground mb-10 max-w-xl mx-auto">One API call. Named programs, magnitudes, and top genes.</p>
          <HeroTerminal />
        </div>
      </section>

      <div className="glow-line mx-auto max-w-4xl" />


      {/* ═══ CAPABILITIES ═══ */}
      <section className="py-24 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/[0.02] to-transparent pointer-events-none" />
        <div className="max-w-6xl mx-auto relative">
          <p className="section-dot font-mono text-xs text-primary uppercase tracking-widest mb-3 text-center">What you can do</p>
          <h2 className="font-display text-3xl md:text-5xl font-bold text-foreground text-center tracking-tightest mb-3">
            Singlet Simplex 1.0
          </h2>
          <p className="text-center text-muted-foreground max-w-xl mx-auto mb-4">
            Predict, perturb, compare, generate — ask any question about any human cell and get biologically interpretable answers.
          </p>

          <div className="flex justify-center gap-4 mb-8">
            <div className="flex items-center gap-2 text-xs">
              <div className="w-2.5 h-2.5 rounded-full bg-primary" />
              <span className="text-foreground font-medium">Singlet Simplex 1.0</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/30" />
              <span className="text-muted-foreground">Coming soon</span>
            </div>
          </div>

          <div className="grid md:grid-cols-6 gap-4 stagger-fade">
            <div className="md:col-span-4 bento-highlight rounded-xl border-2 border-primary/30 bg-primary/[0.03] p-6 card-glow transition-all relative">
              <div className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full bg-primary" title="Singlet Simplex 1.0" />
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center"><Brain size={18} className="text-primary" /></div>
                <h3 className="font-display text-base font-bold text-foreground">Conditional Expression Prediction</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                Predict what any cell type looks like under any condition — even combinations never seen in any lab. Returns named programs with magnitudes and confidence intervals.
              </p>
              <div className="rounded-lg bg-muted/30 border border-border px-3 py-2">
                <code className="font-mono text-[11px] text-primary">singlet.predict(species="human", tissue="lung", cell_type="AT2", disease="IPF")</code>
              </div>
            </div>
            <div className="md:col-span-2 rounded-xl border-2 border-primary/30 bg-primary/[0.03] p-5 card-glow transition-all relative">
              <div className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full bg-primary" title="Singlet Simplex 1.0" />
              <div className="flex items-center gap-2 mb-2">
                <Beaker size={16} className="text-primary" />
                <h3 className="font-display text-sm font-bold text-foreground">Perturbation Prediction</h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mb-2">Predict how knockouts, drugs, or overexpression change program activities — before you run the experiment.</p>
              <code className="font-mono text-[10px] text-primary/70">singlet.perturb(cell_type="hepatocyte", perturbation="PCSK9_KO")</code>
            </div>
            {[
              { icon: Activity, title: "Differential Programs", desc: "Compare any two conditions. Get named processes with magnitudes and confidence — not just gene lists.", code: 'singlet.compare(a={"NASH"}, b={"healthy"})', available: true },
              { icon: Target, title: "Gene Target Explorer", desc: "Query any gene across the entire atlas. Cell-type resolved expression, disease enrichment, and safety profiles.", code: 'singlet.gene_profile("TREM2")', available: true },
              { icon: Microscope, title: "Synthetic Cell Generation", desc: "Generate realistic synthetic cells for any condition locally. The API returns seeding vectors — you control the count.", code: 'result.generate(n_cells=1000)', available: true },
            ].map((cap) => {
              const Icon = cap.icon;
              return (
                <div key={cap.title} className="md:col-span-2 rounded-xl border-2 border-primary/30 bg-primary/[0.03] p-5 card-glow transition-all relative">
                  <div className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full bg-primary" title="Singlet Simplex 1.0" />
                  <div className="flex items-center gap-2 mb-2">
                    <Icon size={16} className="text-primary" />
                    <h3 className="font-display text-sm font-bold text-foreground">{cap.title}</h3>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-2">{cap.desc}</p>
                  <code className="font-mono text-[10px] text-primary/70">{cap.code}</code>
                </div>
              );
            })}
          </div>

          {/* Coming soon row */}
          <div className="grid md:grid-cols-4 gap-4 mt-4 stagger-fade">
            {[
              { icon: Dna, title: "Cross-Species Translation", desc: "Predict how a human disease program manifests in mouse — validate preclinical models computationally." },
              { icon: Clock, title: "Trajectory & Velocity", desc: "See which programs are ramping up or down through differentiation. Factor-resolved dynamics." },
              { icon: Layers, title: "Multimodal Prediction", desc: "Predict chromatin accessibility and protein levels from gene expression via bridge datasets." },
              { icon: MapPin, title: "Spatial Deconvolution", desc: "Deconvolute Visium spots into cell-type programs. Map tissue microenvironments computationally." },
            ].map((cap) => {
              const Icon = cap.icon;
              return (
                <div key={cap.title} className="rounded-xl border border-border bg-card p-5 card-glow transition-all relative opacity-60">
                  <div className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full bg-muted-foreground/30" title="Coming soon" />
                  <div className="flex items-center gap-2 mb-2">
                    <Icon size={16} className="text-muted-foreground" />
                    <h3 className="font-display text-sm font-bold text-muted-foreground">{cap.title}</h3>
                  </div>
                  <p className="text-xs text-muted-foreground/70 leading-relaxed">{cap.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="glow-line mx-auto max-w-4xl" />

      {/* ═══ WHY INTERPRETABLE ═══ */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <p className="section-dot font-mono text-xs text-primary uppercase tracking-widest mb-3">Why it matters</p>
          <h2 className="font-display text-3xl md:text-5xl font-bold text-foreground tracking-tightest mb-5">
            Real biology. <span className="gradient-text">Not black boxes.</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto mb-10">
            Singlet decomposes every prediction into named gene programs with effect sizes and p-values — the same statistics biologists already use in differential expression. You can immediately see which programs drive a result and by how much.
            <br /><br />
            <span className="text-muted-foreground/70">Transformer models require post-hoc explainable AI — SHAP scores, LIME, or attention analysis — to reverse-engineer what the model learned. Sometimes you don't even know which latent dimension matters until you generate data and try to explain it after the fact.</span>
          </p>

          {/* Visual explainer: programs vs embeddings */}
          <div className="grid md:grid-cols-2 gap-6 mb-10 text-left max-w-3xl mx-auto">
            <div className="rounded-xl border-2 border-primary/30 bg-primary/[0.03] p-5 relative">
              <div className="absolute -top-2.5 left-4 px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-[8px] font-mono font-bold uppercase tracking-wider">Singlet</div>
              <p className="text-[10px] text-primary/70 mt-1 mb-3 font-mono">Interpretable by design</p>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm"><div className="w-2 h-2 rounded-full bg-primary" /><span className="text-foreground font-medium">lipid_metabolism</span><span className="text-primary font-mono text-xs">{"↑ 2.3×  p=0.001"}</span></div>
                <div className="flex items-center gap-2 text-sm"><div className="w-2 h-2 rounded-full bg-primary/60" /><span className="text-foreground font-medium">inflammatory_NF-kB</span><span className="text-primary font-mono text-xs">{"↑ 1.8×  p=0.005"}</span></div>
                <div className="flex items-center gap-2 text-sm"><div className="w-2 h-2 rounded-full bg-primary/40" /><span className="text-foreground font-medium">mitochondrial_respiration</span><span className="text-primary font-mono text-xs">{"↓ 0.6×  p=0.02"}</span></div>
              </div>
              <p className="text-[10px] text-primary/70 mt-3 font-mono">Named programs → effect sizes → p-values → actionable</p>
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-5 relative opacity-60">
              <div className="absolute -top-2.5 left-4 px-2 py-0.5 rounded-full bg-muted-foreground/20 text-muted-foreground text-[8px] font-mono font-bold uppercase tracking-wider">Transformer models</div>
              <p className="text-[10px] text-muted-foreground/50 mt-1 mb-3 font-mono">Requires post-hoc explanation</p>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm"><div className="w-2 h-2 rounded-full bg-muted-foreground/30" /><span className="text-muted-foreground">dim_47</span><span className="text-muted-foreground/60 font-mono text-xs">0.823</span></div>
                <div className="flex items-center gap-2 text-sm"><div className="w-2 h-2 rounded-full bg-muted-foreground/30" /><span className="text-muted-foreground">dim_112</span><span className="text-muted-foreground/60 font-mono text-xs">-0.441</span></div>
                <div className="flex items-center gap-2 text-sm"><div className="w-2 h-2 rounded-full bg-muted-foreground/30" /><span className="text-muted-foreground">dim_203</span><span className="text-muted-foreground/60 font-mono text-xs">0.297</span></div>
              </div>
              <p className="text-[10px] text-muted-foreground/50 mt-3 font-mono">Generate → SHAP / LIME → hope the explanation is right</p>
            </div>
          </div>

          <Expandable label="See full model comparison table">
            <div className="rounded-xl border border-border bg-card overflow-hidden text-left">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-3 text-xs font-bold text-foreground uppercase tracking-wider" />
                      <th className="text-center px-4 py-3 text-xs font-bold text-primary uppercase tracking-wider border-x border-border bg-primary/[0.04]">Singlet Simplex 1.0</th>
                      <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Geneformer</th>
                      <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">scGPT</th>
                      <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">scVI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {[
                      { f: "Interpretable output", us: "Named programs", them: ["Embeddings", "Embeddings", "Latent z"] },
                      { f: "Explains predictions", us: "Yes — effect sizes + p-values", them: ["SHAP / LIME", "SHAP / LIME", "No"] },
                      { f: "Generative", us: "Yes", them: ["Fine-tune", "Yes", "Yes"] },
                      { f: "Inference", us: "~5 ms", them: ["~500 ms", "~200 ms", "~50 ms"] },
                      { f: "Cross-species", us: "Coming soon", them: ["—", "—", "—"] },
                      { f: "Perturbation", us: "Built-in", them: ["Fine-tune", "Fine-tune", "CPA ext."] },
                      { f: "Open-source programs", us: "10K+ named", them: ["No", "No", "No"] },
                    ].map((row) => (
                      <tr key={row.f}>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground font-medium">{row.f}</td>
                        <td className="px-4 py-2.5 text-xs text-center font-semibold text-primary border-x border-border bg-primary/[0.02]">{row.us}</td>
                        {row.them.map((v, j) => <td key={j} className="px-4 py-2.5 text-xs text-center text-muted-foreground">{v}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Expandable>
        </div>
      </section>

      <div className="glow-line mx-auto max-w-4xl" />

      {/* ═══ CODE ═══ */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <p className="section-dot font-mono text-xs text-primary uppercase tracking-widest mb-3 text-center">Developer experience</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground text-center tracking-tightest mb-3">
            Three lines from <span className="gradient-text">pip install</span> to insight
          </h2>
          <p className="text-center text-sm text-muted-foreground mb-10 max-w-xl mx-auto">Python, R, or your AI coding assistant via MCP. Same model, same interpretable results.</p>

          <div className="grid md:grid-cols-5 gap-6">
            <div className="md:col-span-3 rounded-xl border border-border overflow-hidden">
              <div className="flex border-b border-border">
                {(["python", "r", "mcp"] as const).map((t) => (
                  <button key={t} onClick={() => setCodeTab(t)} className={`flex-1 px-4 py-2.5 font-mono text-xs font-semibold transition-colors ${codeTab === t ? "text-primary bg-primary/5 border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}>
                    {t === "python" ? "Python" : t === "r" ? "R" : "MCP"}
                  </button>
                ))}
              </div>
              <div className="bg-background p-5">
                <pre className="font-mono text-xs leading-6 text-foreground overflow-x-auto whitespace-pre">
                  {(codeTab === "python" ? `import singlet

# Predict expression for any condition
result = singlet.predict(
    species="human", tissue="liver",
    cell_type="hepatocyte", disease="NASH"
)
result.programs        # named program activities
result.top_genes(5)    # top genes per program
result.confidence      # per-program uncertainty

# Predict perturbation effects
delta = singlet.perturb(
    cell_type="cardiomyocyte",
    perturbation="PCSK9_KO"
)
delta.affected_programs

# Explore any gene across the atlas
singlet.gene_profile("TREM2")` : codeTab === "r" ? `library(singlet)

# Predict expression for any condition
result <- singlet_predict(
    species = "human", tissue = "liver",
    cell_type = "hepatocyte", disease = "NASH"
)
result$programs
result$top_genes(5)

# Perturbation prediction
delta <- singlet_perturb(
    cell_type = "cardiomyocyte",
    perturbation = "PCSK9_KO"
)

# Gene programs
programs <- singlet_programs("lung")
profile <- gene_profile("TREM2")` : `// .vscode/mcp.json
{
  "servers": {
    "singlet": {
      "type": "http",
      "url": "https://mcp.singlet.bio"
    }
  }
}

// Then ask your AI assistant:
// "Predict hepatocytes in NASH"
// "What programs change when you knock out TP53?"
// "Show me the gene profile for TREM2"
// "Generate a reference for mouse bone marrow"`).split("\n").map((line, i) => {
                    if (line.startsWith("#") || line.startsWith("//")) return <div key={i} className="text-muted-foreground">{line}</div>;
                    return <div key={i}>{line}</div>;
                  })}
                </pre>
              </div>
            </div>

            <div className="md:col-span-2 flex flex-col gap-3 justify-center">
              {[
                { icon: Sparkles, title: "Generative, not retrieval", desc: "Predicts expression for conditions never observed. This is inference, not lookup." },
                { icon: Brain, title: "Every prediction explains itself", desc: "Named program activities with magnitudes. Know exactly which biology is driving the result." },
                { icon: Zap, title: "Millisecond inference", desc: "The decode is a matrix multiply. No transformer forward pass. ~5 ms per prediction." },
                { icon: Layers, title: "One model, unlimited questions", desc: "Expression, perturbation, differential programs, gene profiles, cross-species — all from one API." },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="rounded-lg border border-border bg-card px-4 py-3 flex items-start gap-3">
                    <Icon size={16} className="text-primary mt-0.5 flex-shrink-0" />
                    <div>
                      <h4 className="font-display text-xs font-bold text-foreground mb-0.5">{item.title}</h4>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <div className="glow-line mx-auto max-w-4xl" />

      {/* ═══ TRAINING DATA ═══ */}
      <section className="py-24 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/[0.02] to-transparent pointer-events-none" />
        <div className="max-w-6xl mx-auto relative">
          <p className="section-dot font-mono text-xs text-primary uppercase tracking-widest mb-3 text-center">Foundation</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground text-center tracking-tightest mb-3">
            A completely harmonized <span className="gradient-text">human cell atlas.</span>
          </h2>
          <p className="text-center text-muted-foreground max-w-xl mx-auto mb-10">
            Every cell reprocessed from raw reads through the same pipeline — same references, same QC, same parameters. When you query Singlet, you're querying the cleanest atlas in existence.
          </p>

          <div className="rounded-xl border border-border bg-card p-6 mb-8">
            <h3 className="font-display text-sm font-bold text-foreground mb-3">One pipeline. Every public single-cell dataset. Zero computational batch effects.</h3>
            <p className="text-xs text-muted-foreground mb-4">Every dataset — across species, chemistries, and labs — reprocessed through identical parameters, references, and QC. The result: the cleanest foundation for prediction.</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {["Raw reads", "Alignment", "QC", "Normalization", "Model", "Annotate"].map((step, i) => (
                <React.Fragment key={step}>
                  {i > 0 && <ChevronRight size={10} className="text-primary" />}
                  <span className="px-2.5 py-1 rounded-md border border-border bg-muted/40 font-mono text-[10px] text-foreground">{step}</span>
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="text-center mt-8">
            <p className="font-mono text-[10px] text-primary uppercase tracking-widest mb-3">Multi-species coverage</p>
            <div className="flex flex-wrap justify-center gap-1.5 max-w-3xl mx-auto">
              {["H.sapiens", "M.musculus", "D.rerio", "D.melanogaster", "R.norvegicus", "M.fascicularis"].map((sp) => (
                <span key={sp} className="px-2.5 py-1 rounded-full border border-border bg-muted/30 font-mono text-[10px] text-muted-foreground italic">{sp}</span>
              ))}
              <span className="px-2.5 py-1 rounded-full border border-primary/30 bg-primary/[0.08] font-mono text-[10px] text-primary font-semibold">10+ species</span>
            </div>

            <div className="flex flex-wrap gap-3 justify-center mt-8">
              <Link to="/browse" className="inline-flex items-center gap-2 px-5 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
                Browse the atlas <ArrowRight size={14} />
              </Link>
              <Link to="/atlas-docs" className="inline-flex items-center gap-2 px-5 py-2 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Atlas API docs
              </Link>
              <Link to="/validation" className="inline-flex items-center gap-2 px-5 py-2 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Validation results
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="glow-line mx-auto max-w-4xl" />

      {/* ═══ PRICING SNAPSHOT ═══ */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <p className="section-dot font-mono text-xs text-primary uppercase tracking-widest mb-3 text-center">Access</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground text-center tracking-tightest mb-3">
            Free programs. <span className="gradient-text">Scalable inference.</span>
          </h2>
          <p className="text-center text-muted-foreground max-w-xl mx-auto mb-10">
            The gene program dictionary is MIT open source. Inference scales from free to enterprise.
          </p>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="rounded-xl border-2 border-primary bg-card p-5 relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-mono font-bold uppercase tracking-wider">Most Popular</div>
              <div className="flex items-baseline gap-2 mb-3 mt-1">
                <span className="font-display text-lg font-bold text-foreground">Free</span>
              </div>
              <ul className="space-y-1.5 mb-4">
                {["Full CPM inference", "Open programs (MIT)", "MCP tools", "R + Python packages", "10 req/min"].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs"><Check size={13} className="text-green-600 flex-shrink-0" /><span className="text-muted-foreground">{f}</span></li>
                ))}
              </ul>
              <Link to="/docs" className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">Get Started <ArrowRight size={14} /></Link>
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-baseline gap-2 mb-3">
                <span className="font-display text-lg font-bold text-foreground">Pro</span>
                <span className="text-xs text-muted-foreground"><span className="text-foreground font-semibold">$100</span>/mo</span>
              </div>
              <ul className="space-y-1.5 mb-4">
                {["Everything in Free", "100 req/min", "Batch inference API", "Bring Your Own Data", "Commercial license"].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs"><Check size={13} className="text-green-600 flex-shrink-0" /><span className="text-muted-foreground">{f}</span></li>
                ))}
              </ul>
              <Link to="/pricing" className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-md border border-border bg-secondary text-secondary-foreground text-sm font-medium hover:bg-muted transition-colors">See Plans <ArrowRight size={14} /></Link>
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-baseline gap-2 mb-3">
                <span className="font-display text-lg font-bold text-foreground">Enterprise</span>
                <span className="text-xs text-muted-foreground">Contact sales</span>
              </div>
              <ul className="space-y-1.5 mb-4">
                {["Custom rate limits", "Custom model training", "Bring Your Own Data", "Unlimited seats", "SLA + support"].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs"><Check size={13} className="text-green-600 flex-shrink-0" /><span className="text-muted-foreground">{f}</span></li>
                ))}
              </ul>
              <a href="mailto:hello@singlet.bio?subject=Singlet%20Bio%20Enterprise" className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-md border border-border bg-secondary text-secondary-foreground text-sm font-medium hover:bg-muted transition-colors">Contact Sales</a>
            </div>
          </div>
        </div>
      </section>


      {/* ═══ TRUST SIGNALS ═══ */}
      <section className="py-16 px-6 border-t border-border relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/[0.02] via-transparent to-primary/[0.02] pointer-events-none" />
        <div className="max-w-5xl mx-auto relative">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { icon: Shield, label: "Hosted by CZI", sub: "Proof-of-concept NMF models on CELLxGENE Census" },
              { icon: FlaskConical, label: "MIT-licensed programs", sub: "10,000+ gene programs — open source" },
              { icon: Users, label: "319K+ CRAN downloads", sub: "NMF implementations trusted by the research community" },
              { icon: BookOpen, label: "Open source", sub: "Permissively licensed — free for research and commercial use" },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="flex flex-col items-center gap-2 group">
                  <div className="w-10 h-10 rounded-full bg-primary/[0.08] flex items-center justify-center group-hover:bg-primary/[0.15] transition-colors">
                    <Icon size={18} className="text-primary" />
                  </div>
                  <p className="text-xs font-semibold text-foreground">{item.label}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">{item.sub}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="glow-line mx-auto max-w-4xl" />

      {/* ═══ CLOSING ═══ */}
      <section className="py-20 px-6 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-primary/[0.06] blur-[120px]" />
        </div>
        <div className="max-w-3xl mx-auto text-center relative">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground leading-snug tracking-tight mb-3">
            The first model that speaks biology, not linear algebra.
          </h2>
          <p className="text-sm text-muted-foreground mb-8 max-w-lg mx-auto">
            Start with five lines of Python. Get named programs, predictions, and generated cells — all interpretable, all free for research.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link to="/docs" className="shimmer-border inline-flex items-center gap-2 px-6 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
              Start building <ArrowRight size={14} />
            </Link>
            <Link to="/gene-programs" className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Explore the programs
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Index;
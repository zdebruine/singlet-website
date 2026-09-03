import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight, ChevronRight, Check, Database, Cloud, GitBranch,
  Zap, Shield, BookOpen, Boxes, Download, Gauge, Server, Copy, Sparkles, Search
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/integrations/api/client";

/* ── Live Cell Counter (count-up from API total_cells) ── */
function useCountUp(end: number, duration = 2000, enabled = true) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);
  useEffect(() => {
    // Never animate before the stats request resolves — a 0/undefined target
    // made the counters flash a bogus (sometimes negative) value.
    if (!enabled || !end || end <= 0) return;
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
            setCount(Math.round(eased * end));
            if (progress < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [end, duration, enabled]);
  return { ref, count };
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
        c.x += c.vx; c.y += c.vy;
        if (c.x < -10) c.x = canvas.width + 10;
        if (c.x > canvas.width + 10) c.x = -10;
        if (c.y < -10) c.y = canvas.height + 10;
        if (c.y > canvas.height + 10) c.y = -10;
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(174, 84%, 42%, ${c.opacity})`;
        ctx.fill();
        for (const other of cells) {
          const dx = c.x - other.x; const dy = c.y - other.y;
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

/* ── Code Snippet with copy ── */
function SnippetBox({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative rounded-xl border border-border bg-background/80 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-destructive/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
          <span className="ml-2 font-mono text-[10px] text-muted-foreground">python3</span>
        </div>
        <button
          onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          {copied ? <><Check size={10} /> Copied</> : <><Copy size={10} /> Copy</>}
        </button>
      </div>
      <pre className="p-4 font-mono text-xs leading-6 text-foreground overflow-x-auto whitespace-pre">
        {code.split("\n").map((line, i) => (
          <div key={i} className={line.trimStart().startsWith("#") ? "text-muted-foreground" : ""}>{line}</div>
        ))}
      </pre>
    </div>
  );
}

/* ── Value-prop callout card ── */
function ValueProp({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-4 py-3">
      <Check size={13} className="text-primary mt-0.5 flex-shrink-0" />
      <span className="text-sm text-foreground/80 leading-snug">{children}</span>
    </div>
  );
}

/* ── Pillar Card ── */
const Pillar = ({ icon: Icon, title, desc, code }: { icon: React.ElementType; title: string; desc: string; code: string }) => (
  <div className="rounded-xl border-2 border-primary/30 bg-primary/[0.03] p-6 card-glow transition-all relative">
    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center mb-3"><Icon size={18} className="text-primary" /></div>
    <h3 className="font-display text-base font-bold text-foreground mb-2">{title}</h3>
    <p className="text-sm text-muted-foreground leading-relaxed mb-3">{desc}</p>
    <div className="rounded-lg bg-muted/30 border border-border px-3 py-2">
      <code className="font-mono text-[11px] text-primary">{code}</code>
    </div>
  </div>
);

/* ───────────────────── PAGE ───────────────────── */
const Index = () => {
  const [codeTab, setCodeTab] = useState<"python" | "r">("python");
  const [nlQuery, setNlQuery] = useState("");
  const navigate = useNavigate();

  const runNlSearch = () => {
    const q = nlQuery.trim();
    if (!q) return;
    navigate(`/browse?nl=${encodeURIComponent(q)}`);
  };

  // Live stats from API
  const { data: corpusStats, isSuccess: statsReady } = useQuery({
    queryKey: ["corpus-stats"],
    queryFn: () => apiClient.stats(),
    staleTime: 60_000,
  });

  const totalCells = corpusStats?.total_cells ?? 0;
  const totalSamples = corpusStats?.total_samples ?? 0;
  const totalSeries = corpusStats?.series_count ?? 0;

  // Animated live cell counter
  const { ref: cellRef, count: cellCount } = useCountUp(totalCells, 2400, statsReady);
  const { ref: sampleRef, count: sampleCount } = useCountUp(totalSamples, 1800, statsReady);
  const { ref: seriesRef, count: seriesCount } = useCountUp(totalSeries, 1600, statsReady);
  const Skeleton = () => <span className="inline-block h-8 w-24 rounded bg-muted animate-pulse align-middle" />;

  const fmt = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return n.toLocaleString();
  };

  const LOAD_SNIPPET = `import singlet

# Load directly — no download needed
adata = singlet.load("GSE149298")
print(adata)  # AnnData: cells × genes

# A list/array of accessions or .singlet files → one concatenated AnnData
adata = singlet.load(["GSE149298", "GSE184652"])

# Or search in plain English, then load
accs = singlet.find("T cells from pediatric AML")
adata = singlet.find_load("microglia in Alzheimer's disease")`;

  const R_SNIPPET = `library(singlet)

# Load as SingleCellExperiment
sce <- load("GSE149298")
sce

# Combine several series, or load as Seurat
sce <- load(c("GSE149298", "GSE184652"))
seu <- load("GSE149298", as = "seurat")

# Search in plain English
accs <- find("T cells from pediatric AML")`;

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
            <a
              href="https://github.com/Singlet-Bio/singlet#installation"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/[0.08] text-xs font-mono text-primary hover:bg-primary/[0.14] transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              Install from source — PyPI coming soon
            </a>
          </div>

          <h1 className="font-display text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-[0.95] tracking-tightest mb-5">
            <span className="block">Every public single-cell dataset.</span>
            <span className="block gradient-text">One import away.</span>
          </h1>

          <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed mb-8">
            Millions of cells, uniformly reprocessed from raw reads — streamed on demand from Cloudflare R2 with zero egress cost. No downloads. No batch effects. No account needed.
          </p>

          {/* Live animated stats */}
          <div className="flex flex-wrap justify-center gap-8 mb-10 py-5 px-6 rounded-2xl border border-border bg-card/60 max-w-2xl mx-auto">
            <div className="text-center">
              <span ref={cellRef} className="block font-display text-3xl font-bold gradient-text">
                {statsReady && totalCells > 0 ? fmt(cellCount) : <Skeleton />}
              </span>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">cells</span>
            </div>
            <div className="text-center">
              <span ref={sampleRef} className="block font-display text-3xl font-bold text-foreground">
                {statsReady && totalSamples > 0 ? fmt(sampleCount) : <Skeleton />}
              </span>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">samples</span>
            </div>
            <div className="text-center">
              <span ref={seriesRef} className="block font-display text-3xl font-bold text-foreground">
                {statsReady && totalSeries > 0 ? seriesCount.toLocaleString() : <Skeleton />}
              </span>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">GEO series</span>
            </div>
          </div>

          {/* Natural-language (AI) search */}
          <div className="max-w-xl mx-auto mb-6">
            <div className="flex gap-2 items-stretch">
              <div className="relative flex-1">
                <Sparkles size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-primary" />
                <input
                  type="text"
                  placeholder={'Ask in plain English — "T cells from pediatric AML"'}
                  value={nlQuery}
                  onChange={(e) => setNlQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") runNlSearch(); }}
                  className="w-full pl-10 pr-4 py-3 rounded-md border border-primary/30 bg-card/80 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <button
                onClick={runNlSearch}
                disabled={!nlQuery.trim()}
                className="inline-flex items-center gap-1.5 px-5 py-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                <Sparkles size={14} /> AI Search
              </button>
            </div>
          </div>

          {/* Primary CTAs */}
          <div className="flex flex-wrap gap-4 justify-center">
            <Link to="/browse" className="shimmer-border inline-flex items-center gap-2 px-7 py-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
              Browse Atlas <ArrowRight size={14} />
            </Link>
            <Link to="/docs/access" className="inline-flex items-center gap-2 px-7 py-3 rounded-md border border-border bg-secondary text-secondary-foreground text-sm font-medium hover:bg-muted transition-colors">
              Download
            </Link>
          </div>

          <p className="text-xs text-muted-foreground/50 mt-5 font-mono tracking-wide">
            CC0 public domain · MIT pipeline · Cloudflare R2 · No account required
          </p>
        </div>
      </section>

      {/* ═══ VALUE PROPS ═══ */}
      <section className="py-14 px-6 border-y border-border relative">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/[0.03] via-transparent to-primary/[0.03] pointer-events-none" />
        <div className="max-w-5xl mx-auto relative">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <ValueProp>Every cell, $0 egress — free forever (Cloudflare R2)</ValueProp>
            <ValueProp>CC0 public domain — no attribution required</ValueProp>
            <ValueProp>Includes failed samples, fully documented</ValueProp>
            <ValueProp>One <code className="font-mono text-xs bg-muted px-1 rounded">.singlet</code> → AnnData / Seurat / SCE / parquet on your machine</ValueProp>
            <ValueProp>Search in plain English — describe what you want, get matching datasets</ValueProp>
            <ValueProp>No account, no API key — open by default</ValueProp>
          </div>
        </div>
      </section>

      <div className="glow-line mx-auto max-w-4xl" />

      {/* ═══ CODE SNIPPET ═══ */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <p className="section-dot font-mono text-xs text-primary uppercase tracking-widest mb-3 text-center">Quickstart</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-3 text-center">
            One import. <span className="gradient-text">Any dataset.</span>
          </h2>
          <p className="text-center text-sm text-muted-foreground mb-8 max-w-xl mx-auto">
            Install once. Load any GEO accession directly from the Atlas — or filter the catalog to find exactly what you need.
          </p>

          <div className="rounded-xl border border-border overflow-hidden mb-4">
            <div className="flex border-b border-border">
              {(["python", "r"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setCodeTab(t)}
                  className={`px-5 py-2.5 font-mono text-xs font-semibold transition-colors ${codeTab === t ? "text-primary bg-primary/5 border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {t === "python" ? "Python" : "R"}
                </button>
              ))}
            </div>
            <div className="p-4">
              <SnippetBox code={codeTab === "python" ? LOAD_SNIPPET : R_SNIPPET} />
            </div>
          </div>

          <div className="text-center">
            <Link to="/docs/access" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
              Full programmatic access docs <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </section>

      <div className="glow-line mx-auto max-w-4xl" />

      {/* ═══ THREE PILLARS ═══ */}
      <section className="py-24 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/[0.02] to-transparent pointer-events-none" />
        <div className="max-w-6xl mx-auto relative">
          <p className="section-dot font-mono text-xs text-primary uppercase tracking-widest mb-3 text-center">What you get</p>
          <h2 className="font-display text-3xl md:text-5xl font-bold text-foreground text-center tracking-tightest mb-3">
            Data, loaders, and the pipeline that built them.
          </h2>
          <p className="text-center text-muted-foreground max-w-xl mx-auto mb-12">
            Everything you need to work with public single-cell data — and to process your own.
          </p>

          <div className="grid md:grid-cols-3 gap-5 stagger-fade">
            <Pillar
              icon={Database}
              title="Harmonized Atlas"
              desc="Every public human single-cell RNA-seq dataset, reprocessed from raw reads through one identical pipeline. Same references, same QC, same gene space — across every lab and study."
              code='singlet.load("GSE149298")'
            />
            <Pillar
              icon={Search}
              title="Search in Plain English"
              desc="Describe what you want — tissue, cell type, disease, organism, protocol — and Claude translates it into atlas filters. On the website, in the package, or via the MCP tool."
              code='singlet.find("T cells in AML")'
            />
            <Pillar
              icon={GitBranch}
              title="Open Pipeline (BYOD)"
              desc="The same MIT-licensed pipeline turns your own SRA or FASTQ into harmonized matrices mapped to the identical references, so your data sits alongside the public atlas."
              code='singlet-pipeline run SRR…'
            />
          </div>
        </div>
      </section>

      <div className="glow-line mx-auto max-w-4xl" />

      {/* ═══ OPEN & REPRODUCIBLE ═══ */}
      <section className="py-20 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/[0.03] via-transparent to-primary/[0.03] pointer-events-none" />
        <div className="max-w-5xl mx-auto relative">
          <p className="section-dot font-mono text-xs text-primary uppercase tracking-widest mb-3 text-center">Open by design</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground text-center tracking-tightest mb-3">
            Publicly funded. <span className="gradient-text">Permanently open.</span>
          </h2>
          <p className="text-center text-muted-foreground max-w-2xl mx-auto mb-12">
            Built on NSF ACCESS supercomputers. Data, loaders, and pipeline are all MIT licensed.
            Served free forever from Cloudflare R2.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { icon: BookOpen, label: "CC0 Data", sub: "Public domain — no attribution, no restrictions, ever" },
              { icon: Server, label: "NSF ACCESS", sub: "Reprocessed on publicly funded supercomputers" },
              { icon: Download, label: "Zenodo Archive", sub: "Every release has a permanent, citable DOI" },
              { icon: Cloud, label: "$0 Egress", sub: "Cloudflare R2 — fast from anywhere, no egress fees" },
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

      {/* ═══ TRUST SIGNALS ═══ */}
      <section className="py-16 px-6 border-t border-border relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/[0.02] via-transparent to-primary/[0.02] pointer-events-none" />
        <div className="max-w-5xl mx-auto relative">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { icon: Database, label: "1B+ cells", sub: "Uniformly reprocessed from raw reads" },
              { icon: Shield, label: "No batch effects", sub: "Same references, QC, and normalization throughout" },
              { icon: Gauge, label: "GPU-native loaders", sub: "Zero-copy streaming straight into PyTorch" },
              { icon: Boxes, label: "AnnData / Seurat / SCE", sub: "Drop-in formats — use your existing tools" },
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

      {/* ═══ CLOSING CTA ═══ */}
      <section className="py-20 px-6 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-primary/[0.06] blur-[120px]" />
        </div>
        <div className="max-w-3xl mx-auto text-center relative">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground leading-snug tracking-tight mb-3">
            The world's single-cell data, ready to use.
          </h2>
          <p className="text-sm text-muted-foreground mb-8 max-w-lg mx-auto">
            <span className="font-mono text-foreground">pip install from GitHub</span>, then load any GEO accession — or stream millions of cells directly into your model.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link to="/browse" className="shimmer-border inline-flex items-center gap-2 px-6 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
              Browse Atlas <ArrowRight size={14} />
            </Link>
            <Link to="/docs/access" className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Download
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Index;

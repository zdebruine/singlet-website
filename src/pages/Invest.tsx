import React, { useState, useEffect, useCallback } from "react";
import { ArrowRight, Menu, X, Check, Zap, Target, TrendingUp, Beaker } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import debruinePhoto from "@/assets/debruine.png";

import bookerPhoto from "@/assets/booker.png";
import adkinsPhoto from "@/assets/adkins.png";
import buppPhoto from "@/assets/bupp.png";
import pospisilikPhoto from "@/assets/pospisilik.png";
import { CorpusSection, ComputeSection, usePipelineMetrics } from "@/components/PipelineDashboard";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/* ── Section definitions ── */
const SECTIONS = [
  { id: "headline", label: "01 — Overview", n: "01" },
  { id: "problem", label: "02 — Problem", n: "02" },
  { id: "solution", label: "03 — Solution", n: "03" },
  { id: "traction", label: "04 — Traction", n: "04" },
  { id: "corpus", label: "05 — Data Corpus", n: "05" },
  { id: "compute", label: "06 — Live Compute", n: "06" },
  { id: "market", label: "07 — Market", n: "07" },
  { id: "model", label: "08 — Business", n: "08" },
  { id: "team", label: "09 — Team", n: "09" },
  { id: "ask", label: "10 — The Ask", n: "10" },
] as const;

/* ── Request Deck Modal ── */
const RequestDeckModal = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) => {
  const [submitted, setSubmitted] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">Request Investor Deck</DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            We will send you the full deck within 24 hours.
          </DialogDescription>
        </DialogHeader>
        {submitted ? (
          <div className="py-8 text-center">
            <p className="text-foreground font-display text-lg font-semibold mb-2">Thank you!</p>
            <p className="text-sm text-muted-foreground">We will be in touch shortly.</p>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }} className="space-y-4 mt-2">
            <Input placeholder="Full name" required className="bg-background border-border text-foreground placeholder:text-muted-foreground" />
            <Input type="email" placeholder="Email" required className="bg-background border-border text-foreground placeholder:text-muted-foreground" />
            <Input placeholder="Firm / Fund" className="bg-background border-border text-foreground placeholder:text-muted-foreground" />
            <Textarea placeholder="One-line message (optional)" rows={2} className="bg-background border-border text-foreground placeholder:text-muted-foreground resize-none" />
            <Button type="submit" className="w-full">Send Request <ArrowRight size={14} /></Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

/* ── Hooks ── */
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

/* ── Section wrapper with number ── */
const Section = ({ id, n, children }: { id: string; n: string; children: React.ReactNode }) => (
  <section id={id} className="py-20 relative">
    <span className="absolute -left-2 lg:-left-14 top-20 font-mono text-[10px] text-muted-foreground/30 font-bold tracking-widest select-none hidden lg:block">{n}</span>
    <div className="glow-line mb-12" />
    {children}
  </section>
);

/* ── Investor Q&A item ── */
const QA = ({ q, a }: { q: string; a: string }) => (
  <AccordionItem value={q} className="rounded-lg border border-border bg-card overflow-hidden">
    <AccordionTrigger className="px-5 py-3.5 hover:no-underline">
      <span className="text-sm font-medium text-foreground text-left">{q}</span>
    </AccordionTrigger>
    <AccordionContent className="px-5 pb-4 pt-0">
      <p className="text-xs text-muted-foreground leading-relaxed">{a}</p>
    </AccordionContent>
  </AccordionItem>
);

/* ── Use of Funds data ── */
const fundsData = [
  { name: "ML Engineer", value: 36, color: "hsl(174, 84%, 32%)" },
  { name: "Infrastructure", value: 24, color: "hsl(200, 70%, 55%)" },
  { name: "Complete Atlas", value: 9, color: "hsl(152, 60%, 45%)" },
  { name: "Ops + Legal", value: 10, color: "hsl(38, 80%, 55%)" },
  { name: "Web + API", value: 6, color: "hsl(265, 50%, 55%)" },
  { name: "Buffer", value: 15, color: "hsl(0, 0%, 65%)" },
];

const Invest = () => {
  const { data: pipelineData } = usePipelineMetrics();
  const [deckOpen, setDeckOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const sectionIds = SECTIONS.map((s) => s.id);
  const activeId = useScrollspy(sectionIds);
  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setMobileNavOpen(false);
  }, []);

  const activeIndex = SECTIONS.findIndex((s) => s.id === activeId);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Mobile TOC */}
      <button
        onClick={() => setMobileNavOpen(!mobileNavOpen)}
        className="fixed bottom-6 left-6 z-50 lg:hidden w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg print:hidden"
        aria-label="Table of contents"
      >
        {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
      </button>
      {mobileNavOpen && (
        <nav className="fixed inset-0 z-40 lg:hidden bg-background/95 backdrop-blur-xl flex flex-col items-start justify-center px-10 space-y-5">
          {SECTIONS.map((s) => (
            <button key={s.id} onClick={() => scrollTo(s.id)} className={"font-display text-lg transition-colors " + (activeId === s.id ? "text-primary font-semibold" : "text-muted-foreground hover:text-foreground")}>
              {s.label}
            </button>
          ))}
        </nav>
      )}

      {/* Desktop sidebar */}
      <nav className="hidden lg:flex fixed left-0 top-14 bottom-0 w-56 flex-col justify-center pl-8 pr-4 z-30 print:!hidden">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 w-[2px] h-48 bg-border rounded-full overflow-hidden">
          <div className="w-full bg-primary rounded-full transition-all duration-500" style={{ height: ((activeIndex + 1) / SECTIONS.length * 100) + "%" }} />
        </div>
        <ul className="space-y-3">
          {SECTIONS.map((s, i) => (
            <li key={s.id}>
              <button onClick={() => scrollTo(s.id)} className={"text-left text-[13px] leading-tight transition-all duration-200 " + (activeId === s.id ? "text-primary font-semibold translate-x-1" : i <= activeIndex ? "text-foreground/60" : "text-muted-foreground/50 hover:text-foreground/60")}>
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Content */}
      <div className="lg:ml-56 max-w-3xl mx-auto px-6 lg:px-10">

        {/* 01 — HERO */}
        <section id="headline" className="pt-32 pb-24">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-muted/30 text-xs text-muted-foreground font-mono mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            Shared by invitation only
          </div>
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-6">Singlet Bio — Pre-Seed</p>

          <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground leading-[1.05] tracking-tightest mb-6">
            Interpretable AI for<br />
            <span className="gradient-text">single-cell genomics.</span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed mb-8">
            We built the largest uniformly reprocessed single-cell atlas and designed a generative model that will predict gene expression with <span className="text-foreground font-semibold">named biological programs — not black-box embeddings</span>. Validated by CZI. Atlas and engine built on university compute by one person.
          </p>

          <div className="grid grid-cols-3 gap-4 mb-8">
            {[
              { value: "TBD", label: "Pre-seed raise" },
              { value: "TBD", label: "Runway" },
              { value: "90%+", label: "Target gross margin" },
            ].map((m) => (
              <div key={m.label} className="text-center">
                <div className="font-mono text-2xl md:text-3xl font-bold text-foreground">{m.value}</div>
                <p className="text-xs text-muted-foreground mt-1">{m.label}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button size="lg" className="shimmer-border" onClick={() => setDeckOpen(true)}>
              Request Deck <ArrowRight size={14} />
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href="mailto:zach@singletdb.com">Schedule a Call</a>
            </Button>
          </div>
          <div className="glow-line mt-16" />
        </section>

        {/* 02 — PROBLEM */}
        <Section id="problem" n="02">
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">The Problem</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-6">
            Every foundation model for genomics is a black box.
          </h2>

          <p className="text-muted-foreground leading-relaxed mb-8">
            Single-cell genomics is a <span className="text-foreground font-semibold">$4.9B market growing 19% annually</span> (Grand View Research, 2024). Foundation models — Geneformer, scGPT, scVI — can learn cell representations, but their outputs are opaque embedding vectors. A biologist cannot read them, validate them, or design experiments from them.
          </p>

          <div className="grid md:grid-cols-2 gap-4 mb-8">
            <div className="rounded-lg border border-red-500/20 bg-red-500/[0.04] p-5">
              <p className="text-xs font-mono text-red-500/70 uppercase tracking-wider mb-2">Black-box output</p>
              <p className="font-mono text-sm text-muted-foreground leading-relaxed">
                "Embedding dimension 47 increased by 0.3 units in disease state."
              </p>
              <p className="text-xs text-red-500/50 mt-2">What does that mean? No one knows.</p>
            </div>
            <div className="rounded-lg border border-primary/30 bg-primary/[0.04] p-5">
              <p className="text-xs font-mono text-primary uppercase tracking-wider mb-2">Interpretable output</p>
              <p className="font-mono text-sm text-foreground leading-relaxed">
                "Lipid metabolism program +2.3x, driven by FASN, SCD, ACACA."
              </p>
              <p className="text-xs text-primary/70 mt-2">Named programs. Actionable biology.</p>
            </div>
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed">
            The interpretability gap matters because <span className="text-foreground font-semibold">trust creates adoption</span>. Pharma companies will not base drug development decisions on outputs they cannot explain. Clinicians will not trust variant interpretations from a model that cannot show its reasoning. The market is waiting for a model that speaks biology, not linear algebra.
          </p>

          <Accordion type="multiple" className="mt-8 space-y-2">
            <QA q="Why not just interpret transformer embeddings post-hoc?"
              a="You can project transformer embeddings onto known gene sets, but the embedding space itself is not structured for interpretability. The decomposition is lossy and ad-hoc. NMF programs are interpretable by construction — every factor has a fixed gene loading that maps directly to a biological program. The difference is architectural: we do not retrofit interpretability, we build it in." />
            <QA q="Who are the main competitors?"
              a="Geneformer (Harvard/Broad, 104M cells, 316M params), scGPT (Toronto, 33M cells), scVI (Weizmann/scverse), TranscriptFormer (CZI, 110M cells). All produce embeddings. We produce named programs. scVI is per-dataset; the others are at atlas scale. None offer commercial inference APIs today." />
          </Accordion>
        </Section>

        {/* 03 — SOLUTION */}
        <Section id="solution" n="03">
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">The Solution</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-3">
            The Conditional Program Model
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-8">
            NMF gene programs define a vocabulary of named biological processes. A conditional encoder maps any biological condition to program activities. The decode is a single matrix multiply. The result: a generative model that predicts gene expression in named, interpretable terms — in under 12 milliseconds.
          </p>

          {/* Architecture flow */}
          <div className="rounded-lg border border-border bg-card p-6 mb-8 overflow-x-auto">
            <div className="flex items-center gap-2 flex-wrap font-mono text-xs min-w-[600px]">
              {[
                { label: "Condition", sub: "tissue, cell type, disease" },
                { label: "Encoder", sub: "cross-attention + MLP" },
                { label: "Programs", sub: "10,000+ named dims" },
                { label: "W · h", sub: "matrix multiply" },
                { label: "Expression", sub: "~30,000 genes" },
              ].map((step, i) => (
                <React.Fragment key={i}>
                  <div className="px-3 py-2 rounded border border-border bg-background text-center min-w-[110px]">
                    <span className="text-foreground font-semibold block">{step.label}</span>
                    <span className="text-muted-foreground text-[10px]">{step.sub}</span>
                  </div>
                  {i < 4 && <ArrowRight size={12} className="text-primary flex-shrink-0" />}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Comparison table */}
          <div className="overflow-x-auto rounded-lg border border-border mb-8">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 text-left font-semibold text-foreground">Property</th>
                  <th className="px-4 py-3 text-left font-semibold text-primary">Singlet Simplex 1.0</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Geneformer</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">scGPT</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">scVI</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { cap: "Output", us: "Named programs", a: "Embeddings", b: "Embeddings", c: "Latent z" },
                  { cap: "Interpretable", us: "Yes — per-program", a: "No", b: "No", c: "No" },
                  { cap: "Generative", us: "Any condition", a: "Fine-tune only", b: "Yes", c: "Yes" },
                  { cap: "Inference", us: "<1ms", a: "~500ms", b: "~200ms", c: "~50ms" },
                  { cap: "Training data", us: "1.9B cells", a: "104M cells", b: "33M cells", c: "Per-dataset" },
                  { cap: "Perturbation", us: "Built-in", a: "Fine-tune", b: "Fine-tune", c: "Extension" },
                  { cap: "Cross-species", us: "Yes (bridges)", a: "No", b: "No", c: "No" },
                ].map((row) => (
                  <tr key={row.cap} className="border-b border-border/50">
                    <td className="px-4 py-2.5 font-medium text-foreground text-xs">{row.cap}</td>
                    <td className="px-4 py-2.5 text-xs"><span className="inline-flex items-center gap-1.5"><Check size={13} className="text-emerald-600 flex-shrink-0" /><span className="text-foreground font-medium">{row.us}</span></span></td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.a}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.b}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="font-display text-base font-semibold text-foreground mb-4">What the API does</h3>
          <div className="grid md:grid-cols-2 gap-3 mb-8">
            {[
              { icon: Beaker, title: "Predict expression", desc: "Any cell type, any condition — even unobserved combinations.", phase: "Phase 1" },
              { icon: Target, title: "Predict perturbation effects", desc: "Gene knockouts and drug treatments mapped to program-level changes.", phase: "Phase 1" },
              { icon: TrendingUp, title: "Compare conditions", desc: "Named differential programs between any two biological states.", phase: "Phase 1" },
              { icon: Zap, title: "Cross-species translation", desc: "Independent models per species with learned bridges.", phase: "Phase 2" },
            ].map((cap) => (
              <div key={cap.title} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <cap.icon size={14} className="text-primary" />
                  <h4 className="text-xs font-semibold text-foreground">{cap.title}</h4>
                  <span className="ml-auto px-1.5 py-0.5 rounded text-[9px] font-mono text-primary bg-primary/10">{cap.phase}</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{cap.desc}</p>
              </div>
            ))}
          </div>

          <Accordion type="multiple" className="space-y-2">
            <QA q="How is NMF competitive with transformers?"
              a="Different tool for a different job. Transformers excel at learning dense representations — useful for embedding search and transfer learning. NMF excels at additive decomposition — every prediction is a weighted sum of named programs that a biologist can read. For drug target identification, regulatory analysis, and clinical interpretation, interpretability is a requirement, not a nice-to-have. Our NMF engine is also 40x faster at inference and has been validated by CZI alongside Geneformer and scGPT on CELLxGENE Census." />
            <QA q="What about CZI's TranscriptFormer?"
              a="TranscriptFormer (2025) is the newest CZI foundation model, trained on 110M cells across 5 species. It is impressive — and it produces embeddings. CZI builds open research infrastructure (they host our NMF alongside their models). They do not build commercial products. Our relationship with CZI is complementary, not competitive." />
            <QA q="What is the long-term vision beyond the CPM?"
              a="Phase 1: CPM inference API (the current raise). Phase 2: Sequence-to-function head using Borzoi/AlphaGenome — predict variant effects at cell-type resolution. Phase 3: Clinical genomics intelligence for rare disease diagnosis. Each phase is independently valuable as a business. We are raising for Phase 1." />
          </Accordion>
        </Section>

        {/* 04 — TRACTION */}
        <Section id="traction" n="04">
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">What We Have Built</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-3">
            The hard part is done.
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-8">
            This is not a slide deck with a roadmap. The atlas exists. The NMF engine is published. The architecture is designed. We need capital to train the encoder and ship the API.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
            {[
              { value: "Largest", label: "Uniformly reprocessed single-cell atlas", sub: "From FASTQ, one pipeline" },
              { value: "200+", label: "Species covered", sub: "vs CZI's 5" },
              { value: "323K+", label: "CRAN downloads", sub: "RcppML NMF engine" },
              { value: "~$400K", label: "CZI grants funded", sub: "Cycles 1 & 3" },
              { value: "CZI", label: "NMF hosted on CELLxGENE Census", sub: "Alongside Geneformer & scGPT" },
              { value: "<1ms", label: "Inference speed", sub: "Single matrix multiply" },
            ].map((m) => (
              <div key={m.label} className="rounded-lg border border-border bg-card p-4">
                <div className="font-mono text-xl font-bold text-foreground mb-1">{m.value}</div>
                <p className="text-xs text-foreground font-medium leading-snug mb-0.5">{m.label}</p>
                <p className="text-[10px] text-muted-foreground">{m.sub}</p>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-4 mb-8">
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.03] p-5">
              <p className="text-xs font-mono text-emerald-600 uppercase tracking-wider mb-3 font-semibold">Built</p>
              <ul className="space-y-2 text-xs text-muted-foreground">
                {[
                  "Atlas-scale FASTQ reprocessing pipeline",
                  "NMF engine (Bioinformatics pub, CRAN package)",
                  "~10x compression with GPU streaming",
                  "CZI validation — NMF on CELLxGENE Census",
                  "CPM architecture designed",
                  "NSF ACCESS compute allocation",
                  "Splicing layers (S/U/A) — structural moat",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check size={13} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-border bg-card p-5">
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3 font-semibold">Still to do</p>
              <ul className="space-y-2 text-xs text-muted-foreground">
                {[
                  "Train CPM encoder",
                  "Ship inference API",
                  "Build web dashboard",
                  "Acquire first paying customer",
                  "Hire ML engineer",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <div className="w-3.5 h-3.5 rounded-sm border border-border mt-0.5 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <Accordion type="multiple" className="space-y-2">
            <QA q="What exactly is the atlas?"
              a="Every dataset in NCBI GEO with single-cell data — thousands of series, hundreds of species — reprocessed from raw FASTQ reads through one standardized pipeline. Same parameters, same references, same QC. Every cell is directly comparable. CZI CELLxGENE Census takes author-processed data (different pipelines, different quality). Our uniform reprocessing is what makes atlas-scale NMF training possible." />
            <QA q="Why is CZI hosting your NMF?"
              a="We contributed NMF embeddings to CELLxGENE Census in 2023. CZI selected it alongside Geneformer, scGPT, UCE, and TranscriptFormer — the only non-transformer approach on the platform. This is not a partnership in the corporate sense — it is open-science data sharing. But it validates that our approach is taken seriously by the most important institution in the space." />
            <QA q="What are splicing layers and why do they matter?"
              a="When we process raw FASTQ, we quantify not just total gene expression but spliced, unspliced, and ambiguous RNA (S/U/A). These layers enable RNA velocity analysis — predicting where cells are going in developmental or disease trajectories. CZI cannot add this because they take pre-processed counts. It is a structural advantage that requires FASTQ-level reprocessing." />
          </Accordion>
        </Section>

        {/* 05 — DATA CORPUS */}
        {pipelineData && (
          <Section id="corpus" n="05">
            <CorpusSection data={pipelineData} />
          </Section>
        )}

        {/* 06 — LIVE COMPUTE */}
        {pipelineData && (
          <Section id="compute" n="06">
            <ComputeSection data={pipelineData} />
          </Section>
        )}

        {/* 07 — MARKET */}
        <Section id="market" n="07">
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Market</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-6">
            $4.9B market, 19% CAGR, no interpretable model.
          </h2>

          <div className="grid md:grid-cols-3 gap-4 mb-8">
            {[
              { value: "$4.9B", label: "Single-cell analysis market (2024)", source: "Grand View Research" },
              { value: "$13.7B", label: "Projected by 2030", source: "18.7% CAGR" },
              { value: "38.5%", label: "Data analysis share of market", source: "Largest workflow segment" },
            ].map((m) => (
              <div key={m.label} className="rounded-lg border border-border bg-card p-5 text-center">
                <div className="font-mono text-2xl font-bold text-foreground mb-1">{m.value}</div>
                <p className="text-xs text-foreground font-medium mb-0.5">{m.label}</p>
                <p className="text-[10px] text-muted-foreground">{m.source}</p>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-border bg-card p-6 mb-8">
            <h3 className="font-display text-sm font-semibold text-foreground mb-3">Serviceable market — honest framing</h3>
            <div className="space-y-3 text-xs text-muted-foreground">
              <div className="flex items-start gap-3">
                <span className="font-mono text-primary font-bold mt-0.5">01</span>
                <div>
                  <p className="text-foreground font-medium">Near-term: Inference API ($200M–$500M SAM)</p>
                  <p>~50,000 computational biologists worldwide. Pharma comp bio teams, academic labs, AI companies training genomics models. At $149/mo Pro pricing, 1,000 commercial subscribers = $1.8M ARR.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="font-mono text-primary font-bold mt-0.5">02</span>
                <div>
                  <p className="text-foreground font-medium">Medium-term: Enterprise data licensing ($1B–$3B SAM)</p>
                  <p>Foundation model training data for AI companies. On-prem deployment for pharma. Follows the Tempus model — data licensing at $50K–$500K/yr.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="font-mono text-primary font-bold mt-0.5">03</span>
                <div>
                  <p className="text-foreground font-medium">Long-term: Clinical genomics intelligence (TAM $30B+)</p>
                  <p>Variant interpretation for clinical labs. Requires $10M+ and regulatory work. Series B+ ambition, not pre-seed.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border-2 border-primary/20 bg-primary/[0.04] px-5 py-4 mb-8">
            <p className="text-sm text-muted-foreground leading-relaxed">
              <span className="text-foreground font-semibold">Tempus AI</span> reached $632M revenue and a ~$6B market cap by organizing clinical genomic data at bulk resolution. They serve 250+ biopharma companies. Singlet Bio adds <span className="text-primary font-semibold">single-cell resolution + interpretable AI</span> with software margins (90%+) vs clinical-lab margins (~60%).
            </p>
          </div>

          <Accordion type="multiple" className="space-y-2">
            <QA q="How do you get to paying customers from 0?"
              a="Academics use the model free. They publish papers citing our gene programs. Their industry counterparts see results described in our vocabulary. When a pharma comp bio team needs bulk perturbation screening or commercial licensing, they cannot get it from the free tier. This is the Benchling playbook — free for academia, paid for industry. Benchling grew to 1,300+ paying biotech companies and a $6B+ valuation this way." />
            <QA q="How does a pre-seed company get to Tempus-scale?"
              a="We do not claim Tempus-scale within this raise. We claim: ship inference API, get first paying customers, demonstrate product-market fit, raise a proper seed. The Tempus comparison illustrates the market opportunity, not our near-term plan." />
          </Accordion>
        </Section>

        {/* 08 — BUSINESS MODEL */}
        <Section id="model" n="08">
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Business Model</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-3">
            Free for research. Paid for industry.
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-8">
            Open-source gene programs build adoption. Free academic inference builds the publication graph. Commercial tiers capture value where budgets exist. The Benchling model for genomics AI.
          </p>

          <div className="space-y-3 mb-8">
            {[
              { tier: "Open Source", badge: "MIT", paid: false, desc: "10,000+ gene programs (W matrix), NMF engine, compression format, NNLS projection tools. Free forever.", who: "Everyone" },
              { tier: "Academic", badge: "FREE", paid: false, desc: "Full inference API — predict, perturb, compare. Rate-limited (10 req/min). .edu verification.", who: "Researchers" },
              { tier: "Pro", badge: "$149/MO", paid: true, desc: "100 req/min, bulk API, BYOD projection, commercial license for outputs.", who: "Industry scientists" },
              { tier: "Enterprise", badge: "FROM $25K/YR", paid: true, desc: "On-prem CPM deployment, custom NMF models on proprietary data, training data licensing, SLA.", who: "Pharma / AI companies" },
            ].map((t) => (
              <div key={t.tier} className={"flex items-start gap-4 px-5 py-4 rounded-lg border " + (t.paid ? "border-primary/40 bg-primary/[0.05]" : "border-border bg-card")}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <p className="text-sm font-semibold text-foreground">{t.tier}</p>
                    <span className={"px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider " + (t.paid ? "bg-primary/20 text-primary" : "bg-emerald-500/15 text-emerald-600")}>{t.badge}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">{t.who}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{t.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-border bg-card p-5 mb-8">
            <h3 className="font-display text-sm font-semibold text-foreground mb-3">Unit economics</h3>
            <div className="grid grid-cols-3 gap-4 text-center">
              {[
                { label: "Pro gross margin", value: "~94%" },
                { label: "Enterprise gross margin", value: "~93%" },
                { label: "Inference cost", value: "~$0.001/req" },
              ].map((m) => (
                <div key={m.label}>
                  <div className="font-mono text-lg font-bold text-primary">{m.value}</div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{m.label}</p>
                </div>
              ))}
            </div>
          </div>

          <Accordion type="multiple" className="space-y-2">
            <QA q="Comp bio researchers pay $0 for everything. Why would they pay you?"
              a="They will not. That is the point. Academics use our full model free — predict, perturb, compare. They publish papers using our gene program vocabulary. When their colleagues at Novartis or Genentech need the same tool at production scale with a commercial license, they upgrade to Pro or Enterprise. We do not sell to postdocs. We sell to pharma teams who discover us through academic publications." />
            <QA q="What is the conversion funnel?"
              a="MIT-licensed gene programs drive awareness. Academics use the free inference tier and publish using our program vocabulary. Pharma scientists encounter our language in literature. They need commercial access for drug programs and upgrade to Pro/Enterprise. The funnel is the academic publication graph. It is slow (12-18 months) but creates durable demand." />
            <QA q="Why is the open-source layer not a risk?"
              a="We open-source the gene programs (W matrix) — the vocabulary. The commercial value is the CPM encoder that maps conditions to program activities, trained on our proprietary atlas. Giving away W is like giving away a dictionary: useful, but it does not let you write sentences. The encoder is the author." />
          </Accordion>
        </Section>

        {/* 09 — TEAM */}
        <Section id="team" n="09">
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Team</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-8">
            One founder. Known risk. Here is why it works.
          </h2>

          <div className="flex items-start gap-6 mb-6">
            <div className="w-[100px] h-[100px] rounded-full border-2 border-border overflow-hidden flex-shrink-0">
              <img src={debruinePhoto} alt="Zach DeBruine" className="w-full h-full object-cover grayscale" />
            </div>
            <div className="flex-1">
              <h3 className="font-display text-xl font-bold text-foreground">Zach DeBruine, PhD</h3>
              <p className="font-mono text-xs text-primary mb-3">Founder & CEO · Full-time · IP clean</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Built every layer of the stack solo — C++ compression engine, GPU-accelerated NMF, atlas reprocessing pipeline — on university compute. Published in <span className="text-foreground italic">Bioinformatics</span>. PhD structural biology (Van Andel Institute). Transitioning from GVSU faculty to full-time CEO.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-primary/20 bg-primary/[0.03] px-5 py-4 mb-8">
            <p className="text-sm text-foreground leading-relaxed italic">
              "My oldest son was diagnosed with a rare genetic disease through whole-genome sequencing — it changed his life. My younger son lives with a rare disease but remains undiagnosed despite trio WGS. The tools that exist today failed our family. That is why I am building this."
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-8 text-xs">
            {[
              { label: "Publication", detail: "Bioinformatics (Oxford), NMF methods" },
              { label: "Funding", detail: "~$400K CZI grants, NIH R01 (co-PI)" },
              { label: "Validation", detail: "NMF on CZI CELLxGENE Census" },
              { label: "Community", detail: "319K+ CRAN downloads, NeurIPS" },
            ].map((c) => (
              <div key={c.label} className="rounded-lg border border-border bg-card px-4 py-3">
                <p className="font-semibold text-foreground mb-0.5">{c.label}</p>
                <p className="text-muted-foreground">{c.detail}</p>
              </div>
            ))}
          </div>

          <h3 className="font-display text-sm font-semibold text-foreground mb-3">Advisors</h3>
          <div className="grid sm:grid-cols-2 gap-3 mb-8">
            {[
              { name: "Zach Booker", role: "Business", desc: "Founded 75+ companies incl. Mentavi Health.", photo: bookerPhoto },
              { name: "Julie Adkins", role: "Operations", desc: "Exec Director, Startup Garage.", photo: adkinsPhoto },
              { name: "Caleb Bupp, MD", role: "Clinical Genetics", desc: "Chief Clinical Geneticist, Corewell Health.", photo: buppPhoto },
              { name: "Andrew Pospisilik, PhD", role: "Scientific", desc: "Chair of Epigenetics, Van Andel Institute.", photo: pospisilikPhoto },
            ].map((a) => (
              <div key={a.name} className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
                <img src={a.photo} alt={a.name} className="w-9 h-9 rounded-full object-cover flex-shrink-0 grayscale" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">{a.name} <span className="text-muted-foreground font-normal">· {a.role}</span></p>
                  <p className="text-[10px] text-muted-foreground truncate">{a.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <Accordion type="multiple" className="space-y-2">
            <QA q="Solo founder is the #1 risk for early-stage companies. How do you address it?"
              a="Three ways: (1) Faculty salary provides living expenses — the capital goes to product, not the founder. (2) First hire is a senior ML engineer (month 1), making us a two-person team immediately. (3) The advisor bench covers business, ops, clinical genetics, and science. Solo founder risk is real, and the mitigation is that the capital directly buys a team." />
            <QA q="Why not just stay in academia?"
              a="The atlas and gene programs are academic outputs — they will be published open-source regardless. The CPM inference API, commercial licensing, and enterprise deployment need a company. The differentiation is in productizing the intelligence layer, which academia does not do." />
          </Accordion>
        </Section>

        {/* 10 — THE ASK */}
        <Section id="ask" n="10">
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">The Ask</p>

          <div className="rounded-lg border-2 border-primary/30 bg-primary/[0.04] p-8 text-center mb-10">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-2">Pre-Seed Round</h2>
            <p className="font-mono text-sm text-primary mb-2">Raise amount and runway TBD</p>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">Faculty salary covers founder living expenses. Capital goes to product.</p>
          </div>

          <div className="rounded-lg border border-border bg-card p-6 mb-8">
            <h3 className="font-display text-sm font-semibold text-foreground mb-4">Use of funds</h3>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="h-52 flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={fundsData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2} dataKey="value">
                      {fundsData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={({ active, payload }) => active && payload && payload.length ? (
                      <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
                        <p className="text-xs text-foreground font-semibold">{payload[0].name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{payload[0].value}%</p>
                      </div>
                    ) : null} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col justify-center space-y-2">
                {fundsData.map((item) => (
                  <div key={item.name} className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: item.color }} />
                    <span className="text-xs text-foreground flex-1">{item.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{item.value}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-6 mb-8">
            <h3 className="font-display text-sm font-semibold text-foreground mb-4">Milestones</h3>
            <div className="space-y-3">
              {[
                { time: "Month 1–3", milestone: "Hire ML engineer. Train CPM encoder on human atlas.", status: "next" },
                { time: "Month 3–6", milestone: "Launch inference API beta. Ship MCP tools. Academic free tier live.", status: "planned" },
                { time: "Month 6–9", milestone: "Public launch. Pro tier ($149/mo). First paying customers.", status: "planned" },
                { time: "Month 9–12", milestone: "Multi-species CPM. Enterprise tier pilots with pharma.", status: "planned" },
                { time: "Month 12–18", milestone: "Demonstrated revenue. Position for seed round.", status: "planned" },
              ].map((m) => (
                <div key={m.time} className="flex items-start gap-3">
                  <div className={"w-2 h-2 rounded-full mt-1.5 flex-shrink-0 " + (m.status === "next" ? "bg-primary" : "bg-border")} />
                  <div>
                    <p className="text-xs font-semibold text-foreground">{m.time}</p>
                    <p className="text-xs text-muted-foreground">{m.milestone}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-6 mb-10 overflow-x-auto">
            <h3 className="font-display text-sm font-semibold text-foreground mb-3">Return scenarios</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-semibold text-foreground">Scenario</th>
                  <th className="px-3 py-2 text-left font-semibold text-foreground">ARR</th>
                  <th className="px-3 py-2 text-left font-semibold text-foreground">Valuation</th>
                  <th className="px-3 py-2 text-left font-semibold text-primary">Multiple</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Acqui-hire (floor)", "$300K", "$5–10M", "10–20x"],
                  ["API traction (base)", "$3–5M Y3", "$30–50M", "60–100x"],
                  ["Platform (upside)", "$10M+ Y4", "$100M+", "200x+"],
                ].map((row, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="px-3 py-2.5 font-medium text-foreground">{row[0]}</td>
                    <td className="px-3 py-2.5 font-mono text-foreground">{row[1]}</td>
                    <td className="px-3 py-2.5 font-mono text-foreground">{row[2]}</td>
                    <td className="px-3 py-2.5 font-mono text-primary font-semibold">{row[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-primary/20 bg-primary/[0.06] p-8 text-center mb-8">
            <h3 className="font-display text-xl md:text-2xl font-bold text-foreground mb-2">Interested? Let us talk.</h3>
            <p className="text-sm text-muted-foreground mb-5">We are raising from pre-seed investors, bio-AI funds, and university innovation programs.</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button size="lg" className="shimmer-border" onClick={() => setDeckOpen(true)}>
                Request Deck <ArrowRight size={14} />
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="mailto:zach@singletdb.com">Schedule a Call</a>
              </Button>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground/50 text-center leading-relaxed max-w-xl mx-auto">
            This page is for informational purposes only and does not constitute an offer to sell securities. All projections are forward-looking estimates.
          </p>
        </Section>

      </div>

      <Footer />
      <RequestDeckModal open={deckOpen} onOpenChange={setDeckOpen} />
    </div>
  );
};

export default Invest;

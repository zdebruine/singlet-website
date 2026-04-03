import React from "react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { ArrowLeft, ChevronRight } from "lucide-react";

const SubTable = ({ headers, rows }: { headers: string[]; rows: string[][] }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border">
          {headers.map((h) => (
            <th key={h} className="px-4 py-3 text-left font-semibold text-foreground whitespace-nowrap">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-b border-border/50">
            {row.map((cell, j) => (
              <td key={j} className={`px-4 py-3 ${j === 0 ? "font-medium text-foreground" : "text-muted-foreground"} whitespace-nowrap`}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Technology = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-36 pb-8 px-6">
        <div className="max-w-4xl mx-auto">
          <Link to="/invest" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8">
            <ArrowLeft size={14} /> Back
          </Link>
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Technology Deep Dive</p>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground tracking-tightest mb-2">
            Sequence-to-Single-Cell Intelligence
          </h1>
          <p className="text-muted-foreground mt-4 max-w-3xl">
            Not eQTLs. Not linear models. We train a new single-cell expression head on open sequence-to-function trunks (Borzoi, Apache 2.0; or AlphaGenome API) — predicting cell-type-resolved transcriptomes directly from whole-genome sequence.
          </p>
          <p className="text-sm text-muted-foreground/60 mt-3 max-w-3xl italic">
            The genomics community spent 15 years on GWAS and eQTLs. The answer was always going to be deeper — variant effects resolved at the level of individual cell types, not tissue averages.
          </p>
          <div className="gradient-line mt-6" />
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-6 space-y-20 pb-24">

        {/* Conditional Program Model */}
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-3">The Conditional Program Model</h2>
          <p className="text-muted-foreground mb-8">
            Metadata in. Named programs out. The decode is a single matrix multiply — fully transparent, fully traceable.
          </p>

          <div className="rounded-xl border border-border bg-card p-5 md:p-7 mb-8">
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

          <div className="grid md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-display text-sm font-bold text-foreground">Gene Programs (<em>W</em>)</h3>
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 text-[8px] font-bold uppercase tracking-wider">MIT</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                10,000+ unique splicing-resolved biological programs. Open-sourced, proof-of-concept models hosted on CZI Cell Census.
              </p>
              <p className="text-[10px] text-muted-foreground/70 leading-relaxed mb-2">
                Compare to ~6,000 terms in the curated Gene Ontology database — many of which are overlapping and redundant.
              </p>
              <p className="font-mono text-[10px] text-primary">The open grammar of transcription.</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="font-display text-sm font-bold text-foreground mb-2">Conditional Encoder (<em>f</em><sub>θ</sub>)</h3>
              <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                Maps any biological condition to program activities. Cross-attention captures tissue × disease interactions. Generalizes to rare conditions.
              </p>
              <p className="font-mono text-[10px] text-primary">The generative brain.</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="font-display text-sm font-bold text-foreground mb-2">Linear Decode (<em>W</em> · <em>ĥ</em>)</h3>
              <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                One matrix multiply generates ~30K gene predictions. Every gene traceable to specific programs. No sampling, no forward pass.
              </p>
              <p className="font-mono text-[10px] text-primary">Millisecond inference, full transparency.</p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-8">Five-Step Pipeline</h2>
          <div className="space-y-4">
            {[
              { step: "01", title: "WGS → Sequence Grammar", desc: "Sequence-to-function models — Borzoi (Calico, Apache 2.0, fully open weights) and AlphaGenome (DeepMind) — learn the regulatory grammar of DNA. We are model-agnostic: swap trunks as better open-source models emerge.", status: "Available today", cost: "~seconds per variant on 1× H100" },
              { step: "02", title: "Train Single-Cell Expression Head", desc: "We train a new head on the best available trunk that predicts single-cell RNA expression profiles directly from genome sequence. No eQTLs, no linear models — direct sequence-to-function mapping at cellular resolution.", status: "Architecture designed", cost: "Training ~$50–100K" },
              { step: "03", title: "Project 10K/10K Clinical Validation", desc: "Paired WGS + blood scRNA-seq from Project 10K/10K provides a clinically accessible window into our foundation model. Any new whole-genome sequence can be projected onto our single-cell transcriptome space.", status: "10K/10K data available", cost: "Continuous validation" },
              { step: "04", title: "Multimodal Projection", desc: "From predicted scRNA, project into ATAC (chromatin accessibility), CITE-seq (protein), spatial transcriptomics, and Perturb-seq via shared NMF factor space. One genome → all modalities.", status: "NMF bridges built", cost: "<100ms inference" },
              { step: "05", title: "LLM Post-Training → Clinical Intelligence", desc: "Rich biological context — cell types, tissues, developmental timepoints, spatial signaling, splicing dynamics, microbiome interactions — feeds LLM post-training. The model learns to reproduce and explain rare disease literature in terms of foundational biology.", status: "Product design phase", cost: "Standard SaaS" },
            ].map((s) => (
              <div key={s.step} className="flex gap-5 items-start">
                <div className="w-8 h-8 rounded-full border border-border bg-background text-primary font-mono text-xs font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {s.step}
                </div>
                <div className="flex-1 pb-4 border-b border-border/50">
                  <h4 className="font-display text-sm font-semibold text-foreground mb-1">{s.title}</h4>
                  <p className="text-sm text-muted-foreground mb-2">{s.desc}</p>
                  <div className="flex flex-wrap gap-4 font-mono text-xs">
                    <span className="text-primary">{s.status}</span>
                    <span className="text-muted-foreground">{s.cost}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Core Innovation Callout */}
        <section>
          <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-6">
            <h3 className="font-display text-lg font-semibold text-foreground mb-3">The Core Insight: Direct Head Training</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Sequence-to-function models like Borzoi and AlphaGenome learn the root sequence grammar of DNA. We leverage this grammar to train a <span className="text-foreground font-semibold">new head</span> — where the output is single-cell RNA expression. This means we can predict, from any genome sequence, a full single-cell expression profile. We are model-agnostic: as better open-source trunks emerge, we swap them in.
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              Emerging bridges now go directly from whole genome to single-cell ATAC (chromatin accessibility). Because we train multimodal models across scRNA + ATAC + CITE-seq + spatial data, we are uniquely positioned to leverage these new data modalities at <span className="text-foreground font-semibold">unprecedented statistical resolution</span>.
            </p>
            <p className="text-sm text-foreground font-medium">
              This is not eQTL mapping. This is not linear regression. This is direct sequence-to-cell-type prediction — a fundamentally different paradigm.
            </p>
          </div>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-8">The Genome-to-Single-Cell Bridge</h2>
          <div className="grid md:grid-cols-3 gap-4 mb-8">
            {[
              { layer: "Layer 1", title: "Seq-to-Function Head Training", time: "In progress", desc: "Train new expression head on Borzoi / AlphaGenome — predict scRNA profiles from any WGS. Model-agnostic: swap trunks as better open-source models emerge." },
              { layer: "Layer 2", title: "Project 10K/10K Validation", time: "Data available now", desc: "Paired WGS + blood scRNA from 10K donors. Clinically accessible window — blood is the universal biopsy for our foundation model." },
              { layer: "Layer 3", title: "Multimodal Foundation", time: "NMF bridges built", desc: "Shared NMF factor space links RNA, ATAC, protein, and spatial. One genome leads to predictions across all modalities." },
            ].map((l) => (
              <div key={l.layer} className="rounded-lg border border-border bg-card p-5">
                <p className="font-mono text-xs text-primary mb-1">{l.layer} · {l.time}</p>
                <h4 className="font-display text-sm font-semibold text-foreground mb-2">{l.title}</h4>
                <p className="text-sm text-muted-foreground">{l.desc}</p>
              </div>
            ))}
          </div>

          <h3 className="font-display text-lg font-semibold text-foreground mb-4">Bridge Datasets (Paired WGS + Single-Cell)</h3>
          <SubTable
            headers={["Dataset", "Donors", "Cells", "Tissue"]}
            rows={[
              ["Project 10K/10K", "10,000+", "—", "Blood (paired WGS)"],
              ["Cuomo et al. 2025", "~2,000", "5M+", "Blood"],
              ["OneK1K (Yazar et al.)", "982", "~1.3M", "Blood"],
              ["Tian et al. (Asian Immune Atlas)", "474", "~1M", "Blood"],
              ["Lung cancer sc-eQTL", "222", "—", "Lung"],
              ["Jerber et al. (iPSC-neurons)", "215", "—", "Neurons"],
              ["sc-eQTLGen, GTEx, others", "~600+", "—", "Multi-tissue"],
              ["Total", ">14,000", ">8M", "Multi-tissue"],
            ]}
          />
        </section>

        {/* What You Can Ask */}
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">What You Can Ask the Model</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Once a whole-genome sequence is projected onto our single-cell transcriptome space, we can answer questions no existing tool can:
          </p>
          <div className="grid md:grid-cols-2 gap-3">
            {[
              { q: "What cell types are affected?", detail: "Cell-type-resolved expression changes across 100+ annotated types" },
              { q: "What tissues are affected?", detail: "Tissue-level impact maps derived from cell-type composition" },
              { q: "What developmental timepoints?", detail: "Temporal disruption analysis across embryonic and postnatal programs" },
              { q: "How is spatial signaling altered?", detail: "Predicted changes in cell-cell communication in spatial coordinates" },
              { q: "What are the splicing dynamics?", detail: "RNA velocity reveals dynamical trajectory disruption" },
              { q: "What microbiome interactions?", detail: "Microbial signatures correlated with host cell states" },
            ].map((item) => (
              <div key={item.q} className="rounded-lg border border-border bg-card p-4">
                <p className="font-display text-sm font-semibold text-foreground mb-1">{item.q}</p>
                <p className="text-xs text-muted-foreground">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Splicing & Microbiome Callouts */}
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Unique Data Capabilities</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-primary/20 bg-accent/50 p-5">
              <p className="font-mono text-xs text-primary uppercase tracking-widest mb-2">Splicing-Resolved Transcriptomes</p>
              <p className="text-sm text-muted-foreground">
                Every sample in our atlas has <span className="text-foreground font-medium">splicing-resolved quantification layers</span> — required for RNA velocity and dynamical modeling. Most labs discard this information. We preserve it across our entire atlas, giving us unique access to temporal and dynamical gene regulation that no other atlas provides.
              </p>
            </div>
            <div className="rounded-lg border border-primary/20 bg-accent/50 p-5">
              <p className="font-mono text-xs text-primary uppercase tracking-widest mb-2">Microbiome & Virome Integration</p>
              <p className="text-sm text-muted-foreground">
                Microbial contamination profiles per cell are not just QC — they're <span className="text-foreground font-medium">biological signal</span>. We map the interaction between the microbiome, virome, and host cell states. This opens an entirely new axis of variant interpretation: how does a genetic variant alter the host-microbe interface?
              </p>
            </div>
          </div>
        </section>

        {/* AI Reasoning Layer */}
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">The AI Reasoning Layer</h2>
          <p className="text-sm text-muted-foreground mb-6">
            The rich biological context from our sequence-to-single-cell pipeline — cell types, tissues, developmental programs, spatial signaling, splicing dynamics, microbiome interactions — becomes the <span className="text-foreground font-semibold">training signal for LLM post-training</span>. We use foundational biology as a guide to teach LLMs to reason over and reproduce the literature.
          </p>
          <div className="grid md:grid-cols-2 gap-4 mb-8">
            <div className="rounded-lg border border-border bg-card p-5">
              <p className="font-mono text-xs text-muted-foreground mb-3">rbio1 (CZI, current SOTA)</p>
              <div className="font-mono text-xs text-muted-foreground space-y-1">
                <p>Gene perturbation → LLM reasoning → Diff. expression</p>
                <p>Verifier: <span className="text-foreground">Transformer embeddings (opaque)</span></p>
              </div>
            </div>
            <div className="rounded-lg border border-primary/30 bg-card p-5">
              <p className="font-mono text-xs text-primary mb-3">Singlet Bio PGI (our architecture)</p>
              <div className="font-mono text-xs text-muted-foreground space-y-1">
                <p>DNA → Borzoi / AlphaGenome → sc Expression Head → Multimodal NMF → LLM → Clinical</p>
                <p>Verifier: <span className="text-foreground">NMF factors (interpretable) + literature case reports</span></p>
              </div>
            </div>
          </div>

          <h3 className="font-display text-base font-semibold text-foreground mb-4">The Paradigm</h3>
          <div className="space-y-4">
            {[
              { title: "Foundational biology as LLM curriculum", desc: "Our single-cell predictions provide the biological grounding. Complex case reports from the literature serve as the evaluation set. The LLM learns to explain rare genetic variation by reasoning through cell types, pathways, and developmental biology — reproducing published clinical reasoning." },
              { title: "NMF factors as interpretable reasoning substrate", desc: "Instead of reasoning over ~20,000 individual genes, the LLM reasons over biological programs (e.g., \"cardiac repolarization,\" \"neural crest migration\"). NMF factors compress the search space 100× while remaining fully interpretable." },
              { title: "NMF factors as soft verifiers", desc: "When the LLM proposes \"this variant disrupts cardiac repolarization,\" our models verify: does the predicted single-cell expression change actually load onto cardiac repolarization factors? Biology-grounded fact-checking." },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-4 pb-4 border-b border-border/50">
                <div className="w-6 h-6 rounded-full border border-primary bg-accent flex items-center justify-center font-mono text-[10px] font-semibold text-primary flex-shrink-0 mt-0.5">
                  {i + 1}
                </div>
                <div>
                  <p className="font-display text-sm font-semibold text-foreground">{item.title}</p>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">The Data Asset — 10× Larger</h2>
          <SubTable
            headers={["Metric", "Our Atlas", "CZ CELLxGENE Census"]}
            rows={[
              ["GEO series", "Thousands", "~2,080"],
              ["Total samples", "Atlas-scale", "~149M cells"],
              ["Estimated cells", "World's largest (processing ongoing)", "~149 million"],
              ["Species", "Hundreds", "~10"],
              ["Modalities", "6 (RNA, ATAC, protein, spatial, perturbation, multiome)", "1 (RNA only)"],
              ["RNA velocity layers", "Yes — every sample", "No"],
              ["Contamination profiling", "Yes — per cell", "No"],
              ["Uniform reprocessing", "Yes — one pipeline from FASTQ", "No — author-processed"],
              ["Multi-modal linking", "Extensive cross-modal datasets", "No"],
            ]}
          />

          <div className="grid grid-cols-4 gap-4 mt-6">
            {[
              { value: "Largest", label: "Uniformly reprocessed atlas" },
              { value: "FASTQ→Model", label: "End-to-end pipeline" },
              { value: "Multi-species", label: "Broad taxonomic coverage" },
              { value: "Multi-modal", label: "RNA, ATAC, protein, spatial" },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-border bg-card p-4 text-center">
                <div className="font-mono text-lg font-bold text-foreground">{s.value}</div>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">~1,200 batch tasks remaining in processing queue.</p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">StreamPress — 10× Compression</h2>
          <SubTable
            headers={["Capability", "StreamPress", "BPCells", "TileDB"]}
            rows={[
              ["Compression ratio", "~10× vs. raw CSC", "~3–5×", "~3–5×"],
              ["Out-of-core GPU streaming", "Native", "No", "No"],
              ["PyTorch sparse tensor loading", "Direct, zero-copy", "Wrapper", "Wrapper"],
              ["Store transpose", "Yes — both fast", "Slow row slicing", "Block-wise"],
              ["Cloud storage cost", "~10× cheaper", "Baseline", "Expensive"],
            ]}
          />
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">FactorNet — Fast Interpretable NMF</h2>
          <ul className="space-y-3 text-sm text-muted-foreground">
            {[
              "Out-of-core NMF on GPU and CPU — scales to billions of cells",
              "Hierarchical factorization — tissue-specific, cell-type-specific sub-programs",
              "~100× faster than transformer foundation models at comparable accuracy",
              "Hosted on CZI CELLxGENE Census — the only non-transformer model",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="text-primary mt-0.5">·</span> {item}
              </li>
            ))}
          </ul>
        </section>

        {/* Multi-Modal Integration */}
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Multi-Modal Integration</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Each modality bridges to others through shared NMF factor space. From a single genome sequence, predict expression, then project into chromatin, protein, spatial, and perturbation space. The full cascade from DNA to chromatin to expression to protein to spatial to phenotype.
          </p>
          <SubTable
            headers={["Bridge", "Connection", "Data"]}
            rows={[
              ["10x Multiome", "Transcriptome / Chromatin accessibility", "Joint RNA + ATAC from same cell"],
              ["WGS to scATAC (emerging)", "Genome to Chromatin accessibility", "Direct sequence-to-chromatin bridges"],
              ["CITE-seq", "Transcriptome / Protein", "Joint RNA + surface protein from same cell"],
              ["Visium", "Transcriptome / Spatial", "NMF deconvolution maps spots to single cells"],
              ["Perturb-seq", "Transcriptome / Genetic perturbation", "Guide RNA barcodes linked to expression"],
            ]}
          />
        </section>

        <div className="text-center">
          <Link to="/invest" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={14} className="inline mr-1.5" />Back to Investor Overview
          </Link>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default Technology;
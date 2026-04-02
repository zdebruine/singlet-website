import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { ArrowLeft } from "lucide-react";

const Moat = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-36 pb-8 px-6">
        <div className="max-w-4xl mx-auto">
          <Link to="/invest" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8">
            <ArrowLeft size={14} /> Back
          </Link>
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Moat & Defensibility</p>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground tracking-tightest mb-2">
            Five-Layer Defense
          </h1>
          <p className="text-lg text-muted-foreground mt-4 max-w-3xl">
            Any one of these layers is hard to build. The combination is what makes us <span className="text-foreground">impossible to replicate in a quarter — and increasingly hard to replicate at all</span>.
          </p>
          <div className="gradient-line mt-6" />
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-6 space-y-16 pb-24">

        <section>
          <div className="space-y-2 mb-8">
            {[
              { layer: 5, label: "Clinical Product", desc: "Epic app, AI agents, clinical delivery" },
              { layer: 4, label: "Reasoning AI", desc: "NMF factors as reward model for post-trained LLMs" },
              { layer: 3, label: "Interpretable NMF", desc: "Cell-type-specific biological programs" },
              { layer: 2, label: "Single-cell Atlas + 10K/10K", desc: "World's largest uniformly reprocessed atlas, paired WGS+scRNA, direct head training" },
              { layer: 1, label: "DNA → Sequence Grammar", desc: "Borzoi / AlphaGenome — model-agnostic, we train the sc expression head" },
            ].map((l) => (
              <div key={l.layer} className="flex items-center gap-4 pb-3 border-b border-border/50">
                <div className="w-8 h-8 rounded-full border border-primary/50 bg-accent flex items-center justify-center font-mono text-xs font-semibold text-primary flex-shrink-0">
                  {l.layer}
                </div>
                <div>
                  <span className="font-display text-sm font-semibold text-foreground">{l.label}</span>
                  <span className="text-sm text-muted-foreground ml-3">{l.desc}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Layer 1 is commoditized. <strong className="text-foreground">Layers 2–3 are our moat.</strong> Layers 4–5 capture value.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Nobody else has the atlas (Layer 2) AND the interpretable models (Layer 3). Tempus has clinical delivery but not Layers 2–3. Google has Layer 1 but not 2–5. CZI has partial Layer 3 but not Layer 2 (uniformly reprocessed multi-modal data).
          </p>
        </section>

        {/* Data Moat — EXPANDED */}
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">The Data Moat</h2>
          <ul className="space-y-3 text-sm text-muted-foreground">
            {[
              "Atlas-scale — hundreds of species, 6 modalities, many formats, all one pipeline",
              "Project 10K/10K — 10,000+ paired WGS + blood scRNA-seq, the clinical training window for our expression head",
              "Splicing layers (Spliced/Unspliced/Ambiguous) for every sample — dynamical information most labs discard",
              "Microbiome & virome profiles — not just QC, but biological signal for host-microbe interaction",
              "LLM-extracted metadata — 20 structured fields per dataset",
              "Multi-modal bridges — RNA ↔ ATAC ↔ protein ↔ spatial, all linked through NMF factors",
              "Emerging WGS → scATAC bridges — chromatin accessibility directly from genome sequence",
              "Compounds over time — continuous ingestion of new GEO submissions",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="text-primary mt-0.5">·</span> {item}
              </li>
            ))}
          </ul>
          <div className="rounded-lg border border-primary/20 bg-accent/50 p-5 mt-6">
            <p className="text-sm text-foreground font-medium">
              Replicating this asset requires 600K+ core-hours of HPC processing, 1–2 years of pipeline development across many formats, and deep domain expertise in single-cell biology. It's not something a well-funded team can spin up in a quarter.
            </p>
          </div>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Technology Moat</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left font-semibold text-foreground">Technology</th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground">Advantage</th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground">Time to Replicate</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["sc Expression Head", "Direct WGS → single-cell transcriptome prediction", "Requires our atlas + 10K/10K"],
                  ["StreamPress", "10× compression, native GPU streaming", "2–3 years"],
                  ["FactorNet", "Fastest NMF, out-of-core GPU", "Open; atlas training is the moat"],
                  ["sc-geo Pipeline", "Many formats, hundreds of species, thousands of samples", "1–2 years"],
                  ["NMF Multi-Modal", "Interpretable factor space bridging modalities", "Deep NMF expertise required"],
                ].map((row, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {row.map((cell, j) => (
                      <td key={j} className={`px-4 py-3 ${j === 0 ? "font-medium text-foreground" : "text-muted-foreground"}`}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Network Effect</h2>
          <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-6">
            <div className="flex flex-wrap gap-3 items-center justify-center mb-4 font-mono text-xs">
              {["More data", "→", "Better NMF models", "→", "More accurate predictions", "→", "More users", "→", "More citations", "→", "Reproducibility lock-in"].map((item, i) => (
                item === "→" ? <span key={i} className="text-primary">→</span> : <span key={i} className="px-2 py-1 rounded border border-border bg-card text-foreground">{item}</span>
              ))}
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed text-center">
              Once researchers cite Singlet Bio in publications, downstream labs need the same data for reproducibility. This isn't customer stickiness — it's <span className="text-foreground font-semibold">scientific dependency</span>.
            </p>
          </div>
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

export default Moat;

import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { ArrowLeft } from "lucide-react";

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
              <td key={j} className={`px-4 py-3 ${j === 0 ? "font-medium text-foreground" : "text-muted-foreground"}`}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Competition = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-36 pb-8 px-6">
        <div className="max-w-4xl mx-auto">
          <Link to="/invest" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8">
            <ArrowLeft size={14} /> Back
          </Link>
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Competitive Landscape</p>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground tracking-tightest mb-2">
            Nobody connects genome → cell type → phenotype
          </h1>
          <p className="text-lg text-muted-foreground mt-4 max-w-3xl">
            Google built the trunk. CZI built the platform. Tempus built the clinical channel. <span className="text-foreground">Nobody built the bridge between them.</span> That's the gap — and it's ours.
          </p>
          <div className="gradient-line mt-6" />
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-6 space-y-16 pb-24">

        <section>
          <div className="grid md:grid-cols-2 gap-4 mb-8">
            <div className="rounded-lg border border-border bg-card p-5">
              <p className="font-mono text-xs text-muted-foreground mb-3">Current approach</p>
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                <span className="px-2 py-1 rounded bg-secondary text-foreground">genome</span>
                <span className="text-muted-foreground">→</span>
                <span className="px-2 py-1 rounded bg-secondary text-foreground">known variant?</span>
                <span className="text-muted-foreground">→</span>
                <span className="px-2 py-1 rounded bg-destructive/20 text-destructive">40–60% VUS</span>
              </div>
            </div>
            <div className="rounded-lg border border-primary/30 bg-card p-5">
              <p className="font-mono text-xs text-primary mb-3">Singlet AI PGI</p>
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                <span className="px-2 py-1 rounded bg-secondary text-foreground">genome</span>
                <span className="text-primary">→</span>
                <span className="px-2 py-1 rounded bg-secondary text-foreground">Borzoi / AlphaGenome</span>
                <span className="text-primary">→</span>
                <span className="px-2 py-1 rounded bg-secondary text-foreground">NMF</span>
                <span className="text-primary">→</span>
                <span className="px-2 py-1 rounded bg-accent text-primary">explanation</span>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Data Infrastructure</h2>
          <SubTable
            headers={["Player", "Strength", "Gap"]}
            rows={[
              ["CZ CELLxGENE", "149M cells, Census API", "No uniform reprocessing. RNA only. Our catalog is many times larger."],
              ["TileDB ($142M raised)", "Scalable array storage", "Storage only — no biology, no models."],
              ["10x Genomics (TXG)", "Dominant instruments", "Generates data, doesn't analyze it."],
            ]}
          />
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Clinical Intelligence</h2>
          <SubTable
            headers={["Player", "Strength", "Gap"]}
            rows={[
              ["Tempus AI ($6B)", "$632M revenue, 95% of top-20 pharma", "Bulk genomics only. No single-cell."],
              ["Foundation Medicine (Roche)", "Companion dx, 300+ gene panels", "Targeted panel, not WGS. Cancer-only."],
              ["Sophia Genetics", "780+ hospitals, 70 countries", "Bioinformatics pipeline, not intelligence."],
              ["Borzoi / AlphaGenome", "Sequence-to-function from DNA", "Bulk resolution only. We're model-agnostic and add the single-cell bridge."],
            ]}
          />
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-foreground mb-6">Why nobody else has built this</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { who: "CZI / Biohub", why: "Building research-grade foundation models (TranscriptFormer, rBio) and hiring aggressively for AI. But focused on community research tooling — not clinical products, not FASTQ reprocessing, not commercial intelligence layers. We build on top of their platform." },
              { who: "Tempus", why: "Zero single-cell infrastructure. Building from scratch would take 3+ years and a fundamentally different data architecture. Their moat is clinical partnerships, not data format innovation." },
              { who: "Google / Calico", why: "Built the sequence-to-function trunk (Borzoi / AlphaGenome), not the single-cell layer on top. Research-oriented, not productizing for external customers. We're the natural complement — or acquisition target." },
            ].map((c) => (
              <div key={c.who} className="border-l-2 border-primary/30 pl-4">
                <p className="font-display text-sm font-semibold text-foreground mb-1">{c.who}</p>
                <p className="text-sm text-muted-foreground">{c.why}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CZI Relationship — NEW */}
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">The CZI Relationship — We Build on Top</h2>
          <p className="text-sm text-muted-foreground mb-6">
            CZI is the most important player in this space. They are building real AI capabilities — rBio (reasoning LLM), TranscriptFormer, foundation models at CZ Biohub — and hiring aggressively. We approach them as a complement, not a competitor.
          </p>
          <div className="space-y-4">
            {[
              {
                title: "CZI hosts our NMF model",
                desc: "On CELLxGENE Census alongside Geneformer, scGPT, TranscriptFormer — the only non-transformer approach. Third-party validation from the most important organization in the single-cell ecosystem.",
              },
              {
                title: "They build research platform, we build products",
                desc: "CZI's mission is open research tooling. They won't build clinical products, FASTQ-level reprocessing, or commercial intelligence layers. Our uniform multi-species atlas with splicing layers, microbiome profiling, and NMF interpretability fills gaps their platform doesn't address.",
              },
              {
                title: "Our differentiation is defensible",
                desc: "CZ Biohub focuses on human biology and transformer-based foundation models. We process hundreds of species, use interpretable NMF (not black-box embeddings), resolve splicing dynamics, and build toward clinical products. These are architectural choices, not temporary leads.",
              },
              {
                title: "Potential data partnership",
                desc: "Our uniformly reprocessed data could flow back into CELLxGENE as higher-quality inputs. Partnership opportunity where both sides benefit.",
              },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-4 pb-4 border-b border-border/50">
                <span className="text-primary mt-0.5 font-mono text-xs">·</span>
                <div>
                  <p className="font-display text-sm font-semibold text-foreground">{item.title}</p>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </div>
              </div>
            ))}
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

export default Competition;

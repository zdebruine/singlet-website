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
              <td key={j} className={`px-4 py-3 ${j === 0 ? "font-medium text-foreground" : "text-muted-foreground"} whitespace-nowrap`}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Benchmarks = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-36 pb-8 px-6">
        <div className="max-w-4xl mx-auto">
          <Link to="/invest" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8">
            <ArrowLeft size={14} /> Back
          </Link>
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Evaluation Strategy</p>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground tracking-tightest mb-2">
            Benchmarks & Evaluation
          </h1>
          <p className="text-muted-foreground mt-4 max-w-3xl leading-relaxed">
            How we measure success — grounded in published literature, established genomic databases, and a novel open-source benchmark we will create and maintain.
          </p>
          <div className="gradient-line mt-6" />
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-6 space-y-20 pb-24">

        {/* Philosophy */}
        <section className="border-l-2 border-primary pl-8">
          <p className="font-display text-xl md:text-2xl text-foreground leading-relaxed italic">
            "If you can't measure it, you can't improve it — and you can't trust it."
          </p>
          <p className="text-sm text-muted-foreground mt-4 leading-relaxed">
            PGI's core promise is <span className="text-foreground font-medium">explainable, grounded genomic reasoning</span>. Every claim must be verifiable. Our evaluation strategy operates across three tiers — each independently publishable, each reinforcing the others.
          </p>
        </section>

        {/* Three-Tier Overview */}
        <section>
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Overview</p>
          <h2 className="font-display text-2xl font-bold text-foreground mb-8">Three-Tier Evaluation Framework</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              {
                tier: "Tier 1",
                title: "Automated Benchmarks",
                desc: "Continuous validation against ClinVar, OMIM, ClinGen, and variant effect predictor baselines. Fully automated, runs on every model update.",
                color: "text-primary",
              },
              {
                tier: "Tier 2",
                title: "Curated Case Studies",
                desc: "100-500 rare disease cases extracted from PubMed literature with known genotype-to-phenotype mappings. Expert-reviewed ground truth.",
                color: "text-primary",
              },
              {
                tier: "Tier 3",
                title: "Open-Source Benchmark",
                desc: "A novel community benchmark — 'GenomicEval' — for evaluating AI systems that reason about genomic variants. Published and maintained by Singlet AI.",
                color: "text-primary",
              },
            ].map((item) => (
              <div key={item.tier} className="rounded-lg border border-border bg-card p-5">
                <p className={`font-mono text-xs ${item.color} uppercase tracking-widest mb-2`}>{item.tier}</p>
                <h4 className="font-display text-sm font-semibold text-foreground mb-2">{item.title}</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Tier 1: Automated Benchmarks */}
        <section>
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Tier 1</p>
          <h2 className="font-display text-2xl font-bold text-foreground mb-4">Automated Benchmarks</h2>
          <p className="text-muted-foreground mb-6 leading-relaxed">
            Continuous validation against gold-standard genomic databases. These run automatically on every model update, providing regression detection and performance tracking over time.
          </p>

          <h3 className="font-display text-lg font-semibold text-foreground mb-4">Reference Databases</h3>
          <SubTable
            headers={["Database", "What It Tests", "Metric", "Target"]}
            rows={[
              ["ClinVar", "Variant pathogenicity classification", "Concordance with P/LP/VUS/B/LB", "≥95% on P/LP variants"],
              ["OMIM", "Gene–disease association accuracy", "Correct disease mapping", "≥98% on established genes"],
              ["ClinGen", "Gene–disease validity scoring", "Agreement with definitive/strong", "≥90% concordance"],
              ["gnomAD", "Population frequency calibration", "Correct benign filtering", "<1% false pathogenic calls"],
              ["UniProt", "Protein function annotation", "Functional domain accuracy", "≥95% domain overlap"],
            ]}
          />

          <h3 className="font-display text-lg font-semibold text-foreground mt-8 mb-4">Variant Effect Predictor Baselines</h3>
          <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
            We benchmark PGI's variant interpretation against established computational predictors — not to replace them, but to demonstrate that cell-type-resolved reasoning adds predictive power beyond sequence-level features.
          </p>
          <SubTable
            headers={["Predictor", "Approach", "Our Advantage"]}
            rows={[
              ["CADD", "Sequence conservation + annotations", "We add cell-type context — same variant, different impact by tissue"],
              ["REVEL", "Ensemble of missense predictors", "We explain why a variant is damaging, not just that it is"],
              ["AlphaMissense", "Protein structure-based", "We connect structure to cellular phenotype via NMF factors"],
              ["SpliceAI", "Splice site prediction", "We show downstream cell-type consequences of aberrant splicing"],
              ["Borzoi / AlphaGenome", "Multi-modal DNA→molecular phenotype", "We provide the single-cell resolution layer they lack — model-agnostic"],
            ]}
          />
        </section>

        {/* Tier 2: Curated Case Studies */}
        <section>
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Tier 2</p>
          <h2 className="font-display text-2xl font-bold text-foreground mb-4">Literature-Grounded Case Studies</h2>
          <p className="text-muted-foreground mb-6 leading-relaxed">
            PubMed rare disease case reports are <span className="text-foreground font-medium">natural benchmarks</span>. Each describes a patient with a known variant and documented phenotype — a ground-truth test case for PGI. Given genotype, does the system predict the correct phenotype and mechanism?
          </p>

          <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-5 mb-8">
            <p className="text-sm text-foreground font-medium mb-2">Why case studies are the gold standard</p>
            <ul className="text-xs text-muted-foreground space-y-1.5 list-disc list-inside">
              <li>Real patients, real variants, real clinical outcomes — no synthetic data</li>
              <li>Published and peer-reviewed — externally validated ground truth</li>
              <li>Cover the exact use case PGI targets: novel/rare variant interpretation</li>
              <li>Thousands available in PubMed — scalable benchmark construction</li>
              <li>LLMs can extract structured evaluation data from unstructured case reports</li>
            </ul>
          </div>

          <h3 className="font-display text-lg font-semibold text-foreground mb-4">Case Study Evaluation Schema</h3>
          <SubTable
            headers={["Field", "Description", "Example"]}
            rows={[
              ["Variant", "Genomic coordinates + change", "chr11:2588855 G>A (KCNQ1 R518Q)"],
              ["Gene", "Affected gene(s)", "KCNQ1"],
              ["Reported phenotype", "Clinical presentation", "Long QT Syndrome Type 1, syncope at age 8"],
              ["Affected cell types", "Tissue/cell types involved", "Ventricular cardiomyocytes"],
              ["Mechanism", "Molecular pathway disrupted", "IKs channel repolarization current loss"],
              ["Inheritance", "Mode of inheritance", "Autosomal dominant, de novo"],
              ["PubMed ID", "Source citation", "PMID:12345678"],
            ]}
          />

          <h3 className="font-display text-lg font-semibold text-foreground mt-8 mb-4">Evaluation Metrics</h3>
          <SubTable
            headers={["Metric", "What It Measures", "Scoring"]}
            rows={[
              ["Phenotype accuracy", "Correct disease/syndrome predicted", "Exact match or clinically equivalent"],
              ["Cell-type precision", "Correct affected cell types identified", "Overlap with published cell types"],
              ["Mechanism validity", "Pathway/molecular explanation is correct", "Expert review + literature concordance"],
              ["Citation grounding", "References are real and relevant", "PMID verification + relevance score"],
              ["Reasoning chain quality", "NMF factors → biology is traceable", "Expert audit of reasoning steps"],
              ["Hallucination rate", "False assertions per response", "Count of unverifiable claims"],
            ]}
          />

          <h3 className="font-display text-lg font-semibold text-foreground mt-8 mb-4">Target Disease Categories</h3>
          <p className="text-muted-foreground mb-4 text-sm">Initial case study collection focuses on rare diseases with high penetrance and clear genotype–phenotype relationships:</p>
          <div className="grid md:grid-cols-2 gap-3">
            {[
              { category: "Cardiac channelopathies", examples: "Long QT, Brugada, CPVT", count: "~80 cases" },
              { category: "Neurodevelopmental disorders", examples: "Rett, Dravet, SCN1A epilepsies", count: "~100 cases" },
              { category: "Connective tissue disorders", examples: "Marfan, EDS, osteogenesis imperfecta", count: "~60 cases" },
              { category: "Inborn errors of metabolism", examples: "PKU, Gaucher, Fabry", count: "~70 cases" },
              { category: "Primary immunodeficiencies", examples: "SCID, CGD, XLA", count: "~50 cases" },
              { category: "Skeletal dysplasias", examples: "Achondroplasia, FGFR3 disorders", count: "~40 cases" },
            ].map((d) => (
              <div key={d.category} className="rounded border border-border bg-card p-3">
                <p className="text-sm font-medium text-foreground">{d.category}</p>
                <p className="text-xs text-muted-foreground">{d.examples}</p>
                <p className="text-xs text-primary mt-1">{d.count}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">Target: 400–500 curated cases across categories by end of Phase 1.</p>
        </section>

        {/* Tier 3: Open-Source Benchmark */}
        <section>
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Tier 3</p>
          <h2 className="font-display text-2xl font-bold text-foreground mb-4">GenomicEval: An Open-Source Benchmark</h2>
          <p className="text-muted-foreground mb-6 leading-relaxed">
            We will create and publish <span className="text-foreground font-medium">GenomicEval</span> — a standardized benchmark for evaluating AI systems that reason about genomic variants. Think <span className="text-foreground font-medium">"HumanEval, but for genomic reasoning."</span> This becomes a community resource and cements Singlet AI as the standard-setter.
          </p>

          <h3 className="font-display text-lg font-semibold text-foreground mb-4">Benchmark Structure</h3>
          <SubTable
            headers={["Component", "Description", "Size"]}
            rows={[
              ["Variant → Phenotype", "Given a variant, predict clinical phenotype", "500 cases"],
              ["Variant → Cell Type", "Identify which cell types are affected", "500 cases"],
              ["Variant → Mechanism", "Explain the molecular mechanism", "300 cases"],
              ["Gene → Disease", "Map gene to associated diseases", "1,000 pairs"],
              ["Reasoning Chain", "Evaluate full reasoning from variant to clinical recommendation", "200 cases"],
              ["Hallucination Detection", "Adversarial cases designed to elicit false claims", "100 cases"],
            ]}
          />

          <h3 className="font-display text-lg font-semibold text-foreground mt-8 mb-4">Why This Matters Strategically</h3>
          <div className="space-y-3">
            {[
              { title: "Community adoption", desc: "Other teams benchmark against GenomicEval → we define the evaluation standard for the field." },
              { title: "Publication opportunity", desc: "Benchmark paper in Nature Methods or Genome Biology establishes scientific credibility." },
              { title: "Moat reinforcement", desc: "To build a competing benchmark, you need our data assets and domain expertise." },
              { title: "Talent signal", desc: "Open-source leadership attracts top computational biology talent." },
              { title: "Pharma trust", desc: "Pharma companies need standardized evaluation before adopting AI genomics tools. We provide it." },
            ].map((item) => (
              <div key={item.title} className="flex gap-3 items-start">
                <span className="text-primary mt-1 text-xs">●</span>
                <div>
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Existing Benchmarks Landscape */}
        <section>
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Landscape</p>
          <h2 className="font-display text-2xl font-bold text-foreground mb-4">Existing Benchmarks We Incorporate</h2>
          <p className="text-muted-foreground mb-6 leading-relaxed">
            We don't operate in a vacuum. These established benchmarks and datasets form the foundation of our evaluation infrastructure.
          </p>
          <SubTable
            headers={["Benchmark / Dataset", "Domain", "How We Use It"]}
            rows={[
              ["ClinVar (NCBI)", "Variant classification", "Gold-standard pathogenicity labels for automated testing"],
              ["OMIM", "Gene–disease mapping", "Ground truth for gene-level disease associations"],
              ["ClinGen", "Gene–disease validity", "Calibration of confidence scores"],
              ["GA4GH Benchmarking", "Genomic interpretation standards", "Framework alignment for interoperability"],
              ["ACMG/AMP Guidelines", "Variant interpretation criteria", "Ensure PGI reasoning follows clinical standards"],
              ["gnomAD v4", "Population variant frequencies", "Benign variant filtering calibration"],
              ["PubMed Case Reports", "Clinical phenotyping", "Natural evaluation cases (Tier 2 source)"],
              ["Human Phenotype Ontology (HPO)", "Phenotype standardization", "Structured phenotype matching and scoring"],
              ["Monarch Initiative", "Cross-species phenotype data", "Expanded evaluation coverage via model organisms"],
            ]}
          />
        </section>

        {/* Evaluation Dimensions Summary */}
        <section>
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Metrics</p>
          <h2 className="font-display text-2xl font-bold text-foreground mb-4">Evaluation Dimensions</h2>
          <p className="text-muted-foreground mb-6 leading-relaxed">
            Every PGI response is evaluated across five orthogonal dimensions. No single metric captures quality — we need all five.
          </p>
          <SubTable
            headers={["Dimension", "Metric", "Source", "Target"]}
            rows={[
              ["Diagnostic accuracy", "% correct phenotype given variant", "ClinVar + case studies", "≥90% top-3 accuracy"],
              ["Grounding quality", "Citations traceable to PubMed", "Automated PMID verification", "≥95% valid citations"],
              ["Reasoning validity", "NMF pathway logic holds", "Expert review panel", "≥85% approval rate"],
              ["Coverage", "% of rare diseases addressable", "OMIM disease catalog", "≥70% of Mendelian diseases"],
              ["Hallucination rate", "False assertions per response", "Adversarial testing suite", "<5% per response"],
            ]}
          />
        </section>

        {/* Timeline */}
        <section>
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Timeline</p>
          <h2 className="font-display text-2xl font-bold text-foreground mb-4">Evaluation Roadmap</h2>
          <SubTable
            headers={["Phase", "Timeline", "Deliverable"]}
            rows={[
              ["Phase 1", "Months 1–6", "Tier 1 automated benchmarks operational; 100 curated case studies collected"],
              ["Phase 2", "Months 6–12", "400+ case studies; GenomicEval v0.1 alpha released on GitHub"],
              ["Phase 3", "Months 12–18", "GenomicEval v1.0 published; benchmark paper submitted; community adoption begins"],
              ["Ongoing", "Continuous", "Quarterly benchmark updates; leaderboard maintained; community contributions reviewed"],
            ]}
          />
        </section>

      </div>
      <Footer />
    </div>
  );
};

export default Benchmarks;

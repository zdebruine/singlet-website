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

const Business = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-36 pb-8 px-6">
        <div className="max-w-4xl mx-auto">
          <Link to="/invest" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8">
            <ArrowLeft size={14} /> Back
          </Link>
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Business Model</p>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground tracking-tightest mb-2">
            Partnership Model & AI-Native Healthcare
          </h1>
          <p className="text-muted-foreground mt-4 max-w-3xl leading-relaxed">
            We are the <span className="text-foreground font-semibold">interpretation layer</span> for any whole-genome or whole-exome sequencing provider. We deliver an AI-native healthcare chart that gives every clinician genome-aware reasoning — not just genetics specialists.
          </p>
          <div className="gradient-line mt-6" />
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-6 space-y-16 pb-24">

        {/* Partnership Model */}
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-4">Partnership Model</h2>
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            Singlet AI partners with <span className="text-foreground font-medium">any WGS/WES provider</span> — Illumina, Ultima Genomics, Element Biosciences, BGI, or clinical sequencing labs. We are not a sequencing company. We are the <span className="text-foreground font-medium">on-demand insight layer</span> that transforms raw sequence into mechanistic interpretation.
          </p>
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <div className="rounded-lg border border-border bg-card p-5">
              <h4 className="font-display text-sm font-semibold text-foreground mb-2">Not Just Diagnostics</h4>
              <p className="text-xs text-muted-foreground">
                Traditional variant interpretation returns a classification (pathogenic / VUS / benign). We go further — delivering <span className="text-foreground font-medium">mechanistic reasoning</span> grounded in single-cell biology, developmental programs, and the published literature. Because we post-train on the entire literature with biological context, we can mechanistically reconcile information that no lookup table can.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-5">
              <h4 className="font-display text-sm font-semibold text-foreground mb-2">Sequencing-Agnostic</h4>
              <p className="text-xs text-muted-foreground">
                Any FASTQ, BAM, or VCF enters our pipeline. We don't care which instrument generated it. This makes us a <span className="text-foreground font-medium">natural partner for every sequencing company</span> — they handle sample prep, we handle interpretation. Revenue share or per-interpretation fee models align incentives.
              </p>
            </div>
          </div>
          <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-5">
            <p className="text-sm text-foreground font-medium mb-1">Partnership examples</p>
            <p className="text-xs text-muted-foreground">
              Illumina TruSight → Singlet AI PGI interpretation · Ultima UG100 → Singlet AI rare disease reasoning · Element AVITI → Singlet AI pharmacogenomics insight · Any clinical lab VCF → Singlet AI mechanistic report
            </p>
          </div>
        </section>

        {/* AI-Native Healthcare Chart */}
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-4">AI-Native Healthcare Chart</h2>
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            The PGI is not a report that sits in a PDF. It is an <span className="text-foreground font-medium">AI-native chart</span> — a place where clinicians spend time reasoning through a patient's case, with a holistic view of the patient's medical history <em>and</em> genome.
          </p>
          <div className="grid md:grid-cols-3 gap-4 mb-6">
            {[
              {
                title: "Holistic Patient View",
                desc: "Medical history from the EHR + genomic interpretation from the PGI in a single conversational interface. Clinicians can ask questions that span both — 'given this patient's renal history and their BRCA2 variant, what should I consider?'",
              },
              {
                title: "Every Clinician, Not Just Genetics",
                desc: "Cardiologists, oncologists, neurologists, primary care — any provider in the healthcare system can access genome-aware reasoning through the same chatbot. This is not a genetics silo.",
              },
              {
                title: "Reasoning, Not Just Retrieval",
                desc: "Clinicians can double-check decisions, explore mechanisms, ask follow-up questions. The AI reasons over the intersection of the patient's clinical data and their genomic profile — grounded in published science.",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-lg border border-border bg-card p-5">
                <h4 className="font-display text-sm font-semibold text-foreground mb-2">{item.title}</h4>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Epic FHIR Integration */}
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-4">Epic FHIR Integration</h2>
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            We connect to healthcare systems through <span className="text-foreground font-medium">Epic's FHIR R4 APIs</span> and SMART on FHIR launch protocol. This allows the PGI chatbot to be embedded directly inside the clinician's workflow — no context switching, no separate portal.
          </p>
          <SubTable
            headers={["Integration Layer", "What It Does", "Clinical Impact"]}
            rows={[
              ["SMART on FHIR Launch", "Launches PGI from within Epic with patient context pre-loaded", "Zero-click patient identification"],
              ["FHIR Patient/$everything", "Pulls complete medical history — conditions, meds, labs, procedures", "AI reasons over full clinical picture"],
              ["Genomic Overlay", "Merges EHR context with PGI variant interpretation", "Genome-aware clinical reasoning"],
              ["CDS Hooks (planned)", "Trigger PGI alerts at order entry or result review", "Proactive pharmacogenomic guidance"],
              ["Epic App Orchard", "Distribution via Epic's marketplace to all Epic customers", "Scales to 250M+ patient records"],
            ]}
          />
        </section>

        {/* Updated Pricing Tiers */}
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-4">Regulatory Strategy</h2>
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            Phase 1 (data platform) and Phase 2 (research AI) operate in the <span className="text-foreground font-medium">research use only (RUO)</span> space — no FDA clearance required. Clinical PGI in Phase 3 will pursue a <span className="text-foreground font-medium">510(k) pathway</span> as a clinical decision support tool, following precedents set by Tempus xT and Foundation Medicine's FoundationOne CDx. HIPAA compliance is built in from day one via Epic's SMART on FHIR framework and BAA-covered cloud infrastructure. We budget for regulatory counsel in our Phase 3 cost projections.
          </p>
        </section>

        {/* Updated Pricing Tiers */}
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Pricing Tiers</h2>
          <SubTable
            headers={["Tier", "Price", "Target", "Includes"]}
            rows={[
              ["WGS/WES Partner", "Per-interpretation fee or rev share", "Sequencing companies", "API integration, co-branded reports, SLA"],
              ["Healthcare System", "$2,999–$9,999/mo", "Hospitals via Epic FHIR", "AI-native chart, per-clinician seats, EHR integration"],
              ["Clinical PGI", "Per-query + subscription", "Genetics labs", "Variant interpretation, mechanistic reports"],
              ["Free", "$0", "Students", "Browse metadata, R2 downloads, 100K cells/mo"],
              ["Starter", "$29/mo (5K tokens)", "Grad students, postdocs", "Higher rate limits, annotations, NMF API"],
              ["Researcher", "$99/mo (25K tokens)", "Active comp bio researchers", "Higher volume queries + annotations"],
              ["Lab", "$299/mo (100K tokens)", "Labs, small biotechs", "Team usage, custom NMF"],
              ["Enterprise", "Custom", "Pharma, AI companies", "SLA, private data, unlimited tokens, on-prem"],
            ]}
          />
        </section>

        {/* Unit Economics */}
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Unit Economics</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { tier: "WGS/WES Partner", margin: "85–90%", detail: "Per-interpretation, minimal marginal cost" },
              { tier: "Healthcare System", margin: "90%", detail: "$5,999/mo · ~$600 COGS" },
              { tier: "Starter", margin: "92%", detail: "$29/mo · ~$2.30 COGS" },
              { tier: "Enterprise", margin: "93%", detail: "$10,417/mo · $755 COGS" },
            ].map((u) => (
              <div key={u.tier} className="rounded-lg border border-border bg-card p-5 text-center">
                <p className="font-mono text-xs text-muted-foreground mb-2">{u.tier}</p>
                <div className="font-mono text-2xl font-bold text-foreground">{u.margin}</div>
                <p className="text-xs text-muted-foreground mt-1">gross margin</p>
                <p className="font-mono text-xs text-muted-foreground mt-2">{u.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* De-Risking Strategy */}
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">De-Risking Strategy</h2>
          <p className="text-sm text-muted-foreground mb-6">
            The clinical PGI is our primary ambition. But every milestone creates independent value — multiple pathways ensure we build a real business regardless of the clinical timeline.
          </p>
          <div className="space-y-4">
            {[
              {
                title: "De-Risk 1: Sequencing Partner Flexibility",
                desc: "We work with any WGS/WES provider. No single-vendor dependency. If Illumina dominates, we partner with Illumina. If Ultima or Element win share, we partner with them too. We are the interpretation layer — sequencing-agnostic by design.",
              },
              {
                title: "De-Risk 2: Data Infrastructure (Tempus Playbook)",
                desc: "Tempus built a $6B company organizing biomedical data at bulk resolution ($632M/year). We do the same at single-cell resolution — 10× more data, uniformly processed, multi-modal.",
              },
              {
                title: "De-Risk 3: EHR Integration as Distribution",
                desc: "Epic FHIR integration gives us access to every clinician in participating healthcare systems — not just genetics specialists. This transforms our distribution from direct sales to platform-embedded access across 250M+ patient records.",
              },
              {
                title: "De-Risk 4: LLM-Annotated Data Products",
                desc: "Structured extraction from GEO descriptions, cell-type annotation via LLM reasoning, cross-dataset standardization. Pharma and academic customers want biologically contextualized datasets, not raw counts.",
              },
              {
                title: "De-Risk 5: Intermediate Deliverables",
                desc: "Each milestone along the path to clinical PGI creates a standalone product with real customers and revenue. The annotated atlas, NMF API, and cross-modal prediction all sell independently.",
              },
            ].map((item, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-5">
                <h4 className="font-display text-sm font-semibold text-foreground mb-2">{item.title}</h4>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Intermediate Deliverables Timeline */}
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Intermediate Deliverables</h2>
          <SubTable
            headers={["Deliverable", "Timeline", "Revenue Potential"]}
            rows={[
              ["Annotated single-cell atlas (API + CLI)", "Month 4–6", "$200K–$500K Year 1"],
              ["NMF inference API", "Month 6–8", "$100K–$300K Year 1"],
              ["First WGS/WES partner integration", "Month 8–10", "$500K–$1M Year 2"],
              ["Cross-modal prediction (RNA → ATAC/protein)", "Month 8–12", "$500K–$1M Year 2"],
              ["Epic FHIR pilot (1–2 healthcare systems)", "Month 12–15", "$1M–$3M Year 2"],
              ["Variant-to-cell-type mapping (Layer 1+2)", "Month 12–15", "$1M–$3M Year 2"],
              ["AI-native chart general availability", "Month 15–20", "$2M–$5M Year 3"],
              ["Full clinical PGI for rare disease", "Month 18–30", "$5M–$15M Year 3–5"],
            ]}
          />
        </section>

        {/* Technical Roadmap & Costs */}
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Technical Roadmap & Cost Breakdown</h2>

          <h3 className="font-display text-base font-semibold text-foreground mb-3">Phase 1: Data Infrastructure (Month 1–6)</h3>
          <SubTable
            headers={["Task", "Cost", "Timeline"]}
            rows={[
              ["Complete droplet RNA processing (~580 batches)", "$1,500", "Month 1–2"],
              ["Process ATAC-seq + Multiome", "$5,400", "Month 2–4"],
              ["Process Visium + CITE-seq", "$3,300", "Month 3–5"],
              ["Process plate-based RNA + other", "$6,750", "Month 3–6"],
              ["LLM cell type annotation", "$20K–$50K", "Month 2–3"],
              ["Train hierarchical NMF (8× H100)", "$1,500–$6,500", "Month 2–3"],
              ["Train cross-modal prediction network", "$3,200–$8,000", "Month 4–5"],
              ["Web app + API development", "$10K–$20K", "Month 4–6"],
              ["Phase 1 Total", "$71K–$155K", ""],
            ]}
          />

          <h3 className="font-display text-base font-semibold text-foreground mt-8 mb-3">Phase 2: Scale + Partnerships (Month 6–12)</h3>
          <SubTable
            headers={["Task", "Cost", "Timeline"]}
            rows={[
              ["AWS production infrastructure", "$2.5K–$6.3K/mo", "Ongoing"],
              ["First WGS/WES partner API integration", "$5K–$10K", "Month 6–8"],
              ["First pharma pilot support", "$5K–$15K", "Month 6–9"],
              ["Bridge Layer 1: NMF deconvolution", "$2K–$5K", "Month 6–8"],
              ["Bridge Layer 2: Fine-tune AlphaGenome heads", "$10K–$25K", "Month 8–12"],
              ["rbio1-style reasoning model", "$20K–$50K", "Month 9–12"],
              ["Phase 2 Total", "$60K–$165K", ""],
            ]}
          />

          <h3 className="font-display text-base font-semibold text-foreground mt-8 mb-3">Phase 3: Clinical PGI + EHR Integration (Month 12–24)</h3>
          <SubTable
            headers={["Task", "Cost", "Timeline"]}
            rows={[
              ["Bridge Layer 3: Unified embedding space", "$15K–$40K", "Month 12–18"],
              ["Clinical evaluation harness", "$5K–$10K", "Month 12–15"],
              ["Epic FHIR integration development", "$20K–$40K", "Month 12–18"],
              ["PGI alpha (rare disease)", "$10K–$20K", "Month 15–20"],
              ["Clinical partner pilots (2–3 hospitals)", "$10K–$25K", "Month 18–24"],
              ["Epic App Orchard submission", "$20K–$50K", "Month 20–24"],
              ["Phase 3 Total", "$95K–$215K", ""],
            ]}
          />
        </section>

        {/* Infrastructure Costs */}
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Infrastructure Costs (Annual)</h2>
          <SubTable
            headers={["Item", "Annual Cost"]}
            rows={[
              ["S3 storage (7 TB final atlas)", "$1,932"],
              ["API + compute infrastructure", "$30K–$76K"],
              ["Data transfer (egress)", "$900–$5,000"],
              ["NMF inference GPU (always-on)", "$24K–$60K"],
              ["Total infrastructure/year", "$57K–$143K"],
            ]}
          />
        </section>

        {/* Total Budget Summary */}
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Total Budget Summary</h2>
          <SubTable
            headers={["Category", "Low", "High"]}
            rows={[
              ["Data reprocessing (all modalities)", "$21,150", "$35,000"],
              ["LLM annotation (metadata + cell types)", "$20,100", "$50,500"],
              ["GPU training (NMF + foundation models)", "$20,200", "$63,000"],
              ["AI reasoning model (post-training)", "$20,000", "$50,000"],
              ["Bridge model training", "$12,000", "$30,000"],
              ["Clinical PGI + EHR integration", "$80,000", "$165,000"],
              ["Web app + API development", "$10,000", "$20,000"],
              ["Production infrastructure (Year 1)", "$57,000", "$143,000"],
              ["Team (salaries + benefits, Year 1)", "$300,000", "$500,000"],
              ["Total Year 1", "$540,450", "$1,056,500"],
            ]}
          />
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
            <span className="text-foreground font-semibold">Note:</span> The $500K pre-seed covers the low-end critical path (atlas completion, ML engineer, core infrastructure). Clinical PGI and higher-end items are deferred to revenue or a follow-on raise.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Revenue Comparables</h2>
          <SubTable
            headers={["Company", "Model", "Revenue"]}
            rows={[
              ["Tempus AI", "Data + AI for pharma", "$632M (2024)"],
              ["Fabric Genomics", "Variant interpretation SaaS", "Private (~$50M raised)"],
              ["TileDB", "Data infrastructure SaaS", "Private (~$142M raised)"],
              ["Benchling", "Lab notebook SaaS", "~$100M ARR est."],
              ["DNAnexus", "Genomics cloud platform", "~$100M raised"],
              ["Singlet AI (Year 3)", "Intelligence layer", "$4.5M ARR"],
            ]}
          />
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Use of Funds</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              { amount: "$300K–$500K", label: "Build the Team", desc: "Senior ML engineer + clinical genomics lead" },
              { amount: "$21K–$35K", label: "Complete Atlas", desc: "Remaining modalities on cloud compute" },
              { amount: "$52K–$143K", label: "Train Models", desc: "NMF, cross-modal, bridge, reasoning AI" },
              { amount: "$20K–$50K", label: "LLM Annotation", desc: "Atlas-wide cluster-level annotations" },
              { amount: "$67K–$163K", label: "Launch singletdb.com", desc: "Infrastructure, web app, Year 1 hosting" },
              { amount: "$80K–$165K", label: "Clinical PGI + EHR", desc: "Epic FHIR integration, clinical partners, App Orchard" },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-4 pb-4 border-b border-border/50">
                <div className="font-mono text-sm font-semibold text-foreground whitespace-nowrap">{item.amount}</div>
                <div>
                  <p className="font-display text-sm font-semibold text-foreground">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
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

export default Business;

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

const Market = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-36 pb-8 px-6">
        <div className="max-w-4xl mx-auto">
          <Link to="/invest" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8">
            <ArrowLeft size={14} /> Back
          </Link>
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Market Opportunity</p>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground tracking-tightest mb-2">
            TAM & Revenue Projections
          </h1>
          <div className="gradient-line mt-6" />
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-6 space-y-16 pb-24">
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Total Addressable Market</h2>
          <SubTable
            headers={["Market", "2024", "2030", "Singlet AI's Role"]}
            rows={[
              ["Precision medicine", "~$73B", "~$175B", "Intelligence layer"],
              ["Rare disease dx + tx", "~$8B", "~$17B", "Phenotype prediction"],
              ["Clinical genomics", "~$12B", "~$30B", "AI variant interpretation"],
              ["AI drug discovery", "~$1.5B", "~$10B+", "Target discovery & safety"],
              ["Single-cell analysis", "$4.89B", "$13.69B", "Data infrastructure"],
            ]}
          />
        </section>

        {/* SAM Breakdown — NEW */}
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Serviceable Addressable Market</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="rounded-lg border border-border bg-card p-6">
              <p className="font-mono text-xs text-primary mb-2">Near-term (data infrastructure)</p>
              <div className="font-mono text-2xl font-bold text-foreground mb-4">$500M–$800M</div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {[
                  "~5,000 academic labs publishing single-cell papers",
                  "~200 pharma/biotech with comp bio teams",
                  "~50 AI/ML companies building biological foundation models",
                  "~100 bioinformatics core facilities at academic medical centers",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="text-primary mt-0.5">·</span> {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-border bg-card p-6">
              <p className="font-mono text-xs text-primary mb-2">Long-term (clinical genomics intelligence)</p>
              <div className="font-mono text-2xl font-bold text-foreground mb-4">$5B–$15B</div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {[
                  "~6,000 hospital systems in the US ordering WGS/WES",
                  "~250 clinical genetics laboratories",
                  "~500K genetic counseling sessions/year in the US",
                  "Top-20 pharma building clinical genomics capabilities",
                  "40+ DTC genomics companies needing interpretation layers",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="text-primary mt-0.5">·</span> {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Revenue Projections</h2>
          <SubTable
            headers={["Year", "Data Infrastructure", "Intelligence Products", "Total ARR"]}
            rows={[
              ["Year 1", "$220K", "—", "$220K"],
              ["Year 2", "$930K", "$200K", "$1.1M"],
              ["Year 3", "$3.0M", "$1.5M", "$4.5M"],
              ["Year 4", "$5.0M", "$5.0M", "$10.0M"],
              ["Year 5", "$7.0M", "$12.0M", "$19.0M"],
            ]}
          />
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Why Rare Diseases First</h2>
          <SubTable
            headers={["Factor", "Rationale"]}
            rows={[
              ["High penetrance", "Single variants cause clear phenotypes"],
              ["Enormous unmet need", "25–30M Americans; 5–7 yr odyssey"],
              ["VUS is the pain point", "Novel variants are the norm"],
              ["Growing WGS adoption", "Rapid WGS in NICU/pediatric settings"],
              ["Clear clinical action", "Correct interpretation changes treatment"],
              ["Evaluation data exists", "PubMed case studies with known variant → phenotype relationships serve as natural benchmarks"],
              ["$17B market", "Fastest-growing segment"],
            ]}
          />
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Milestones</h2>
          <div className="relative pl-8 space-y-6">
            <div className="absolute left-3 top-1 bottom-1 w-px bg-border" />
            {[
              { time: "Month 3", label: "Atlas 100% complete" },
              { time: "Month 5", label: "singletdb.com public beta" },
              { time: "Month 8", label: "First 3 paid customers" },
              { time: "Month 12", label: "Genome → cell-type API" },
              { time: "Month 18", label: "Rare disease PGI alpha" },
              { time: "Month 24", label: "Clinical partner pilots" },
            ].map((m) => (
              <div key={m.time} className="relative">
                <div className="absolute -left-[23px] top-1 w-3 h-3 rounded-full border-2 border-primary bg-background" />
                <p className="font-mono text-xs text-primary">{m.time}</p>
                <p className="text-sm text-foreground">{m.label}</p>
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

export default Market;

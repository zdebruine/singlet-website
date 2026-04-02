import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { ArrowLeft } from "lucide-react";
import debruinePhoto from "@/assets/debruine.png";
import bookerPhoto from "@/assets/booker.png";
import adkinsPhoto from "@/assets/adkins.png";
import buppPhoto from "@/assets/bupp.png";
import pospisilikPhoto from "@/assets/pospisilik.png";

const Team = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-36 pb-8 px-6">
        <div className="max-w-4xl mx-auto">
          <Link to="/invest" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8">
            <ArrowLeft size={14} /> Back
          </Link>
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Team & Credibility</p>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground tracking-tightest mb-2">
            Advisors & Track Record
          </h1>
          <div className="gradient-line mt-6" />
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-6 space-y-16 pb-24">

        {/* Founder */}
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Founder</h2>
          <div className="rounded-lg border border-border bg-card p-6 md:p-8">
            <div className="flex flex-col sm:flex-row gap-6">
              <img
                src={debruinePhoto}
                alt="Zach DeBruine"
                className="w-28 h-28 rounded-full object-cover flex-shrink-0 grayscale"
              />
              <div>
                <h3 className="font-display text-xl font-bold text-foreground">Zach DeBruine</h3>
                <p className="font-mono text-xs text-primary mb-4">Founder & CEO · Assistant Professor, Grand Valley State University</p>
                <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                  <p>
                    Zach's oldest son was diagnosed with a rare disease through whole-genome sequencing — a result that was <span className="text-foreground font-medium">life-changing</span>, unlocking targeted treatment that transformed his care. His younger son also lives with a rare disease but remains undiagnosed despite trio whole-genome sequencing. Singlet Bio is dedicated to giving him — and millions like him — the gift of precision treatment and, one day, a diagnosis.
                  </p>
                  <p>
                    Zach earned his PhD in structural biology at the <span className="text-foreground font-medium">Van Andel Research Institute</span>, taught himself to code during COVID lockdowns, pivoted into bioinformatics, and completed a genomics ML postdoc. He is now <span className="text-foreground font-medium">Assistant Professor of Computing</span> at Grand Valley State University, where his lab focuses on Genomics AI — building the infrastructure and models to make single-cell data universally accessible and actionable.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Advisors */}
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Advisors</h2>
          {/* Zach Booker - featured advisor */}
          <div className="rounded-lg border border-border bg-card p-6 md:p-8 mb-4">
            <div className="flex flex-col sm:flex-row gap-6">
              <img
                src={bookerPhoto}
                alt="Zach Booker"
                className="w-24 h-24 rounded-full object-cover flex-shrink-0 grayscale"
              />
              <div>
                <h4 className="font-display text-lg font-bold text-foreground">Zach Booker</h4>
                <p className="font-mono text-xs text-primary mb-3">Business Advisor</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Serial entrepreneur who has founded <span className="text-foreground font-medium">75+ companies</span>, including several venture-backed successes such as ADHD Online (now Mentavi Health). Zach is a rare disease parent who knows firsthand the power of a diagnosis, and is committed to improving precision healthcare.
                </p>
              </div>
            </div>
          </div>

          {/* Julie Adkins - featured advisor */}
          <div className="rounded-lg border border-border bg-card p-6 md:p-8 mb-4">
            <div className="flex flex-col sm:flex-row gap-6">
              <img
                src={adkinsPhoto}
                alt="Julie Adkins"
                className="w-24 h-24 rounded-full object-cover flex-shrink-0 grayscale"
              />
              <div>
                <h4 className="font-display text-lg font-bold text-foreground">Julie Adkins</h4>
                <p className="font-mono text-xs text-primary mb-3">Fractional COO</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Provides operational support across all facets of the business. Julie has extensive experience as an integrator in academia, non-profits, and for-profits, and currently serves as <span className="text-foreground font-medium">Executive Director at Startup Garage</span> where she champions over a hundred startups alongside Zach Booker.
                </p>
              </div>
            </div>
          </div>

          {/* Caleb Bupp - featured advisor */}
          <div className="rounded-lg border border-border bg-card p-6 md:p-8 mb-4">
            <div className="flex flex-col sm:flex-row gap-6">
              <img
                src={buppPhoto}
                alt="Caleb Bupp"
                className="w-24 h-24 rounded-full object-cover flex-shrink-0 grayscale"
              />
              <div>
                <h4 className="font-display text-lg font-bold text-foreground">Caleb Bupp</h4>
                <p className="font-mono text-xs text-primary mb-3">Clinical Genetics Advisor</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  <span className="text-foreground font-medium">Chief Clinical Geneticist</span> at Helen DeVos Children's Hospital at Corewell Health in Grand Rapids. An advocate for precision medicine and understanding our genome in terms clinicians can act on. Known for describing <span className="text-foreground font-medium">Bachmann-Bupp syndrome</span> and the life-changing cures he has brought to these children.
                </p>
              </div>
            </div>
          </div>

          {/* Andrew Pospisilik - featured advisor */}
          <div className="rounded-lg border border-border bg-card p-6 md:p-8 mb-4">
            <div className="flex flex-col sm:flex-row gap-6">
              <img
                src={pospisilikPhoto}
                alt="Andrew Pospisilik"
                className="w-24 h-24 rounded-full object-cover flex-shrink-0 grayscale"
              />
              <div>
                <h4 className="font-display text-lg font-bold text-foreground">Andrew Pospisilik</h4>
                <p className="font-mono text-xs text-primary mb-3">Scientific Advisor · Van Andel Institute</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  <span className="text-foreground font-medium">Chair of the Department of Epigenetics</span> at Van Andel Institute. Expert in genetic variability and how complex genotypes give rise to complex traits through epigenetic processes.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Validation</h2>
          <ul className="space-y-3 text-sm text-muted-foreground">
            {[
              "'Fast and interpretable NMF' (DeBruine et al., 2024) — proof-of-concept models hosted on CZI Cell Census",
              "319K+ CRAN downloads (RcppML) — 114 GitHub stars, 19 forks",
              "~$400K in CZI grant funding (Cycle 1 & Cycle 3)",
              "NIH Transformative R01 — NMF on 9M SNPs × 8,000 traits",
              "NMF hosted on CZI CELLxGENE — only non-transformer model",
              "NeurIPS presentation (CZ Initiative Expo)",
              "SPOTlight collaboration — NMF spatial deconvolution",

            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="text-primary mt-0.5">·</span> {item}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Key Hires (Planned)</h2>
          <div className="space-y-4">
            {[
              { role: "Senior ML Engineer", when: "Immediate", why: "Bridge model training, reasoning AI development" },
              { role: "Clinical Genomics Lead", when: "Month 6", why: "Evaluation harness, clinical partnerships, FDA" },
              { role: "Full-Stack Engineer", when: "Month 6", why: "Singlet Bio platform, Epic integration" },
              { role: "BD / Pharma Sales", when: "Month 12", why: "Enterprise sales, pharma pilot expansion" },
            ].map((h) => (
              <div key={h.role} className="flex items-start gap-4 pb-4 border-b border-border/50">
                <div className="font-mono text-xs text-primary whitespace-nowrap pt-0.5">{h.when}</div>
                <div>
                  <p className="font-display text-sm font-semibold text-foreground">{h.role}</p>
                  <p className="text-xs text-muted-foreground">{h.why}</p>
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

export default Team;

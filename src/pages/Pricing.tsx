import { useState } from "react";
import { ArrowRight, Check, ChevronDown, Cpu, Shield } from "lucide-react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const tiers = [
  {
    name: "Free",
    price: "Free",
    sub: "",
    desc: "Full model access with rate limits. API key required.",
    cta: "Get Started",
    ctaLink: "/docs",
    ctaStyle: "bg-primary text-primary-foreground hover:opacity-90",
    highlight: true,
    badge: null,
    includes: [
      "CPM inference — predict, perturb, compare",
      "Local cell generation via W · ĥ",
      "Gene programs (W matrix) — MIT open source",
      "MCP tools for AI coding assistants",
      "R + Python packages",
      "10 req/min · 1,000 req/day",
    ],
  },
  {
    name: "Pro",
    price: "$100",
    sub: "/ mo",
    desc: "Higher throughput and Bring Your Own Data projection.",
    cta: "Get Started",
    ctaLink: "mailto:hello@singletdb.com?subject=Singlet%20AI%20Pro",
    ctaStyle: "border border-border bg-secondary text-secondary-foreground hover:bg-muted",
    highlight: false,
    badge: null,
    includes: [
      "Everything in Free, plus:",
      "100 req/min · 10,000 req/day",
      "Batch inference API",
      "Bring Your Own Data — project into program space",
      "Priority email support",
      "Commercial license for outputs",
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    sub: "",
    desc: "Custom model training, commercial licensing, and dedicated support.",
    cta: "Contact Sales",
    ctaLink: "mailto:hello@singletdb.com?subject=Singlet%20AI%20Enterprise",
    ctaStyle: "border border-border bg-secondary text-secondary-foreground hover:bg-muted",
    highlight: false,
    badge: null,
    includes: [
      "Everything in Pro, plus:",
      "Custom rate limits",
      "Custom CPM training on your data",
      "Bring Your Own Data — unlimited projections",
      "Unlimited seats",
      "SLA + dedicated support",
    ],
  },
];

const faqs = [
  {
    q: "How does inference work? Where does my data go?",
    a: "The Singlet API returns lightweight program activity vectors (ĥ, ~1 KB per prediction). The W matrix (10,000+ programs × ~30K genes, ~240 MB) is cached on your device once. Cell generation — the matrix multiply W · ĥ — runs entirely on your machine. No raw expression data crosses the network in either direction.",
  },
  {
    q: "Can I generate unlimited cells?",
    a: "Yes. Each API call returns a seeding vector. You generate as many cells as you want locally — 100, 10,000, or 1 million — with no additional API calls. Your rate limit only applies to the initial prediction request.",
  },
  {
    q: "What's the difference between Free and Pro?",
    a: "Free gives you full model access at 10 req/min (1,000/day). Pro increases that to 100 req/min (10,000/day), adds batch inference for screening hundreds of conditions in one call, and includes Bring Your Own Data projection.",
  },
];

const FAQItem = ({ q, a }: { q: string; a: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border last:border-0">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between py-5 text-left gap-4">
        <span className="text-sm font-semibold text-foreground">{q}</span>
        <ChevronDown size={16} className={`text-muted-foreground flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="pb-5 animate-fade-in">
          <p className="text-sm text-muted-foreground leading-relaxed">{a}</p>
        </div>
      )}
    </div>
  );
};

const Pricing = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <div className="pt-32 pb-20 px-6">
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="text-center mb-16">
            <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Pricing</p>
            <h1 className="font-display text-4xl md:text-6xl font-bold text-foreground tracking-tightest mb-4">
              Free programs.<br />
              <span className="gradient-text">Scalable inference.</span>
            </h1>
            <p className="text-base text-muted-foreground max-w-xl mx-auto">
              The gene program dictionary is MIT open source. Inference scales from free to enterprise.
            </p>
          </div>

          {/* Tier Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20">
            {tiers.map((tier) => (
              <div
                key={tier.name}
                className={`rounded-xl p-7 flex flex-col relative ${tier.highlight
                  ? "border-2 border-primary bg-card shadow-[0_0_40px_-8px_hsl(174_84%_32%/0.2)]"
                  : "border border-border bg-card"
                  }`}
              >
                {tier.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-mono font-bold uppercase tracking-wider">
                    {tier.badge}
                  </div>
                )}
                <div className="mb-6">
                  <h3 className="font-display text-xl font-bold text-foreground mb-2">{tier.name}</h3>
                  <div className="flex items-baseline gap-1">
                    <span className="font-display text-4xl font-bold text-foreground">{tier.price}</span>
                    {tier.sub && <span className="text-sm text-muted-foreground">{tier.sub}</span>}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mb-6">{tier.desc}</p>
                <ul className="space-y-3 mb-8 flex-1">
                  {tier.includes.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm">
                      <Check size={15} className="text-green-600 mt-0.5 flex-shrink-0" />
                      <span className="text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>
                {tier.ctaLink.startsWith("mailto:") ? (
                  <a
                    href={tier.ctaLink}
                    className={`inline-flex items-center justify-center gap-2 px-6 py-3 rounded-md text-sm font-medium transition-all w-full ${tier.ctaStyle}`}
                  >
                    {tier.cta} <ArrowRight size={14} />
                  </a>
                ) : (
                  <Link
                    to={tier.ctaLink}
                    className={`inline-flex items-center justify-center gap-2 px-6 py-3 rounded-md text-sm font-medium transition-all w-full ${tier.ctaStyle}`}
                  >
                    {tier.cta} <ArrowRight size={14} />
                  </Link>
                )}
              </div>
            ))}
          </div>

          <div className="glow-line mx-auto max-w-4xl" />

          {/* How Inference Works */}
          <div className="mb-20 pt-14">
            <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4 text-center">Architecture</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground text-center tracking-tightest mb-4">
              Your data stays local. <span className="gradient-text">Inference scales infinitely.</span>
            </h2>
            <p className="text-sm text-muted-foreground text-center max-w-2xl mx-auto mb-10">
              The Singlet API returns lightweight program activity vectors — not raw expression data. Cell generation happens entirely on your device via a single matrix multiply. You control the scale.
            </p>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="rounded-xl border border-border bg-card p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Cpu size={20} className="text-primary" />
                  <h3 className="font-display text-base font-bold text-foreground">What crosses the network</h3>
                </div>
                <ul className="space-y-2.5 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2"><span className="text-primary font-bold mt-0.5">→</span>Your query: species, tissue, cell type, disease</li>
                  <li className="flex items-start gap-2"><span className="text-primary font-bold mt-0.5">←</span>Program activity vector ĥ (~1 KB per prediction)</li>
                  <li className="flex items-start gap-2"><span className="text-primary font-bold mt-0.5">←</span>Confidence scores and p-values</li>
                </ul>
                <p className="text-xs text-muted-foreground/70 mt-4">No raw expression data is sent or received. Ever.</p>
              </div>
              <div className="rounded-xl border border-primary/30 bg-primary/[0.02] p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Shield size={20} className="text-primary" />
                  <h3 className="font-display text-base font-bold text-foreground">What runs on your device</h3>
                </div>
                <ul className="space-y-2.5 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2"><Check size={14} className="text-green-600 mt-0.5 flex-shrink-0" />W matrix cached locally (~240 MB, one-time download)</li>
                  <li className="flex items-start gap-2"><Check size={14} className="text-green-600 mt-0.5 flex-shrink-0" />Cell generation: W · ĥ — you choose the cell count</li>
                  <li className="flex items-start gap-2"><Check size={14} className="text-green-600 mt-0.5 flex-shrink-0" />All downstream analysis (PCA, NMF, plotting)</li>
                </ul>
                <p className="text-xs text-primary/70 mt-4">Generate 100 or 1,000,000 cells from a single API call.</p>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-5 mt-6">
              <p className="text-sm text-muted-foreground leading-relaxed">
                <span className="text-foreground font-semibold">Why this matters:</span> Traditional APIs transfer full expression matrices over the network — gigabytes per request that scale with cell count. Singlet sends a ~1 KB seeding vector instead. You generate any number of cells locally via a single matrix multiply.
                This gives you on-prem-level data control with cloud-level efficiency, and your rate limit only applies to the prediction — not to how many cells you generate.
              </p>
            </div>
          </div>

          <div className="glow-line mx-auto max-w-4xl" />

          {/* FAQ */}
          <div className="max-w-2xl mx-auto mb-20 pt-14">
            <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground text-center tracking-tightest mb-10">
              Frequently Asked Questions
            </h2>
            <div className="rounded-xl border border-border bg-card px-6">
              {faqs.map((faq) => (
                <FAQItem key={faq.q} q={faq.q} a={faq.a} />
              ))}
            </div>
          </div>

          {/* Closing CTA */}
          <section className="py-14 border-t border-border text-center">
            <p className="font-display text-xl md:text-2xl font-bold text-foreground tracking-tight mb-3">
              Free programs. Scalable inference.
            </p>
            <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
              <span className="font-mono text-primary">pip install singletai</span> — start predicting in minutes.
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              <Link to="/docs" className="shimmer-border inline-flex items-center gap-2 px-6 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
                Get Started Free <ArrowRight size={14} />
              </Link>
              <a href="mailto:hello@singletdb.com?subject=Singlet%20AI%20Enterprise" className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md border border-border bg-secondary text-secondary-foreground text-sm font-medium hover:bg-muted transition-colors">
                Contact Sales
              </a>
            </div>
          </section>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default Pricing;

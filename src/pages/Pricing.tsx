import { useState } from "react";
import { ArrowRight, Check, ChevronDown, Cpu, Shield } from "lucide-react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const tiers = [
  {
    name: "Open",
    price: "Free",
    sub: "forever",
    desc: "The full atlas, loaders, and pipeline. MIT licensed — for research and commercial use alike.",
    cta: "Get Started",
    ctaLink: "/docs",
    ctaStyle: "bg-primary text-primary-foreground hover:opacity-90",
    highlight: true,
    badge: "Most Popular",
    includes: [
      "Full harmonized human atlas",
      "On-demand PyTorch DataLoader",
      "AnnData / SingleCellExperiment / NumPy",
      "Open-source BYOD pipeline",
      "Zenodo archives + citable DOIs",
      "Community streaming bandwidth",
    ],
  },
  {
    name: "Team",
    price: "$500",
    sub: "/ mo",
    desc: "Managed on-demand access for companies running Singlet in production.",
    cta: "Get Started",
    ctaLink: "mailto:hello@singlet.bio?subject=Singlet%20Bio%20Team",
    ctaStyle: "border border-border bg-secondary text-secondary-foreground hover:bg-muted",
    highlight: false,
    badge: null,
    includes: [
      "Everything in Open, plus:",
      "High-throughput edge access",
      "Priority streaming bandwidth",
      "Managed BYOD harmonization",
      "Email support",
      "Commercial use, no caps",
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    sub: "",
    desc: "Private hosting, scale, and harmonization of your internal data for pharma and large teams.",
    cta: "Contact Sales",
    ctaLink: "mailto:hello@singlet.bio?subject=Singlet%20Bio%20Enterprise",
    ctaStyle: "border border-border bg-secondary text-secondary-foreground hover:bg-muted",
    highlight: false,
    badge: null,
    includes: [
      "Everything in Team, plus:",
      "Private mirrors & VPC access",
      "Dedicated SLA + support",
      "Large-scale parallel streaming",
      "Harmonize your internal SRA/FASTQ",
      "Volume data access agreement",
    ],
  },
];

const faqs = [
  {
    q: "If the data is MIT open source, what am I paying for?",
    a: "The data, the loaders, and the pipeline are all MIT — you can download every release from Zenodo and self-host forever at no cost. Paid plans cover managed, on-demand access at scale: priority edge bandwidth from Cloudflare, support, and running the harmonization pipeline on your own data for you. You're paying for convenience and scale, never for the right to use the data.",
  },
  {
    q: "How does on-demand streaming work?",
    a: "The atlas lives on Cloudflare's edge. When your DataLoader asks for a slice — a tissue, a disease, a set of datasets — only those cells are fetched, decoded, and moved onto your device. Nothing is pre-downloaded, so a multi-million-cell training run starts in seconds and uses no local disk.",
  },
  {
    q: "Can I bring my own data?",
    a: "Yes. The same open-source pipeline that built the atlas runs on your SRA or FASTQ and produces matrices mapped to the identical references and gene space. They load right alongside the public atlas. Run it yourself for free, or let us manage harmonization on Team and Enterprise plans.",
  },
  {
    q: "Is the data really free for commercial use?",
    a: "Yes. It was computed on NSF ACCESS and university supercomputers and released under MIT, so any company can use it in products and pipelines. Team and Enterprise plans simply give you managed access, support, and scale on top of that.",
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
              Free for research.<br />
              <span className="gradient-text">Fair for industry.</span>
            </h1>
            <p className="text-base text-muted-foreground max-w-xl mx-auto">
              The data and code are MIT — download them from Zenodo forever. Paid plans cover managed on-demand access, support, and harmonizing your own data.
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

          {/* How Access Works */}
          <div className="mb-20 pt-14">
            <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4 text-center">How access works</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground text-center tracking-tightest mb-4">
              Open data. <span className="gradient-text">Managed access.</span>
            </h2>
            <p className="text-sm text-muted-foreground text-center max-w-2xl mx-auto mb-10">
              Everything is MIT and mirrored on Zenodo, so you can always self-host. Paid plans exist purely to make on-demand access fast, reliable, and effortless at scale.
            </p>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="rounded-xl border border-border bg-card p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Cpu size={20} className="text-primary" />
                  <h3 className="font-display text-base font-bold text-foreground">Always free &amp; open</h3>
                </div>
                <ul className="space-y-2.5 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2"><Check size={14} className="text-green-600 mt-0.5 flex-shrink-0" />Download any release from Zenodo with a DOI</li>
                  <li className="flex items-start gap-2"><Check size={14} className="text-green-600 mt-0.5 flex-shrink-0" />Self-host the data and serve it yourself</li>
                  <li className="flex items-start gap-2"><Check size={14} className="text-green-600 mt-0.5 flex-shrink-0" />Run the BYOD pipeline on your own hardware</li>
                </ul>
                <p className="text-xs text-muted-foreground/70 mt-4">MIT licensed — no usage caps, no strings.</p>
              </div>
              <div className="rounded-xl border border-primary/30 bg-primary/[0.02] p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Shield size={20} className="text-primary" />
                  <h3 className="font-display text-base font-bold text-foreground">What paid plans add</h3>
                </div>
                <ul className="space-y-2.5 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2"><Check size={14} className="text-green-600 mt-0.5 flex-shrink-0" />Priority on-demand streaming from the edge</li>
                  <li className="flex items-start gap-2"><Check size={14} className="text-green-600 mt-0.5 flex-shrink-0" />Managed harmonization of your own data</li>
                  <li className="flex items-start gap-2"><Check size={14} className="text-green-600 mt-0.5 flex-shrink-0" />Support, SLAs, and private mirrors</li>
                </ul>
                <p className="text-xs text-primary/70 mt-4">Pay for convenience and scale — never for the data.</p>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-5 mt-6">
              <p className="text-sm text-muted-foreground leading-relaxed">
                <span className="text-foreground font-semibold">Why this matters:</span> The atlas was computed on NSF ACCESS and university supercomputers and released under MIT, so it belongs to the community. Companies that want production-grade reliability, priority bandwidth, and hands-off harmonization of their internal data can pay a fair, predictable rate — without ever giving up the ability to fall back to the free, open release.
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
              Open data. Fair access.
            </p>
            <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
              <span className="font-mono text-primary">pip install singlet</span> — start streaming in minutes.
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              <Link to="/docs" className="shimmer-border inline-flex items-center gap-2 px-6 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
                Get Started Free <ArrowRight size={14} />
              </Link>
              <a href="mailto:hello@singlet.bio?subject=Singlet%20Bio%20Enterprise" className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md border border-border bg-secondary text-secondary-foreground text-sm font-medium hover:bg-muted transition-colors">
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

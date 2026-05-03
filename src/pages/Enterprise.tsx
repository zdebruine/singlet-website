import { ArrowRight, Shield, Server, Lock, Users } from "lucide-react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const Enterprise = () => (
    <div className="min-h-screen bg-background">
        <Navbar />

        <div className="pt-32 pb-20 px-6">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="text-center mb-16">
                    <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Enterprise</p>
                    <h1 className="font-display text-4xl md:text-6xl font-bold text-foreground tracking-tightest mb-4">
                        Transcriptomics intelligence,<br /><span className="gradient-text">behind your firewall.</span>
                    </h1>
                    <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                        Train Singlet on your proprietary data. Screen thousands of perturbations in minutes. All with the interpretability and speed your team needs to accelerate discovery. <a href="mailto:hello@singlet.bio?subject=Singlet%20Bio%20Enterprise" className="text-primary hover:underline">Contact sales</a> for an enterprise agreement.
                    </p>
                </div>

                {/* Feature grid */}
                <div className="grid md:grid-cols-2 gap-4 mb-8">
                    {[
                        {
                            icon: Server,
                            title: "Custom CPM inference",
                            desc: "Custom rate limits and dedicated infrastructure. Screen thousands of conditions with the batch inference API. No raw expression data crosses the network — all cell generation is local.",
                        },
                        {
                            icon: Lock,
                            title: "Custom model training",
                            desc: "Train models on your proprietary data combined with the public atlas. The base 10,000+ gene programs are open source; enterprise training adds custom programs, custom species, and custom references on top.",
                        },
                        {
                            icon: Users,
                            title: "Batch perturbation screening",
                            desc: "Screen thousands of perturbations across cell types in minutes. Predict program-level effects of gene knockouts, drug treatments, and combinations.",
                        },
                        {
                            icon: Shield,
                            title: "Compliance & security",
                            desc: "SOC 2 Type II, HIPAA-eligible, SSO/SAML, audit logs. Deployment options for regulated industries.",
                        },
                    ].map((item) => (
                        <div key={item.title} className="rounded-xl border border-border bg-card p-6 card-glow transition-all">
                            <item.icon className="text-primary mb-3" size={22} />
                            <h3 className="font-display text-base font-bold text-foreground mb-2">{item.title}</h3>
                            <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                        </div>
                    ))}
                </div>

                {/* What's included */}
                <div className="rounded-xl border border-border bg-card p-6 mb-8">
                    <h2 className="font-display text-lg font-bold text-foreground mb-4">Everything in Pro, plus</h2>
                    <div className="grid md:grid-cols-2 gap-x-8 gap-y-2">
                        {[
                            "Custom CPM training on your data",
                            "Bring Your Own Data — unlimited projections",
                            "Batch perturbation screening API",
                            "Commercial license for all outputs",
                            "SSO / SAML authentication",
                            "Dedicated account manager",
                            "Custom SLA (up to 99.95%)",
                            "Audit logging & compliance reports",
                            "Unlimited seats",
                            "Custom API rate limits",
                        ].map((item) => (
                            <div key={item} className="flex items-center gap-2 py-1.5">
                                <div className="w-1.5 h-1.5 rounded-full bg-primary flex-none" />
                                <span className="text-sm text-foreground">{item}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Use case */}
                <div className="rounded-xl border border-border bg-card p-6 mb-8">
                    <h2 className="font-display text-lg font-bold text-foreground mb-3">Built for pharma & biotech</h2>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                        Enterprise customers run the CPM behind their firewall for drug discovery workflows. Use cases include
                        target discovery (predict cell-type-specific effects of gene knockouts), mechanism of action profiling (which
                        named programs change under treatment?), safety assessment (predict off-target effects across tissues),
                        batch screening (screen thousands of perturbations across cell types in minutes), trajectory prediction (factor
                        velocities for developmental and disease progression), and multimodal inference (predict ATAC/protein from RNA alone).
                    </p>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                        The CPM's interpretable outputs — named biological programs with magnitudes — give scientists results they can
                        validate directly, unlike opaque embeddings from transformer models.
                    </p>
                </div>

                {/* CTA */}
                <div className="rounded-xl border-2 border-primary/20 bg-primary/[0.04] p-8 text-center">
                    <h3 className="font-display text-lg font-bold text-foreground mb-2">Talk to us</h3>
                    <p className="text-sm text-muted-foreground mb-6">
                        Enterprise pricing starts at $25K/year, depending on deployment model, data volume, and team size. Let's find the right fit.
                    </p>
                    <a
                        href="mailto:hello@singlet.bio?subject=Singlet%20Bio%20Enterprise"
                        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
                    >
                        Contact Sales <ArrowRight size={14} />
                    </a>
                </div>
            </div>
        </div>

        <Footer />
    </div>
);

export default Enterprise;

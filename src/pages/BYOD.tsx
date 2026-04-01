import { ArrowRight, Upload, Shield, Zap, Lock, Users, FileCheck } from "lucide-react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const BYOD = () => (
    <div className="min-h-screen bg-background">
        <Navbar />

        {/* ═══ HERO ═══ */}
        <section className="pt-28 pb-16 md:pt-36 md:pb-20 px-6 relative">
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-primary/[0.06] blur-[100px]" />
            </div>
            <div className="max-w-4xl mx-auto text-center relative">
                <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/[0.08] text-xs font-mono text-primary mb-4">
                    Pro Feature
                </span>
                <h1 className="font-display text-4xl md:text-6xl font-bold text-foreground tracking-tightest mb-4">
                    Your data. <span className="gradient-text">Our atlas.</span>
                </h1>
                <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
                    Upload private datasets and contextualize them against the world's largest single-cell atlas. Same pipeline. Same programs. Full cross-atlas comparison.
                </p>
            </div>
        </section>

        <div className="max-w-5xl mx-auto px-6 pb-20">

                {/* How it works */}
                <div className="mb-12">
                    <p className="section-dot font-mono text-xs text-primary uppercase tracking-widest mb-3 text-center">Workflow</p>
                    <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground text-center tracking-tightest mb-8">Three steps. <span className="gradient-text">Full context.</span></h2>
                    <div className="grid md:grid-cols-3 gap-4 stagger-fade">
                        {[
                            {
                                icon: Upload,
                                title: "Upload",
                                desc: "Push your .h5ad files via the Python client. Data stays encrypted in transit and at rest.",
                            },
                            {
                                icon: Zap,
                                title: "Process",
                                desc: "Same pipeline as the public atlas — reference alignment, QC, normalization, and NNLS projection onto the open-source gene programs (W matrix). Your cells are contextualized, not just annotated.",
                            },
                            {
                                icon: Shield,
                                title: "Query",
                                desc: "Your private data appears in your workspace alongside public atlas data. Query across both seamlessly.",
                            },
                        ].map((step) => (
                            <div key={step.title} className="rounded-xl border border-border bg-card p-5 text-center">
                                <step.icon className="mx-auto mb-3 text-primary" size={24} />
                                <h3 className="font-display text-sm font-bold text-foreground mb-2">{step.title}</h3>
                                <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="glow-line mx-auto max-w-4xl" />

                {/* Code example */}
                <div className="rounded-xl border border-border overflow-hidden my-12">
                    <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border bg-muted/30">
                        <div className="w-2.5 h-2.5 rounded-full bg-destructive/60" />
                        <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                        <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                        <span className="ml-2 font-mono text-[10px] text-muted-foreground">byod.py</span>
                    </div>
                    <div className="bg-background p-5 font-mono text-xs leading-6 overflow-x-auto">
                        <code className="text-foreground">
                            <span className="text-primary">import</span> singlet{"\n\n"}
                            <span className="text-muted-foreground"># Upload your experiment</span>{"\n"}
                            singlet.upload(<span className="text-primary">"my_experiment.h5ad"</span>){"\n\n"}
                            <span className="text-muted-foreground"># Query your private data alongside the public atlas</span>{"\n"}
                            adata = singlet.query({"\n"}
                            {"  "}tissue=<span className="text-primary">"lung"</span>,{"\n"}
                            {"  "}include_private=<span className="text-primary">True</span>{"\n"}
                            ){"\n\n"}
                            <span className="text-muted-foreground"># Your data is contextualized: NMF programs, cell types, cross-atlas comparison</span>{"\n"}
                            adata.obs[<span className="text-primary">"cell_type"</span>]  <span className="text-muted-foreground"># CL ontology labels</span>{"\n"}
                            adata.obsm[<span className="text-primary">"X_nmf"</span>]     <span className="text-muted-foreground"># atlas-projected NMF factors</span>
                        </code>
                    </div>
                </div>

                <div className="glow-line mx-auto max-w-4xl" />

                {/* Benefits */}
                <div className="grid md:grid-cols-2 gap-4 my-12">
                        {[
                            {
                                icon: FileCheck,
                                title: "Consistent processing",
                                desc: "Same pipeline as every public dataset. Zero batch effects from different tools or references.",
                            },
                            {
                                icon: Zap,
                                title: "Atlas-scale context",
                                desc: "See which programs are active in your data. Compare against published disease cohorts at atlas scale.",
                            },
                            {
                                icon: Users,
                                title: "Team collaboration",
                                desc: "Shared private workspace. Upload once — everyone on the team can query.",
                            },
                            {
                                icon: FileCheck,
                                title: "Publication-ready",
                                desc: "Reproducible contextualization against the same atlas reference. Reviewers trust traceable methods.",
                            },
                        ].map((item) => {
                            const Icon = item.icon;
                            return (
                                <div key={item.title} className="rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/30">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Icon size={16} className="text-primary" />
                                        <h3 className="font-display text-sm font-bold text-foreground">{item.title}</h3>
                                    </div>
                                    <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                                </div>
                            );
                        })}
                </div>

                {/* Security */}
                <div className="rounded-xl border border-border bg-card p-5 mb-12 flex items-start gap-4">
                    <Lock size={18} className="text-primary mt-0.5 flex-shrink-0" />
                    <div>
                        <h2 className="font-display text-sm font-bold text-foreground mb-1">Data security</h2>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                        Your data is encrypted in transit (TLS 1.3) and at rest (AES-256). Private datasets are isolated per team
                        and never visible to other users. Enterprise customers can deploy BYOD processing entirely on-premises.
                    </p>
                    </div>
                </div>

                {/* CTA */}
                <section className="py-14 border-t border-border text-center">
                    <p className="font-display text-xl md:text-2xl font-bold text-foreground leading-snug tracking-tight mb-2">
                        BYOD is included in Pro and Enterprise.
                    </p>
                    <p className="text-sm text-muted-foreground mb-6">
                        Pro starts at $149/mo. Enterprise gets on-premises BYOD.
                    </p>
                    <div className="flex flex-wrap gap-3 justify-center">
                        <Link to="/pricing" className="shimmer-border inline-flex items-center gap-2 px-6 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
                            See Plans <ArrowRight size={14} />
                        </Link>
                        <Link to="/docs" className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md border border-border bg-secondary text-secondary-foreground text-sm font-medium hover:bg-muted transition-colors">
                            Read the Docs
                        </Link>
                    </div>
                </section>
        </div>

        <Footer />
    </div>
);

export default BYOD;

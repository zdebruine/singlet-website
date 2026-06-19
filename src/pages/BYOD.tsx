import { ArrowRight, Upload, Shield, Zap, Lock, FileCheck } from "lucide-react";
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
                    Open source · MIT
                </span>
                <h1 className="font-display text-4xl md:text-6xl font-bold text-foreground tracking-tightest mb-4">
                    Add your data <span className="gradient-text">to the atlas.</span>
                </h1>
                <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
                    Run the same open-source pipeline that built the public atlas on your own SRA or FASTQ. You get harmonized matrices — same references, same gene space — that load right alongside everything else.
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
                            title: "Run",
                            desc: "Point the open-source pipeline at your SRA accession or local FASTQ. It runs anywhere — laptop, HPC, or cloud — and your raw data never has to leave your machine.",
                        },
                        {
                            icon: Zap,
                            title: "Harmonize",
                            desc: "Identical references, QC, and normalization as every public dataset. The output is a standard matrix in the same gene space — no batch effects from different tools or builds.",
                        },
                        {
                            icon: Shield,
                            title: "Load",
                            desc: "Open your harmonized matrix with singlet.load() and stream it through the same DataLoader, concatenated with any slice of the public atlas.",
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
                        <span className="text-muted-foreground"># 1. Harmonize your run with the open pipeline</span>{"\n"}
                        <span className="text-muted-foreground">#    $ singlet-pipeline run SRR12345678 -o my_sample/</span>{"\n\n"}
                        <span className="text-primary">import</span> singlet{"\n\n"}
                        <span className="text-muted-foreground"># 2. Load your harmonized matrix</span>{"\n"}
                        mine = singlet.load(<span className="text-primary">"my_sample/"</span>){"\n\n"}
                        <span className="text-muted-foreground"># 3. Stream it next to the public atlas</span>{"\n"}
                        loader = singlet.dataloader({"\n"}
                        {"  "}datasets=[mine, <span className="text-primary">"atlas:pancreas"</span>],{"\n"}
                        {"  "}batch_size=<span className="text-primary">512</span>{"\n"}
                        ){"\n\n"}
                        <span className="text-muted-foreground"># Same gene space — concatenate freely</span>{"\n"}
                        mine.var_names == singlet.atlas.var_names  <span className="text-muted-foreground"># True</span>
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
                        title: "One gene space",
                        desc: "Your matrix lands in the same genes and normalization as the atlas — concatenate and train across both freely.",
                    },
                    {
                        icon: Lock,
                        title: "Your data stays yours",
                        desc: "The pipeline runs on your own hardware. Raw reads never have to leave your environment.",
                    },
                    {
                        icon: FileCheck,
                        title: "Publication-ready",
                        desc: "Reproducible, traceable methods against the same public reference — reviewers trust it.",
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
                    <h2 className="font-display text-sm font-bold text-foreground mb-1">Run it your way</h2>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        The pipeline is MIT licensed, so you can run it entirely on your own laptop, HPC, or VPC — no upload, no lock-in.
                        Prefer not to manage it? Team and Enterprise plans include managed harmonization, where we run the same pipeline on your data for you.
                    </p>
                </div>
            </div>

            {/* CTA */}
            <section className="py-14 border-t border-border text-center">
                <p className="font-display text-xl md:text-2xl font-bold text-foreground leading-snug tracking-tight mb-2">
                    The pipeline is free and open source.
                </p>
                <p className="text-sm text-muted-foreground mb-6">
                    Run it yourself for free, or let us manage harmonization on a paid plan.
                </p>
                <div className="flex flex-wrap gap-3 justify-center">
                    <Link to="/docs" className="shimmer-border inline-flex items-center gap-2 px-6 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
                        Read the Docs <ArrowRight size={14} />
                    </Link>
                    <Link to="/pricing" className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md border border-border bg-secondary text-secondary-foreground text-sm font-medium hover:bg-muted transition-colors">
                        See Plans
                    </Link>
                </div>
            </section>
        </div>

        <Footer />
    </div>
);

export default BYOD;

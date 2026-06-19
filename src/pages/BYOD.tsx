import { ArrowRight, Terminal, Shield, Zap, Lock, FileCheck } from "lucide-react";
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
                    Open source · MIT · runs locally
                </span>
                <h1 className="font-display text-4xl md:text-6xl font-bold text-foreground tracking-tightest mb-4">
                    Bring your data <span className="gradient-text">to the atlas.</span>
                </h1>
                <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
                    Run the <span className="font-mono text-foreground">singlet</span> pipeline on your own compute to turn raw reads into harmonized <span className="font-mono text-foreground">.singlet</span> data — same aligner, reference, and QC as the public atlas. No upload, no account, no plan.
                </p>
            </div>
        </section>

        <div className="max-w-5xl mx-auto px-6 pb-20">

            {/* How it works */}
            <div className="mb-12">
                <p className="section-dot font-mono text-xs text-primary uppercase tracking-widest mb-3 text-center">Workflow</p>
                <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground text-center tracking-tightest mb-8">Process locally. <span className="gradient-text">Load anywhere.</span></h2>
                <div className="grid md:grid-cols-3 gap-4 stagger-fade">
                    {[
                        {
                            icon: Terminal,
                            title: "Run the pipeline",
                            desc: "Point singlet at an SRA accession or your own FASTQs. It runs anywhere — laptop, HPC, or cloud — and your raw reads never have to leave your machine.",
                        },
                        {
                            icon: Zap,
                            title: "Get .singlet output",
                            desc: "Identical aligner, reference, and QC as every public dataset. The output is an open .singlet bundle in the same gene space — no batch effects from different tools or builds.",
                        },
                        {
                            icon: Shield,
                            title: "Load with the same tools",
                            desc: "Open your harmonized output with singlet.load_dir() in Python or as_seurat() in R — directly comparable and concatenable with any slice of the public atlas.",
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

            {/* Code example — CLI */}
            <div className="rounded-xl border border-border overflow-hidden my-12">
                <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border bg-muted/30">
                    <div className="w-2.5 h-2.5 rounded-full bg-destructive/60" />
                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">terminal</span>
                </div>
                <div className="bg-background p-5 font-mono text-xs leading-6 overflow-x-auto">
                    <code className="text-foreground">
                        <span className="text-muted-foreground"># Process an SRA accession with the same reference as the atlas</span>{"\n"}
                        <span className="text-primary">$</span> singlet-process SRR11537951 -o ./out --organism human{"\n\n"}
                        <span className="text-muted-foreground"># or your own FASTQs:</span>{"\n"}
                        <span className="text-primary">$</span> singlet-process --reads R1.fastq.gz R2.fastq.gz -o ./out --organism human
                    </code>
                </div>
            </div>

            {/* Code example — Python */}
            <div className="rounded-xl border border-border overflow-hidden my-12">
                <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border bg-muted/30">
                    <div className="w-2.5 h-2.5 rounded-full bg-destructive/60" />
                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">byod.py</span>
                </div>
                <div className="bg-background p-5 font-mono text-xs leading-6 overflow-x-auto">
                    <code className="text-foreground">
                        <span className="text-muted-foreground"># Same pipeline, from Python</span>{"\n"}
                        <span className="text-primary">from</span> singlet <span className="text-primary">import</span> run_pipeline{"\n\n"}
                        run = run_pipeline(<span className="text-primary">"SRR11537951"</span>, <span className="text-primary">"./out"</span>, organism=<span className="text-primary">"human"</span>){"\n\n"}
                        <span className="text-muted-foreground"># Load the harmonized output anywhere</span>{"\n"}
                        <span className="text-primary">import</span> singlet{"\n"}
                        adata = singlet.load_dir(<span className="text-primary">"./out"</span>){"\n\n"}
                        <span className="text-muted-foreground"># R: library(singlet); seu &lt;- load("./out", as = "seurat")</span>
                    </code>
                </div>
            </div>

            <div className="glow-line mx-auto max-w-4xl" />

            {/* Benefits */}
            <div className="grid md:grid-cols-2 gap-4 my-12">
                {[
                    {
                        icon: FileCheck,
                        title: "Same as the atlas",
                        desc: "Identical aligner, reference, and QC as every public dataset — so your data is directly comparable with zero batch effects from tooling or builds.",
                    },
                    {
                        icon: Zap,
                        title: "One gene space",
                        desc: "Your output lands in the same genes as the atlas — concatenate and analyze across both with the same singlet tools.",
                    },
                    {
                        icon: Lock,
                        title: "Local & free",
                        desc: "The pipeline runs on your own hardware. No upload required, no account, no keys, no tiers — and $0 egress.",
                    },
                    {
                        icon: FileCheck,
                        title: "Open formats",
                        desc: "Output is an open, self-contained .singlet bundle that loads with singlet.load_dir() in Python or load() in R. Reproducible, traceable methods reviewers trust.",
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

            {/* Notice */}
            <div className="rounded-xl border border-border bg-card p-5 mb-12 flex items-start gap-4">
                <Lock size={18} className="text-primary mt-0.5 flex-shrink-0" />
                <div>
                    <h2 className="font-display text-sm font-bold text-foreground mb-1">It's all yours</h2>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        The pipeline is MIT licensed and runs entirely on your own laptop, HPC, or VPC — no upload, no lock-in.
                        Data is CC0 and code is MIT, with no accounts, keys, or tiers. The live atlas spans 73,749 samples and 430.7M cells, and your harmonized data loads right alongside it.
                    </p>
                </div>
            </div>

            {/* CTA */}
            <section className="py-14 border-t border-border text-center">
                <p className="font-display text-xl md:text-2xl font-bold text-foreground leading-snug tracking-tight mb-2">
                    The pipeline is free and open source.
                </p>
                <p className="text-sm text-muted-foreground mb-6">
                    Run it on your own compute — no upload, no account, no plan.
                </p>
                <div className="flex flex-wrap gap-3 justify-center">
                    <Link to="/docs" className="shimmer-border inline-flex items-center gap-2 px-6 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
                        Read the Docs <ArrowRight size={14} />
                    </Link>
                </div>
            </section>
        </div>

        <Footer />
    </div>
);

export default BYOD;

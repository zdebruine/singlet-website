import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const TargetExplorer = () => (
    <div className="min-h-screen bg-background">
        <Navbar />

        <div className="pt-32 pb-20 px-6">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="text-center mb-16">
                    <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Atlas-Scale Intelligence</p>
                    <h1 className="font-display text-4xl md:text-6xl font-bold text-foreground tracking-tightest mb-4">
                        Target Explorer
                        <span className="ml-3 align-middle inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/15 text-amber-600">Coming Soon</span>
                    </h1>
                    <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                        Query any gene across the human atlas. See cell-type resolved expression across every tissue, disease context, and study — in seconds.
                    </p>
                    <p className="text-sm text-muted-foreground mt-4 italic">
                        Target Explorer is on our roadmap. In the meantime, <code className="text-foreground text-xs">singlet.gene_profile()</code> and <code className="text-foreground text-xs">singlet.programs()</code> are available now via the <Link to="/gene-programs" className="text-primary hover:underline">Gene Program Dictionary</Link>.
                    </p>
                </div>

                {/* Code example */}
                <div className="rounded-xl border border-primary/30 bg-primary/[0.04] p-6 mb-8">
                    <h3 className="font-display text-sm font-bold text-foreground mb-3">One line to explore a target</h3>
                    <div className="rounded-lg bg-background border border-border p-4 font-mono text-sm overflow-x-auto">
                        <code className="text-foreground">
                            <span className="text-primary">import</span> singlet{"\n\n"}
                            <span className="text-muted-foreground"># Expression of TREM2 across all cell types and tissues</span>{"\n"}
                            result = singlet.explore_gene(<span className="text-primary">"TREM2"</span>){"\n\n"}
                            <span className="text-muted-foreground"># Returns: expression by cell type, tissue, disease</span>{"\n"}
                            result.cell_types   <span className="text-muted-foreground"># mean expr per cell type</span>{"\n"}
                            result.tissues      <span className="text-muted-foreground"># mean expr per tissue</span>{"\n"}
                            result.diseases     <span className="text-muted-foreground"># enrichment per disease</span>{"\n\n"}
                            <span className="text-muted-foreground"># Quick differential: TREM2 in Alzheimer's vs. healthy brain</span>{"\n"}
                            singlet.compare_gene(<span className="text-primary">"TREM2"</span>,{"\n"}
                            {"  "}tissue=<span className="text-primary">"brain"</span>,{"\n"}
                            {"  "}disease=<span className="text-primary">"Alzheimer's"</span>,{"\n"}
                            {"  "}vs=<span className="text-primary">"normal"</span>)
                        </code>
                    </div>
                </div>

                {/* Use cases */}
                <div className="mb-8">
                    <h2 className="font-display text-xl font-bold text-foreground mb-6">Built for target validation</h2>
                    <div className="grid md:grid-cols-3 gap-4">
                        {[
                            {
                                title: "Atlas-scale expression",
                                desc: "See where your gene is expressed — which cell types, tissues, and developmental stages — across millions of cells.",
                            },
                            {
                                title: "Disease enrichment",
                                desc: "Is your target upregulated in disease? Compare expression between disease and healthy tissue at cell-type resolution.",
                            },
                            {
                                title: "Safety profiling",
                                desc: "Does your target express broadly or narrowly? Find off-target cell types before they become clinical surprises.",
                            },
                        ].map((item) => (
                            <div key={item.title} className="rounded-xl border border-border bg-card p-5">
                                <h3 className="font-display text-sm font-bold text-foreground mb-2">{item.title}</h3>
                                <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* How it works */}
                <div className="rounded-xl border border-border bg-card p-6 mb-8">
                    <h2 className="font-display text-lg font-bold text-foreground mb-4">How it works</h2>
                    <ol className="space-y-3">
                        {[
                            "Every dataset in Singlet Bio is processed through a uniform pipeline — same reference, same QC, same normalization.",
                            "Expression is pre-indexed per gene, so queries resolve in seconds rather than scanning raw matrices.",
                            "Results are computed across all matching cells in the atlas, weighted by dataset quality.",
                            "NMF gene programs provide additional context: which biological programs your target participates in.",
                        ].map((step, i) => (
                            <li key={i} className="flex gap-3 text-sm text-muted-foreground">
                                <span className="flex-none w-6 h-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-bold">
                                    {i + 1}
                                </span>
                                <span className="leading-relaxed">{step}</span>
                            </li>
                        ))}
                    </ol>
                </div>

                {/* CTA */}
                <div className="rounded-xl border-2 border-primary/20 bg-primary/[0.04] p-8 text-center">
                    <h3 className="font-display text-lg font-bold text-foreground mb-2">
                        Free for academic research
                    </h3>
                    <p className="text-sm text-muted-foreground mb-6">
                        Academic researchers get full access to cross-atlas gene queries, disease enrichment, and safety profiling. Commercial teams unlock higher rate limits and bulk API access with Pro ($149/mo).
                    </p>
                    <div className="flex flex-wrap gap-4 justify-center">
                        <Link
                            to="/pricing"
                            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
                        >
                            See Plans <ArrowRight size={14} />
                        </Link>
                        <Link
                            to="/intelligence"
                            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md border border-border bg-secondary text-secondary-foreground text-sm font-medium hover:bg-muted transition-colors"
                        >
                            All Intelligence Layers
                        </Link>
                    </div>
                </div>
            </div>
        </div>

        <Footer />
    </div>
);

export default TargetExplorer;

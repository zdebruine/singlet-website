import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { ArrowLeft, Check } from "lucide-react";

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

const Need = () => {
    return (
        <div className="min-h-screen bg-background">
            <Navbar />
            <section className="pt-36 pb-8 px-6">
                <div className="max-w-4xl mx-auto">
                    <Link to="/invest" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8">
                        <ArrowLeft size={14} /> Back
                    </Link>
                    <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Analysis of the Need</p>
                    <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground tracking-tightest mb-2">
                        The Beachhead Customer
                    </h1>
                    <p className="text-muted-foreground mt-4 max-w-3xl">
                        Computational biologists spend more time wrangling data than doing science. Every tool they use is free — and every tool fails them at scale.
                    </p>

                    {/* Day-in-the-life narrative */}
                    <div className="rounded-xl border border-border/60 bg-muted/20 p-6 mt-8 max-w-3xl">
                        <p className="text-sm text-muted-foreground leading-relaxed italic">
                            "It's 2 PM on a Tuesday. A postdoc in a gut immunology lab needs macrophages from Crohn's disease studies. She opens GEO, types a query, and gets 847 results — in 23 formats, from 14 sequencing platforms, with cell type labels that range from 'macrophage' to 'LP_Mac_CXCL10+' to nothing at all. She'll spend the next three weeks downloading, reformatting, and re-annotating before she can ask her actual scientific question."
                        </p>
                        <p className="text-sm text-foreground font-semibold mt-3">
                            She's not bad at her job. The infrastructure is bad at its job.
                        </p>
                    </div>
                    <div className="gradient-line mt-6" />
                </div>
            </section>

            <div className="max-w-4xl mx-auto px-6 space-y-16 pb-24">

                {/* Who is the customer */}
                <section>
                    <h2 className="font-display text-2xl font-bold text-foreground mb-6">Who Is the Customer?</h2>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                        She's a <span className="text-foreground font-semibold">computational biology postdoc or staff scientist</span> at an academic lab or biotech. She uses Python (Scanpy) or R (Seurat) daily. She downloads data from GEO/SRA manually, processes with her own pipeline, and fights batch effects that make cross-lab comparisons meaningless. She makes ~$60K/yr (~$30/hr). There are <span className="text-foreground font-semibold">~50,000</span> of her worldwide — and 20%+ more every year as single-cell becomes the default.
                    </p>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                        They already pay for specialized bioinformatics tools — <span className="text-foreground font-semibold">$200–$2,150/yr per seat</span> — plus cloud compute at <span className="text-foreground font-semibold">$500–$2,000/mo per lab</span>. What they don't have is a single platform that unifies single-cell data access, annotation, and querying. Singlet AI fills that gap at a price point they already budget for.
                    </p>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-center rounded-lg border border-border bg-card p-4">
                            <div className="font-mono text-xl font-bold text-foreground">60–80%</div>
                            <div className="text-xs text-muted-foreground mt-1">of time spent on data wrangling</div>
                        </div>
                        <div className="text-center rounded-lg border border-border bg-card p-4">
                            <div className="font-mono text-xl font-bold text-foreground">$620/yr</div>
                            <div className="text-xs text-muted-foreground mt-1">avg. academic bioinformatics tool cost</div>
                        </div>
                        <div className="text-center rounded-lg border border-border bg-card p-4">
                            <div className="font-mono text-xl font-bold text-foreground">1,700+</div>
                            <div className="text-xs text-muted-foreground mt-1">competing scRNA-seq tools</div>
                        </div>
                    </div>
                </section>

                {/* The tools they use today */}
                <section>
                    <h2 className="font-display text-2xl font-bold text-foreground mb-6">The Tools They Use Today — All Free, All Limited</h2>
                    <div className="space-y-4">
                        {[
                            {
                                tool: "Scanpy / Seurat",
                                role: "Analysis toolkits",
                                problem: "Require users to download, QC, normalize, and integrate data themselves. Every lab's pipeline is different → batch effects everywhere. No standard.",
                                source: "Zappia & Theis, Genome Biology 2021 — 1,700+ competing tools for scRNA-seq alone",
                            },
                            {
                                tool: "CZ CELLxGENE Census",
                                role: "Data discovery & download",
                                problem: "Only 149M cells across ~2,080 datasets. RNA only — no ATAC, CITE, spatial, perturbation. Author-processed (not uniform). No splicing layers. ~10 species. No GPU streaming. Funded by philanthropy, not sustainable.",
                                source: "CELLxGENE Census API docs, chanzuckerberg/cellxgene-census",
                            },
                            {
                                tool: "GEO / SRA",
                                role: "Raw data archive",
                                problem: "Downloading is painful — inconsistent metadata, no standard format, no filtering by cell type or disease. A single cross-dataset query can take weeks of manual curation.",
                                source: "sc-best-practices.org — 'analysts face an overwhelming array of computational tools'",
                            },
                            {
                                tool: "Cloud platforms (Terra, DNAnexus)",
                                role: "Compute",
                                problem: "Expensive ($500–2,000/mo per lab). Complex setup. Not optimized for single-cell. No pre-processed atlas to query.",
                                source: "Basepair pricing — per-sample costs, volume discounts for higher tiers",
                            },
                        ].map((item) => (
                            <div key={item.tool} className="rounded-lg border border-border bg-card px-5 py-4">
                                <div className="flex items-baseline gap-2 mb-1">
                                    <span className="font-display text-sm font-bold text-foreground">{item.tool}</span>
                                    <span className="text-[10px] font-mono text-primary uppercase">{item.role}</span>
                                </div>
                                <p className="text-sm text-muted-foreground leading-relaxed mb-1.5">{item.problem}</p>
                                <p className="text-[11px] text-muted-foreground/60 italic">{item.source}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* What comparable tools cost */}
                <section>
                    <h2 className="font-display text-2xl font-bold text-foreground mb-4">What They Already Pay For</h2>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                        The beachhead customer is <span className="text-foreground font-semibold">not</span> spending $0 on tools. They pay for specialized bioinformatics software, cloud compute, and figure/notebook tools. Singlet AI's $29/mo entry point is anchored to prices they already budget for.
                    </p>
                    <SubTable
                        headers={["Tool", "Academic Price", "What It Does"]}
                        rows={[
                            ["Geneious Prime", "$620/yr ($52/mo)", "Sequence analysis & molecular biology"],
                            ["GraphPad Prism", "$270–$710/yr", "Statistical graphing"],
                            ["FlowJo", "~$395/yr", "Flow cytometry analysis"],
                            ["MATLAB", "~$500/yr", "Numerical computing (campus license)"],
                            ["BioRender", "$384/yr ($32/mo)", "Figure creation for papers"],
                            ["Terra / Broad (cloud)", "$500–$2,000/mo", "GCP compute for genomics workflows"],
                            ["Benchling", "Free academic core", "Lab notebook (enterprise: ~$1,500+/seat)"],
                            ["CZ CELLxGENE Census", "Free (philanthropic)", "149M cells, no ML, no splicing, ~10 species"],
                            ["Scanpy / Seurat", "Free (open-source)", "Analysis toolkit — no data, no infra"],
                        ]}
                    />
                    <p className="text-xs text-muted-foreground mt-3 italic">
                        Source: Published pricing pages (Geneious, BioRender, FlowJo, Saturn Cloud, Terra/Broad). Benchling academic pricing confirmed via institutional licenses. 2025 data.
                    </p>
                </section>

                {/* ROI argument */}
                <section>
                    <h2 className="font-display text-2xl font-bold text-foreground mb-4">The ROI Argument</h2>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                        Researchers spend $620/yr for Geneious (sequence analysis), $384/yr for BioRender (figures), and <span className="text-foreground font-semibold">$500–$2,000/mo on cloud compute</span> they don't even like. Singlet AI token packs start at $29/mo — less than Geneious — for a tool that eliminates their #1 pain point: data wrangling. Heavy users who download more data naturally graduate to higher tiers.
                    </p>
                    <SubTable
                        headers={["Metric", "Value"]}
                        rows={[
                            ["Postdoc salary", "~$60K/yr = ~$30/hr"],
                            ["Hours wrangling data per week", "10–20 hrs (downloading, reformatting, QCing, integrating)"],
                            ["Hours saved with Singlet AI", "8–15 hrs/week (pre-processed, uniform, queryable)"],
                            ["Monthly time-savings value", "$960–$1,800/month"],
                            ["Comparable tool budget (existing)", "$600–$2,500/yr on Geneious, Prism, BioRender, etc."],
                            ["Cloud compute budget (existing)", "$500–$2,000/mo per lab (Terra, AWS, GCP)"],
                            ["Singlet AI Pro price", "$29/mo → less than Geneious, <3% of time saved"],
                        ]}
                    />
                    <p className="text-xs text-muted-foreground mt-3 italic">
                        PI discretionary budgets are typically $500–$5,000/mo depending on grants. $29/mo is well below the threshold that requires procurement approval at most institutions.
                    </p>
                </section>

                {/* Usage mechanics */}
                <section>
                    <h2 className="font-display text-2xl font-bold text-foreground mb-4">How We Control Usage — API Keys + Token Packs</h2>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                        Every user gets an <span className="text-foreground font-semibold">API key</span> tied to their account. All token-priced actions — annotated downloads, NMF embeddings, AI search, MCP tool calls — consume tokens proportional to usage. Free users get rate-limited R2 downloads; paid users get 10× higher throughput.
                    </p>
                    <SubTable
                        headers={["Researcher Profile", "Monthly Usage", "Tokens Burned", "Fits In"]}
                        rows={[
                            ["Light user — focused project", "20 queries, 5 large downloads, 2 diff. expression", "~350", "Starter (5K)"],
                            ["Active postdoc — meta-analysis", "100 queries, 30 large downloads, 10 diff. expression, 50 AI searches", "~2,100", "Starter (5K)"],
                            ["Power user — daily querying", "500 queries, 100 cross-atlas downloads, 30 diff. expression, 200 AI/MCP", "~15,500", "Researcher (25K)"],
                            ["Comp bio lab lead — team usage", "2,000 queries, 200+ cross-atlas exports, 100 diff. expression, 500 AI/MCP", "~65,000", "Lab (100K) or Enterprise"],
                        ]}
                    />
                    <div className="grid md:grid-cols-3 gap-4 mt-6">
                        <div className="rounded-lg border border-border bg-card p-4">
                            <p className="text-sm font-semibold text-foreground mb-1">Natural upgrade pressure</p>
                            <p className="text-xs text-muted-foreground leading-relaxed">Heavy users hit their token limit mid-month. One click to upgrade. No friction, no procurement delay.</p>
                        </div>
                        <div className="rounded-lg border border-border bg-card p-4">
                            <p className="text-sm font-semibold text-foreground mb-1">Graceful degradation</p>
                            <p className="text-xs text-muted-foreground leading-relaxed">When tokens run out, raw data access and free-tier tools still work. No cliff — just a nudge to upgrade.</p>
                        </div>
                        <div className="rounded-lg border border-border bg-card p-4">
                            <p className="text-sm font-semibold text-foreground mb-1">API key = usage tracking</p>
                            <p className="text-xs text-muted-foreground leading-relaxed">Every API call is authenticated. Usage dashboard shows remaining tokens, burn rate, and projected upgrade date.</p>
                        </div>
                    </div>
                </section>

                {/* What they expect */}
                <section>
                    <h2 className="font-display text-2xl font-bold text-foreground mb-6">What They Expect When They Land on singletdb.com</h2>
                    <div className="grid md:grid-cols-2 gap-4">
                        {[
                            {
                                need: "Instant credibility",
                                answer: "They need to know this is real — not vaporware. Show the cell count, the datasets, the publications. Compare head-to-head with CELLxGENE.",
                            },
                            {
                                need: "Clear time savings",
                                answer: "Show them exactly how many hours they'll save. 'Query the entire atlas in one line' hits harder than listing features.",
                            },
                            {
                                need: "Free tier that works",
                                answer: "Academics are allergic to paywalls. The free tier must be genuinely useful — raw data, PyTorch loaders, CLI. Not a teaser.",
                            },
                            {
                                need: "pip install → data in 5 minutes",
                                answer: "The terminal demo must be the first thing they see. If they can't start in 5 minutes, they'll leave.",
                            },
                            {
                                need: "Academic-friendly pricing",
                                answer: "Starting at $29/mo — less than Geneious Prime ($52/mo academic). Pure token-based so heavy downloaders pay more and light users pay less.",
                            },
                            {
                                need: "Better than what they have",
                                answer: "Many more species and datasets. Uniform reprocessing vs author-processed. Splicing layers. GPU streaming. They need to see this isn't incremental — it's a leap.",
                            },
                        ].map((item) => (
                            <div key={item.need} className="rounded-lg border border-border bg-card p-4">
                                <p className="text-sm font-semibold text-foreground mb-1">{item.need}</p>
                                <p className="text-xs text-muted-foreground leading-relaxed">{item.answer}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Summary */}
                <section>
                    <div className="rounded-lg border-2 border-primary/30 bg-primary/[0.05] px-6 py-5">
                        <p className="text-sm text-foreground leading-relaxed">
                            <span className="font-bold">Bottom line:</span> The beachhead customer already spends <span className="font-semibold">$600–$2,500/yr on comparable tools</span> plus <span className="font-semibold">$500–$2,000/mo on cloud compute</span>. Singlet AI starts at $29/mo — below their existing tool budget — and eliminates the <span className="font-semibold">60–80% of time</span> they spend on data wrangling. Once they're querying the entire atlas in one line of code, they don't go back to downloading from GEO.
                        </p>
                    </div>
                </section>
            </div>

            <Footer />
        </div>
    );
};

export default Need;

import { Link } from "react-router-dom";
import { ArrowRight, ExternalLink } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const DataLicense = () => (
    <div className="min-h-screen bg-background">
        <Navbar />

        <div className="pt-32 pb-20 px-6">
            <div className="max-w-3xl mx-auto">
                {/* Header */}
                <div className="mb-16">
                    <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Legal</p>
                    <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground tracking-tightest mb-4">
                        Data License
                    </h1>
                    <p className="text-lg text-muted-foreground leading-relaxed">
                        Clear terms for raw data, Singlet Bio-added intelligence layers, and API outputs.
                    </p>
                </div>

                {/* Raw Data */}
                <section className="mb-12">
                    <h2 className="font-display text-2xl font-bold text-foreground mb-4">Raw Count Matrices</h2>
                    <div className="rounded-xl border border-border bg-card p-6">
                        <div className="flex items-center gap-2 mb-3">
                            <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-600 text-xs font-mono font-bold uppercase">Free</span>
                            <span className="text-sm text-muted-foreground">No restrictions on academic use</span>
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                            All count matrices in Singlet Bio are derived from publicly deposited data on{" "}
                            <a href="https://www.ncbi.nlm.nih.gov/geo/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">GEO</a>{" "}
                            and{" "}
                            <a href="https://www.ebi.ac.uk/ena" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ENA/SRA</a>.
                            Original data deposit licenses apply. The vast majority of single-cell data on GEO is unrestricted for academic use.
                        </p>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                            <li className="flex items-start gap-2">
                                <span className="text-primary font-bold mt-0.5">•</span>
                                <span><span className="text-foreground font-medium">Academic use:</span> Freely available. Cite the dataset DOI and Singlet Bio.</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary font-bold mt-0.5">•</span>
                                <span><span className="text-foreground font-medium">Commercial use:</span> Check individual GEO series for commercial terms. Most deposits have no commercial restrictions, but some may.</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary font-bold mt-0.5">•</span>
                                <span><span className="text-foreground font-medium">Format:</span> Served from Cloudflare R2 in compressed format (.1pz). Free API key required for rate limiting.</span>
                            </li>
                        </ul>
                    </div>
                </section>

                {/* Singlet Bio-Added Layers */}
                <section className="mb-12">
                    <h2 className="font-display text-2xl font-bold text-foreground mb-4">Singlet Bio Intelligence Layers</h2>
                    <div className="rounded-xl border border-primary/30 bg-primary/[0.04] p-6">
                        <div className="flex items-center gap-2 mb-3">
                            <span className="px-2.5 py-1 rounded-full bg-primary/15 text-primary text-xs font-mono font-bold uppercase">CC-BY 4.0</span>
                            <span className="text-sm text-muted-foreground">Academic use — commercial requires Enterprise license</span>
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                            The following data layers are created by Singlet Bio and represent our intellectual contribution beyond the raw public data:
                        </p>
                        <div className="rounded-lg border border-border bg-background overflow-hidden mb-4">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border bg-muted/30">
                                        <th className="text-left px-4 py-3 font-medium text-foreground">Layer</th>
                                        <th className="text-left px-4 py-3 font-medium text-foreground">License</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {[
                                        ["NMF gene programs (W matrix)", "MIT license — free for any use, including commercial"],
                                        ["Per-cell NMF embeddings (H)", "CC-BY 4.0 (academic); Enterprise license (commercial)"],
                                        ["LLM cell type annotations", "CC-BY 4.0 (academic); Enterprise license (commercial)"],
                                        ["Disease / perturbation labels", "CC-BY 4.0 (academic); Enterprise license (commercial)"],
                                        ["QC flags and metrics", "CC-BY 4.0 (academic); Enterprise license (commercial)"],
                                        ["RNA velocity layers", "CC-BY 4.0 (academic); Enterprise license (commercial)"],
                                        ["Microbiome classifications", "CC-BY 4.0 (academic); Enterprise license (commercial)"],
                                        ["Standardized ontology mappings", "CC-BY 4.0 (academic); Enterprise license (commercial)"],
                                    ].map(([layer, license]) => (
                                        <tr key={layer} className="border-b border-border/50">
                                            <td className="px-4 py-2.5 font-medium text-foreground">{layer}</td>
                                            <td className="px-4 py-2.5 text-muted-foreground text-xs">{license}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            <span className="text-foreground font-semibold">CC-BY 4.0</span> means you may share and adapt these layers for any purpose, including publication, provided you give appropriate credit. See the{" "}
                            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                full license text <ExternalLink size={10} className="inline" />
                            </a>.
                        </p>
                    </div>
                </section>

                {/* Intelligence Layer Access */}
                <section className="mb-12">
                    <h2 className="font-display text-2xl font-bold text-foreground mb-4">Intelligence Layer Access</h2>
                    <div className="rounded-xl border border-border bg-card p-6">
                        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                            Intelligence layers are atlas-trained models that cannot be reproduced from count matrices alone. Access is governed by tier:
                        </p>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                            <li className="flex items-start gap-2">
                                <span className="text-primary font-bold mt-0.5">•</span>
                                <span><span className="text-foreground font-medium">Academic (free):</span> Full access to all intelligence layers via API. Rate-limited (10 req/min). Requires .edu or institutional email verification. Results may be published with citation.</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary font-bold mt-0.5">•</span>
                                <span><span className="text-foreground font-medium">Pro ($149/mo):</span> Higher rate limits (100 req/min), bulk programmatic API access, commercial license for all outputs.</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary font-bold mt-0.5">•</span>
                                <span><span className="text-foreground font-medium">Enterprise:</span> Custom rate limits, on-prem deployment, training data licensing, full commercial rights per enterprise agreement.</span>
                            </li>
                        </ul>
                    </div>
                </section>

                {/* Terms of Service: Prohibited Uses */}
                <section className="mb-12">
                    <h2 className="font-display text-2xl font-bold text-foreground mb-4">Prohibited Uses</h2>
                    <div className="rounded-xl border border-red-500/20 bg-red-500/[0.03] p-6">
                        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                            The following uses are prohibited under all tiers:
                        </p>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                            <li className="flex items-start gap-2">
                                <span className="text-red-500 font-bold mt-0.5">•</span>
                                <span><span className="text-foreground font-medium">Bulk mirroring:</span> Systematically downloading the full catalog or a substantial portion thereof to create a mirror, replica, or competing data repository.</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-red-500 font-bold mt-0.5">•</span>
                                <span><span className="text-foreground font-medium">Competing commercial services:</span> Using bulk downloads of Singlet Bio data or intelligence layers to build, train, or operate a competing commercial service, database, or API.</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-red-500 font-bold mt-0.5">•</span>
                                <span><span className="text-foreground font-medium">Redistribution of intelligence layers:</span> Bulk redistribution of atlas-trained intelligence layer outputs (NMF embeddings, annotations, velocity layers, microbiome classifications) without an Enterprise license.</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-red-500 font-bold mt-0.5">•</span>
                                <span><span className="text-foreground font-medium">Rate limit circumvention:</span> Using multiple accounts, proxy servers, or other means to circumvent per-tier rate limits.</span>
                            </li>
                        </ul>
                        <p className="text-xs text-muted-foreground mt-4">
                            Individual dataset downloads for research, publication, and personal use are unrestricted. These prohibitions target systematic commercial exploitation, not normal scientific use.
                        </p>
                    </div>
                </section>

                {/* API & Tool Outputs */}
                <section className="mb-12">
                    <h2 className="font-display text-2xl font-bold text-foreground mb-4">API & Tool Outputs</h2>
                    <div className="rounded-xl border border-border bg-card p-6">
                        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                            Responses from Singlet Bio features — including structured queries, MCP tools, gene program lookups, and NMF inference — are licensed under your subscription terms:
                        </p>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                            <li className="flex items-start gap-2">
                                <span className="text-primary font-bold mt-0.5">•</span>
                                <span><span className="text-foreground font-medium">Academic:</span> Results may be used for research and included in publications with citation. CC-BY 4.0 applies.</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary font-bold mt-0.5">•</span>
                                <span><span className="text-foreground font-medium">Pro:</span> Commercial use permitted for query results and derived analyses.</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary font-bold mt-0.5">•</span>
                                <span><span className="text-foreground font-medium">Enterprise:</span> Full commercial rights per your enterprise agreement, including redistribution of derived data and foundation model training data licensing.</span>
                            </li>
                        </ul>
                    </div>
                </section>

                {/* Citation */}
                <section className="mb-12">
                    <h2 className="font-display text-2xl font-bold text-foreground mb-4">How to Cite</h2>
                    <div className="rounded-xl border border-border bg-card p-6">
                        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                            If you use Singlet Bio data or tools in a publication, please cite Singlet Bio and include the release version (e.g., "Singlet Bio Release 2026-Q3").
                        </p>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            For specific datasets, include the GEO accession number.
                        </p>
                    </div>
                </section>

                {/* ML Training */}
                <section className="mb-12">
                    <h2 className="font-display text-2xl font-bold text-foreground mb-4">ML Model Training</h2>
                    <div className="rounded-xl border border-border bg-card p-6">
                        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                            Using Singlet Bio data to train machine learning models:
                        </p>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                            <li className="flex items-start gap-2">
                                <span className="text-primary font-bold mt-0.5">•</span>
                                <span><span className="text-foreground font-medium">NMF gene programs (W matrix):</span> MIT license — free to use for model training, GSEA, NNLS projection, or any other purpose. No restrictions.</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary font-bold mt-0.5">•</span>
                                <span><span className="text-foreground font-medium">Per-cell NMF embeddings as features:</span> CC-BY 4.0 for academic research. Enterprise license required for commercial ML products.</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary font-bold mt-0.5">•</span>
                                <span><span className="text-foreground font-medium">Annotations as labels:</span> CC-BY 4.0 for academic research. Enterprise license required for commercial ML products that redistribute our annotations.</span>
                            </li>
                        </ul>
                    </div>
                </section>

                {/* Contact */}
                <div className="rounded-xl border-2 border-primary/20 bg-primary/[0.04] p-6 text-center">
                    <h3 className="font-display text-base font-bold text-foreground mb-2">Questions about licensing?</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                        For commercial licensing, Enterprise terms, or specific questions about data reuse.
                    </p>
                    <a
                        href="mailto:hello@singletdb.com?subject=Data%20License%20Inquiry"
                        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
                    >
                        Contact Us <ArrowRight size={14} />
                    </a>
                </div>
            </div>
        </div>

        <Footer />
    </div>
);

export default DataLicense;

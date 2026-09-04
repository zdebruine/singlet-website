import { ArrowRight, ExternalLink } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const DataLicense = () => (
    <div className="min-h-screen bg-background">
        <Navbar />

        <div className="py-12 md:py-16 px-6">
            <div className="max-w-3xl mx-auto">
                {/* Header */}
                <div className="mb-16">
                    <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Legal</p>
                    <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground tracking-tightest mb-4">
                        License
                    </h1>
                    <p className="text-lg text-muted-foreground leading-relaxed">
                        Singlet Bio is open. The data is dedicated to the public domain under CC0 1.0,
                        and the <span className="font-mono">singlet</span> software is released under the MIT License.
                    </p>
                </div>

                {/* Summary */}
                <section className="mb-12">
                    <div className="rounded-lg border border-border bg-background overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border bg-muted/30">
                                    <th className="text-left px-4 py-3 font-medium text-foreground">What</th>
                                    <th className="text-left px-4 py-3 font-medium text-foreground">License</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr className="border-b border-border/50">
                                    <td className="px-4 py-2.5 font-medium text-foreground">Atlas data</td>
                                    <td className="px-4 py-2.5 text-muted-foreground text-xs">CC0 1.0 (public domain dedication)</td>
                                </tr>
                                <tr className="border-b border-border/50">
                                    <td className="px-4 py-2.5 font-medium text-foreground"><span className="font-mono">singlet</span> software (Python/R/C++)</td>
                                    <td className="px-4 py-2.5 text-muted-foreground text-xs">MIT License</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* Data */}
                <section className="mb-12">
                    <h2 className="font-display text-2xl font-bold text-foreground mb-4">Data — CC0 1.0</h2>
                    <div className="rounded-xl border border-primary/30 bg-primary/[0.04] p-6">
                        <div className="flex items-center gap-2 mb-3">
                            <span className="px-2.5 py-1 rounded bg-primary/10 text-primary text-xs font-mono font-bold uppercase">CC0 1.0</span>
                            <span className="text-sm text-muted-foreground">Public domain — no rights reserved</span>
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                            All atlas data published by Singlet Bio — processed count matrices, QC metrics,
                            metadata, and the <span className="font-mono">.singlet</span> / <span className="font-mono">.1pz</span> bundles —
                            is released under the{" "}
                            <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                Creative Commons CC0 1.0 Universal <ExternalLink size={10} className="inline" />
                            </a>{" "}
                            public domain dedication. To the extent possible under law, we waive all copyright and
                            related rights in this data.
                        </p>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                            <li className="flex items-start gap-2">
                                <span className="text-primary font-bold mt-0.5">•</span>
                                <span><span className="text-foreground font-medium">Any use:</span> Copy, modify, and redistribute the data for any purpose, including commercial use.</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary font-bold mt-0.5">•</span>
                                <span><span className="text-foreground font-medium">No attribution required:</span> CC0 imposes no conditions. Citation is appreciated but not legally required.</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary font-bold mt-0.5">•</span>
                                <span><span className="text-foreground font-medium">Source data:</span> Atlas data is derived from publicly deposited records on{" "}
                                    <a href="https://www.ncbi.nlm.nih.gov/geo/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">GEO</a>{" "}
                                    and{" "}
                                    <a href="https://www.ebi.ac.uk/ena" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ENA/SRA</a>.
                                    The vast majority of single-cell data in these archives is unrestricted; where an original deposit carries its own terms, those terms remain with the depositor.
                                </span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary font-bold mt-0.5">•</span>
                                <span><span className="text-foreground font-medium">Format and access:</span> Bundles are served publicly from our CDN at no cost. No account or API key is required to download.</span>
                            </li>
                        </ul>
                    </div>
                </section>

                {/* Software */}
                <section className="mb-12">
                    <h2 className="font-display text-2xl font-bold text-foreground mb-4">Software — MIT</h2>
                    <div className="rounded-xl border border-border bg-card p-6">
                        <div className="flex items-center gap-2 mb-3">
                            <span className="px-2.5 py-1 rounded bg-primary/10 text-primary text-xs font-mono font-bold uppercase">MIT</span>
                            <span className="text-sm text-muted-foreground">Free for any use, including commercial</span>
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                            The <span className="font-mono">singlet</span> package — the Python, R, and C++ tooling used to read,
                            write, and work with the atlas — is released under the{" "}
                            <a href="https://opensource.org/license/mit" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                MIT License <ExternalLink size={10} className="inline" />
                            </a>.
                        </p>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                            <li className="flex items-start gap-2">
                                <span className="text-primary font-bold mt-0.5">•</span>
                                <span>Use, copy, modify, merge, publish, distribute, and sublicense the software, including in commercial products.</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary font-bold mt-0.5">•</span>
                                <span>The only condition is that the MIT copyright notice and permission notice be retained in copies of the software.</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary font-bold mt-0.5">•</span>
                                <span>The software is provided "as is", without warranty of any kind.</span>
                            </li>
                        </ul>
                    </div>
                </section>

                {/* Citation */}
                <section className="mb-12">
                    <h2 className="font-display text-2xl font-bold text-foreground mb-4">How to Cite</h2>
                    <div className="rounded-xl border border-border bg-card p-6">
                        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                            Citation is not required, but it helps others find the resource and supports continued work.
                            If you use the atlas or the <span className="font-mono">singlet</span> software in a publication,
                            please cite Singlet Bio and include the release version (e.g., "Singlet Bio Release 2026-Q3").
                        </p>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            For specific datasets, include the original GEO accession number.
                        </p>
                    </div>
                </section>

                {/* Contact */}
                <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-6 text-center">
                    <h3 className="font-display text-base font-bold text-foreground mb-2">Questions about licensing?</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                        We're happy to clarify anything about how the data and software are licensed.
                    </p>
                    <a
                        href="https://github.com/Singlet-Bio/singlet/issues"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-primary h-10 px-6"
                    >
                        Ask on GitHub Issues <ArrowRight size={14} />
                    </a>
                </div>
            </div>
        </div>

        <Footer />
    </div>
);

export default DataLicense;

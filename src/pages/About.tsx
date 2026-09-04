import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { CodeBlock } from "@/components/CodeBlock";
import { apiClient } from "@/integrations/api/client";
import { usePageMeta } from "@/hooks/usePageMeta";
import { FAILURE_CATEGORY_DOCS, failureLabel, fmtCompact, fmtInt, fmtPct } from "@/lib/catalog-display";

const Mono = ({ children }: { children: React.ReactNode }) => <code className="code-inline">{children}</code>;

const STEPS = [
  {
    title: "Download",
    body: "Raw reads for every sample (GSM) in the study are fetched from SRA. Samples whose runs are missing, withdrawn or single-ended for a droplet protocol are recorded as failed at this step, not silently dropped.",
  },
  {
    title: "Protocol detection",
    body: "The library type (10x 3' v2/v3, 10x 5', Drop-seq, CITE-seq, BD Rhapsody, Smart-seq, …) is detected from the reads and the GEO/SRA metadata so the right barcode and UMI layout is applied. Samples where no chemistry can be confirmed are labelled \"10x (protocol unconfirmed)\" in the catalog.",
  },
  {
    title: "Alignment and counting",
    body: "Reads are mapped to a single reference per organism (see below) and counted per cell barcode and gene, separately for exonic and intronic reads, plus splice junctions. Every sample in the atlas is processed with the same pipeline version and parameters.",
  },
  {
    title: "Per-sample QC",
    body: "Cells are called, and each sample gets mapping rate, cells called, median genes and UMIs per cell and mitochondrial fraction. A sample that falls under the minimum thresholds is kept in the catalog and marked failed with the reason.",
  },
  {
    title: "One .singlet bundle per study",
    body: "All processed samples of a study are packed into one .singlet file (a ZIP64 archive of sparse matrices and JSON metadata) and published to Cloudflare R2. Nothing is re-normalised or batch-corrected; you get raw counts.",
  },
];

function useHashScroll() {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 40);
    return () => clearTimeout(t);
  }, [hash]);
}

const About = () => {
  usePageMeta({
    title: "About the data",
    description: "How every study in the singlet atlas is processed, which references are used, what failed means, processing status, license (CC0 data, MIT code) and how to cite.",
    path: "/about",
  });
  useHashScroll();

  const { data: stats } = useQuery({ queryKey: ["corpus-stats"], queryFn: () => apiClient.stats(), staleTime: 120_000 });
  const { data: facets } = useQuery({ queryKey: ["facets"], queryFn: () => apiClient.facets(), staleTime: 300_000 });

  const failed = stats ? stats.total_samples - stats.success_samples : null;
  const failureFacets = (facets?.failure_categories ?? []).slice().sort((a, b) => b.count - a.count);
  const failureTotal = failureFacets.reduce((a, f) => a + f.count, 0);
  const year = new Date().getFullYear();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="container-site flex-1 py-10 md:py-14">
        <article className="prose-doc max-w-[760px]">
          <header className="mb-10">
            <h1 className="text-[36px] md:text-[42px] mb-3">About the data</h1>
            <p className="text-[17px] text-muted-foreground">
              The atlas is every public single-cell RNA-seq study on GEO that the pipeline can process, reprocessed from
              raw reads the same way, so numbers from different labs are directly comparable.
            </p>
          </header>

          {/* ── Processing ── */}
          <section id="processing" className="pb-12 mb-12 border-b border-border scroll-mt-20">
            <h2>What a study goes through</h2>
            <ol className="!list-none !pl-0 space-y-4 mt-5">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex gap-4">
                  <span className="font-mono text-[13px] text-primary tabular pt-0.5 w-6 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <h3 className="!mt-0 !mb-1">{s.title}</h3>
                    <p className="!mb-0 text-[14.5px]">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* ── References ── */}
          <section id="references" className="pb-12 mb-12 border-b border-border scroll-mt-20">
            <h2>References</h2>
            <p>One reference build per organism, used for every sample of that organism:</p>
            <table>
              <thead>
                <tr>
                  <th>Organism</th>
                  <th>Genome build</th>
                  <th>Annotation</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Human</td>
                  <td><Mono>GRCh38</Mono> (2024-A reference build)</td>
                  <td>GENCODE gene annotation shipped with the 2024-A build</td>
                </tr>
                <tr>
                  <td>Mouse</td>
                  <td><Mono>GRCm39</Mono> (2024-A reference build)</td>
                  <td>GENCODE gene annotation shipped with the 2024-A build</td>
                </tr>
              </tbody>
            </table>
            <p>
              The build a sample was mapped to is recorded per cell in <Mono>obs["reference_build"]</Mono> and in the
              bundle's <Mono>feature_vocab.json</Mono>, so gene ids are always interpretable.
            </p>
            <div className="warning-surface px-4 py-3 text-[13.5px]">
              <strong className="font-medium">TODO (maintainer):</strong> confirm the exact GENCODE release numbers for
              the 2024-A builds and list the references used for organisms other than human and mouse before this section
              is considered final.
            </div>
          </section>

          {/* ── Status ── */}
          <section id="status" className="pb-12 mb-12 border-b border-border scroll-mt-20">
            <h2>Processing status</h2>
            <p>Live numbers from the catalog. Failed samples stay in the catalog with their reason so studies are never silently incomplete.</p>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 my-5">
              {[
                { label: "studies", value: stats ? fmtInt(stats.series_count) : null },
                { label: "samples processed", value: stats ? fmtInt(stats.success_samples) : null },
                { label: "samples failed", value: failed != null ? fmtInt(failed) : null },
                { label: "success rate", value: stats ? fmtPct(stats.success_rate) : null },
              ].map((s) => (
                <div key={s.label} className="surface px-4 py-3">
                  <dd className="font-display font-bold text-[24px] leading-none tabular text-foreground">
                    {s.value ?? <span className="inline-block h-6 w-16 rounded bg-secondary animate-pulse" />}
                  </dd>
                  <dt className="mt-1.5 text-xs text-muted-foreground">{s.label}</dt>
                </div>
              ))}
            </dl>
            {stats && (
              <p className="text-[13.5px] text-muted-foreground">
                {fmtCompact(stats.total_cells)} cells across processed samples; mean mapping rate {fmtPct(stats.avg_mapping_rate)}; mean
                median genes per cell {fmtInt(stats.avg_median_genes)}. Cell counts for a small number of plate-based samples are
                withheld while a known counting bug is corrected upstream.
              </p>
            )}

            {failureFacets.length > 0 && (
              <>
                <h3>Failed samples by reason</h3>
                <ul className="!list-none !pl-0 space-y-2">
                  {failureFacets.map((f) => {
                    const pct = failureTotal ? (f.count / failureTotal) * 100 : 0;
                    return (
                      <li key={f.value} className="grid grid-cols-[minmax(0,180px)_1fr_auto] items-center gap-3 text-[13px]">
                        <span className="truncate" title={f.value}>{failureLabel(f.value)}</span>
                        <span className="h-2 bg-secondary rounded-none overflow-hidden">
                          <span className="block h-full bg-warning/70" style={{ width: `${Math.max(pct, 0.5)}%` }} />
                        </span>
                        <span className="font-mono tabular text-muted-foreground">{fmtInt(f.count)}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>

          {/* ── Failed ── */}
          <section id="failed" className="pb-12 mb-12 border-b border-border scroll-mt-20">
            <h2>What "failed" means</h2>
            <p>
              A failed sample is one the pipeline could not turn into a usable count matrix. Its metadata is still in the
              catalog and the reason is recorded in <Mono>failure_category</Mono>:
            </p>
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Meaning</th>
                </tr>
              </thead>
              <tbody>
                {FAILURE_CATEGORY_DOCS.map((f) => (
                  <tr key={f.value}>
                    <td className="whitespace-nowrap">
                      <div className="font-medium">{f.label}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{f.value}</div>
                    </td>
                    <td>{f.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Failed samples are not included in a study's <Mono>.singlet</Mono> file. If every sample in a study failed,
              the study has no file and the study page says so.
            </p>
          </section>

          {/* ── License & citation ── */}
          <section id="cite" className="pb-12 mb-12 border-b border-border scroll-mt-20">
            <h2>License and citation</h2>
            <p>
              The atlas data is dedicated to the public domain under{" "}
              <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener noreferrer">CC0 1.0</a>.
              You can use it for anything, including commercial work, with no attribution requirement. The{" "}
              <Mono>singlet</Mono> software is{" "}
              <a href="https://github.com/Singlet-Bio/singlet/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT licensed</a>.
              Details are on the <Link to="/data-license">license page</Link>.
            </p>
            <h3>How to cite</h3>
            <p>
              Please cite both the original study and the atlas release you used. The original study is the GEO accession
              and its publication (linked from every study page); the atlas release is the <Mono>singlet_version</Mono>{" "}
              recorded in the file manifest and on the study page.
            </p>
            <CodeBlock
              label="text"
              code={`<Original authors>. <Title>. GEO accession GSE178957 (<year>).
Singlet Bio. singlet atlas, release <singlet_version>. https://singlet.bio (accessed ${year}).`}
            />
          </section>

          {/* ── Contact ── */}
          <section id="contact" className="scroll-mt-20">
            <h2>Contact</h2>
            <p>
              Questions, a study that looks wrong, or a protocol we should support: email{" "}
              <a href="mailto:hello@singlet.bio">hello@singlet.bio</a> or open an issue on{" "}
              <a href="https://github.com/Singlet-Bio/singlet/issues" target="_blank" rel="noopener noreferrer">GitHub</a>.
              Processing runs on NSF ACCESS allocations; the data is served from Cloudflare R2 at no cost to you.
            </p>
          </section>
        </article>
      </main>
      <Footer />
    </div>
  );
};

export default About;

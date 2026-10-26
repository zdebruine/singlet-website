import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { FeedbackButton } from "@/components/FeedbackDialog";
import { usePageMeta } from "@/hooks/usePageMeta";

// Known issues in the Research Alpha files, each with what Beta changes. Owner rule: excluded samples and studies are
// never listed, counted or linked here; the page states the inclusion criteria only.

interface Issue {
  id: string;
  title: string;
  alpha: ReactNode;
  beta: ReactNode;
}

const ISSUES: Issue[] = [
  {
    id: "reads",
    title: "Reads: only part of each sample was used",
    alpha: (
      <>
        <p>
          Alpha used only the first sequencing run of each sample, and at most its first 30 million reads. The median sample used
          15% of its available reads.
        </p>
        <p>
          This lowers the number of cells called and the UMIs per cell. Against the authors' own Cell Ranger results, Alpha finds a
          median of 73% of their cells.{" "}
          <Link to="/benchmarking#alpha" className="text-primary underline underline-offset-2">See the measurements</Link>.
        </p>
      </>
    ),
    beta: <p>Every read of every run is used, with no cap.</p>,
  },
  {
    id: "counting",
    title: "Counting: some molecules are counted twice",
    alpha: (
      <>
        <p>
          A molecule that touches both an exon and an intron, a molecule in nested genes, or a multi-mapping read split across
          workers can be counted twice. This adds 2% to 19% per cell, and more for some genes.
        </p>
        <p>Counts also depend slightly on the number of threads used.</p>
        <p>The spliced and unspliced layers are not suited to RNA velocity.</p>
      </>
    ),
    beta: <p>Every molecule is counted once, as spliced, unspliced or ambiguous. Counts do not depend on the thread count.</p>,
  },
  {
    id: "cell-calling",
    title: "Cell calling: conservative",
    alpha: (
      <>
        <p>
          Cells were called with the STARsolo CellRanger2.2 knee filter. Its calls are precise, but it misses cells with little
          RNA.
        </p>
        <p>Every barcode with at least 100 reads is stored in the file, so you can call cells again with your own method.</p>
      </>
    ),
    beta: <p>Modern droplet calling, benchmarked in public against independent truth.</p>,
  },
  {
    id: "not-in-alpha",
    title: "Not in Alpha",
    alpha: (
      <>
        <ul className="list-disc pl-5 space-y-1">
          <li>Cell-type annotations.</li>
          <li>Chromosomal sex and genetic ancestry.</li>
          <li>Doublet and ambient-RNA estimates.</li>
          <li>Mitochondrial DNA variants and heteroplasmy.</li>
          <li>Germline genotypes.</li>
        </ul>
        <p>
          Some layers made by earlier pipeline versions are known to be unreliable. They are not offered on the site, through the
          API or the MCP server, or in downloads.
        </p>
      </>
    ),
    beta: (
      <p>
        Each annotation ships with a public benchmark. Genotypes are never released. Where derived information is useful, such as
        donor-relative mtDNA heteroplasmy, it is released in a privacy-preserving form.
      </p>
    ),
  },
  {
    id: "modalities",
    title: "Other modalities: partial or missing",
    alpha: (
      <>
        <p>Alpha is transcriptomics only. These are not supported, or only partly:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Antibody tags (ADT / CITE-seq) and hashtags (HTO).</li>
          <li>Chromatin accessibility (ATAC) and Multiome ATAC.</li>
          <li>Spatial coordinates. Visium libraries, where present, are served as spots without coordinates.</li>
          <li>CRISPR guide capture.</li>
          <li>V(D)J clonotypes. "Immune receptor genes" in a file is gene-body expression of TR and IG genes, not clonotypes.</li>
        </ul>
      </>
    ),
    beta: <p>Multimodal layers are added one by one, each with a public benchmark.</p>,
  },
  {
    id: "coverage",
    title: "Coverage: some studies and samples are missing",
    alpha: (
      <>
        <p>
          Some studies and samples are not in Alpha yet, while the criteria for identifying samples and library types are refined.
        </p>
        <p>
          Alpha includes RNA libraries that passed three checks: the reads match the expected strand orientation, the library is
          gene expression (not antibody, hashtag, guide, V(D)J or chromatin), and the count matrix is not empty.
        </p>
      </>
    ),
    beta: <p>Strand and chemistry are tested on every sample. More samples and more species are added.</p>,
  },
  {
    id: "metadata",
    title: "Metadata: some labels are uncurated",
    alpha: <p>Some metadata from GEO, such as sex, tissue and disease labels, is not curated and may be wrong.</p>,
    beta: <p>Curated metadata mapped to standard ontologies.</p>,
  },
  {
    id: "two-numbers",
    title: "Two numbers for the same thing",
    alpha: (
      <p>
        A cell or sample count on the website catalog can differ from the QC inside the file. When they differ, the file is the
        truth.
      </p>
    ),
    beta: <p>The catalog is rebuilt from the files, so both give the same number.</p>,
  },
];

const KnownIssues = () => {
  usePageMeta({
    title: "Known issues",
    description: "What is known to be wrong or missing in the Singlet Research Alpha files, and what Beta changes.",
    path: "/known-issues",
  });
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 container-site py-12 md:py-16">
        <div className="max-w-3xl">
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tightest text-foreground">Known issues</h1>
          <p className="mt-3 text-[15px] text-muted-foreground">
            singlet.bio is a Research Alpha. These are the issues we know about in the files you can download today, and what the
            Beta re-run (estimated Q1 2027) changes. If you find one that is not here, please tell us.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <FeedbackButton category="data" className="btn-primary btn-sm">Report an issue</FeedbackButton>
            <Link to="/beta" className="btn-secondary btn-sm">What's coming in Beta</Link>
            <Link to="/benchmarking#alpha" className="btn-secondary btn-sm">Alpha benchmarks</Link>
          </div>

          <nav aria-label="Issues" className="mt-8 flex flex-wrap gap-x-4 gap-y-1.5 text-[13.5px]">
            {ISSUES.map((i) => (
              <a key={i.id} href={`#${i.id}`} className="text-muted-foreground hover:text-foreground underline underline-offset-2">
                {i.title.split(":")[0]}
              </a>
            ))}
          </nav>
        </div>

        <ol className="mt-10 max-w-3xl space-y-5">
          {ISSUES.map((i) => (
            <li key={i.id} id={i.id} className="surface p-5 scroll-mt-20">
              <h2 className="text-[18px] leading-snug font-semibold text-foreground">{i.title}</h2>
              <div className="mt-3 grid gap-4 md:grid-cols-[1fr_minmax(0,0.8fr)]">
                <div>
                  <p className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">In Alpha</p>
                  <div className="mt-1.5 space-y-2 text-[14.5px] leading-relaxed text-foreground">{i.alpha}</div>
                </div>
                <div className="md:border-l md:border-border md:pl-4">
                  <p className="text-[11.5px] font-semibold uppercase tracking-wider text-primary">What Beta changes</p>
                  <div className="mt-1.5 space-y-2 text-[14.5px] leading-relaxed text-muted-foreground">{i.beta}</div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </main>
      <Footer />
    </div>
  );
};

export default KnownIssues;

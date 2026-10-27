import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { FeedbackButton } from "@/components/FeedbackDialog";
import { usePageMeta } from "@/hooks/usePageMeta";
import { ANNOTATIONS_LIVE } from "@/lib/release";

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
          10% of the reads deposited in SRA for it.
        </p>
        <p>
          This lowers the number of cells called and the UMIs per cell. Against the authors' own Cell Ranger results on 135
          samples, Alpha finds a median of 65% of their cells, with a quarter of their UMIs per cell.{" "}
          <Link to="/benchmarking#alpha" className="text-primary underline underline-offset-2">See the measurements</Link>.
        </p>
      </>
    ),
    beta: <p>Beta goal: use every read of every run, with no cap.</p>,
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
    beta: <p>Beta goal: count every molecule once, as spliced, unspliced or ambiguous, with counts that no longer depend on the thread count.</p>,
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
    beta: <p>Beta goal: modern droplet calling, benchmarked in public against independent truth.</p>,
  },
  ANNOTATIONS_LIVE
    ? {
        id: "annotations",
        title: "Annotations in Alpha, and their accuracy",
        alpha: (
          <>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <span className="font-medium">Chromosomal sex</span>, human and mouse: 98.1% of samples agree with the sex in their
                GEO metadata (153 of 156; the 3 disagreements were GEO errors). Some cells stay "ambiguous".
              </li>
              <li>
                <span className="font-medium">Cell type</span>, as Cell Ontology labels. Accuracy per study against curated labels:
                compartment 0.84, lineage 0.75, cell type 0.43, subtype 0.32. The deeper levels are a preview.
              </li>
              <li>
                <span className="font-medium">Genetic ancestry</span>, as continental HANCESTRO groups. Computed only for human donors
                with enough genotype coverage, which is a minority of studies. Validated on donors simulated from 1000 Genomes and on a
                small set of donors with self-reported ancestry. Mixed ancestry is reported as "admixed". No genotypes are published.
              </li>
            </ul>
            <p>Doublet, ambient-RNA and mitochondrial DNA allele layers are not in Alpha.</p>
            <p>
              <Link to="/benchmarking#alpha-annotations" className="text-primary underline underline-offset-2">How accuracy was measured</Link>
            </p>
          </>
        ),
        beta: (
          <p>
            Beta goal: a trained cell-type classifier with calibrated probabilities, and a larger ancestry benchmark. Donor-relative
            mtDNA heteroplasmy, released without genotypes, is being designed.
          </p>
        ),
      }
    : {
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
              Some layers made by earlier pipeline versions are known to be unreliable. They are not offered on the site or through
              the API and MCP server. Some whole-study downloads still contain them; do not use them.
            </p>
          </>
        ),
        beta: (
          <p>
            Beta goal: annotations that each ship with a public benchmark. Genotypes are never released. Donor-relative mtDNA
            heteroplasmy, released without genotypes, is being designed.
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
    beta: <p>Beta goal: add multimodal layers one by one, each with a public benchmark.</p>,
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
          gene expression (not antibody, hashtag, guide, V(D)J or chromatin), and at least one cell was called from the count matrix.
        </p>
      </>
    ),
    beta: <p>Beta goal: test strand and chemistry on every sample, and add more samples and species.</p>,
  },
  {
    id: "metadata",
    title: "Metadata: some labels are uncurated",
    alpha: <p>Some metadata from GEO, such as sex, tissue and disease labels, is not curated and may be wrong.</p>,
    beta: <p>Beta goal: curated metadata mapped to standard ontologies.</p>,
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
    beta: <p>Beta goal: rebuild the catalog from the files, so both give the same number.</p>,
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

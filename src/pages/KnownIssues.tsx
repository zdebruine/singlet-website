import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { FeedbackButton } from "@/components/FeedbackDialog";
import { usePageMeta } from "@/hooks/usePageMeta";

// Known issues in the Research Alpha files, each with what Beta changes. Owner rule: excluded samples and studies are
// never listed, counted or linked here; the page states the inclusion criteria only. Each issue leads with what it
// means for an analysis and what to do now; the explanation sits under Details.

interface Issue {
  id: string;
  title: string;
  /** One line: what a user of the files will notice. */
  effect: ReactNode;
  /** One line: what to do about it today. */
  action?: ReactNode;
  details: ReactNode;
  beta: ReactNode;
}

const L = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="text-primary underline underline-offset-2">
    {children}
  </Link>
);

const ISSUES: Issue[] = [
  {
    id: "reads",
    title: "Reads: only part of each sample was used",
    effect: "Fewer cells and fewer UMIs per cell than the authors report: a median 65% of their cells, with 26% of their UMIs per cell.",
    action: "Compare relative expression, not absolute depth. At equal depth, gene profiles nearly match the authors' matrices.",
    details: (
      <>
        <p>
          Alpha used only the first sequencing run of each sample, and at most its first 30 million reads. The median sample used
          10% of the reads deposited in SRA for it.
        </p>
        <p>
          Measured against the authors' own Cell Ranger results on 135 samples. The measurements are public:{" "}
          <a href="/data/benchmarks/alpha/alpha-cell-calling.json" className="text-primary underline underline-offset-2">cell calls</a> and{" "}
          <a href="/data/benchmarks/alpha/alpha-gex-counts.json" className="text-primary underline underline-offset-2">gene counts</a>.
        </p>
      </>
    ),
    beta: "Every read of every run, with no cap.",
  },
  {
    id: "counting",
    title: "Counting: some molecules are counted twice",
    effect: "Counts run 2% to 19% high per cell, more for some genes. The spliced and unspliced layers are not suited to RNA velocity.",
    action: "Use the gene counts for expression; do not run RNA velocity on Alpha layers.",
    details: (
      <>
        <p>
          A molecule that touches both an exon and an intron, a molecule in nested genes, or a multi-mapping read split across
          workers can be counted twice.
        </p>
        <p>Counts also depend slightly on the number of threads used.</p>
      </>
    ),
    beta: "Each molecule counted once, as spliced, unspliced or ambiguous, independent of the thread count.",
  },
  {
    id: "cell-calling",
    title: "Cell calling: conservative",
    effect: "Cells with little RNA are missed. The cells that are called are almost all the authors' cells too.",
    action: "Every barcode with at least 100 reads is in the file: call cells again with your own method.",
    details: <p>Cells were called with the STARsolo CellRanger2.2 knee filter. Its calls are precise, but it misses cells with little RNA.</p>,
    beta: "Modern droplet calling, benchmarked in public against independent truth.",
  },
  {
    id: "annotations",
    title: "Annotations: early accuracy",
    effect: "Compartment and lineage labels are usable; cell type and subtype are previews. Cells of cell-line samples carry the line's name instead of a cell type.",
    action: "Filter on compartment or lineage, and check deeper labels against your own markers.",
    details: (
      <>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <span className="font-medium">Cell type</span>, as Cell Ontology labels. Accuracy per study against curated labels:
            compartment 0.84, lineage 0.75, cell type 0.43, subtype 0.32. Study and sample search filter on the first three levels;
            every level can be queried per cell through the cell index.
          </li>
          <li>
            <span className="font-medium">Chromosomal sex</span>, human and mouse: 98.1% of samples agree with the sex in their GEO
            metadata (153 of 156; the 3 disagreements were GEO errors). About 13% of labelled human and mouse cells stay "ambiguous", mostly in samples
            that pool donors of both sexes or have few reads per cell.
          </li>
          <li>
            <span className="font-medium">Genetic ancestry</span>, as continental HANCESTRO groups, only for human donors with enough
            genotype coverage (under 1,000 samples). Mixed ancestry is reported as "admixed". No genotypes are published.
          </li>
        </ul>
        <p>
          The labeller was trained on primary tissue, so on a cultured cell line it gives the nearest primary cell type, which is
          often wrong: K-562 cells came out as "transit amplifying cell". Search, sample and study facts, and the MCP tools therefore
          give the cells of a cell-line sample its line as their cell type (Cellosaurus name and id, under "cultured cell"). The cells
          table inside each file keeps the labeller's original call.
        </p>
        <p>Doublet, ambient-RNA and mitochondrial DNA allele layers are not in Alpha.</p>
        <p>
          <L to="/benchmarking#alpha-annotations">How accuracy was measured</L>
        </p>
      </>
    ),
    beta: "A trained cell-type classifier with calibrated probabilities, and a larger ancestry benchmark.",
  },
  {
    id: "modalities",
    title: "Other modalities: partial or missing",
    effect: "Alpha is transcriptomics only.",
    details: (
      <ul className="list-disc pl-5 space-y-1">
        <li>Antibody tags (ADT / CITE-seq) and hashtags (HTO).</li>
        <li>Chromatin accessibility (ATAC) and Multiome ATAC.</li>
        <li>Spatial coordinates. Visium libraries, where present, are served as spots without coordinates.</li>
        <li>CRISPR guide capture.</li>
        <li>V(D)J clonotypes. "Immune receptor genes" in a file is gene-body expression of TR and IG genes, not clonotypes.</li>
      </ul>
    ),
    beta: "Multimodal layers added one by one, each with a public benchmark.",
  },
  {
    id: "coverage",
    title: "Coverage: some studies and samples are missing",
    effect: "Not every GEO study or sample is in Alpha yet.",
    details: (
      <>
        <p>Alpha includes RNA libraries that pass five checks:</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>The reads match the expected strand orientation.</li>
          <li>The library is gene expression, not antibody, hashtag, guide, V(D)J or chromatin.</li>
          <li>At least one cell was called from the count matrix.</li>
          <li>The sample is not removed by QC: at least 5% of reads mapped or a median of at least 10 genes per cell.</li>
          <li>The reads were aligned to the genome of the species GEO records for the study.</li>
        </ol>
        <p>
          The species check uses GEO's metadata, which is sometimes wrong, so a few correctly processed studies may be missing.
          Samples under the stricter low-QC cut-off (under 20% of reads mapped, or a median under 30 genes per cell) are kept but
          left out of counts and search unless you ask for them.
        </p>
      </>
    ),
    beta: "Strand, chemistry and species tested from the reads of every sample; more samples and species.",
  },
  {
    id: "metadata",
    title: "Metadata: some labels are uncurated",
    effect: "Some GEO labels, such as sex, tissue and disease, may be wrong.",
    action: "For sex, prefer the per-cell chromosomal sex measured from the reads.",
    details: (
      <p>
        Sample characteristics come from each sample's own GEO record. Tissue, disease, development stage, cell line and sample type
        are mapped to standard ontologies where the record states them; samples whose record does not state them have no value.
        The rest is copied word for word and is not curated.
      </p>
    ),
    beta: "Curated metadata mapped to standard ontologies.",
  },
  {
    id: "ai-assistants",
    title: "AI assistants: one page of cells per link",
    effect:
      "Claude and other assistants can hand over the cells they find with export_cells: a download link to a zip of gene counts with per-cell labels, up to 10,000 cells from 10 studies per link, with a link to the next page.",
    action: (
      <>
        Open the link in scanpy (read_10x_mtx) or Seurat (Read10X). For more cells or other layers, load them with the Python or R
        package. See <L to="/docs/mcp">the MCP docs</L>.
      </>
    ),
    details: (
      <p>
        export_cells decodes the matching cells on the server and returns gene counts (spliced plus unspliced, or either alone) with
        each cell's type, sex, ancestry and its sample's facts. Splice junctions and other modalities are not exported this way. With up
        to 20 genes it also answers with each gene's mean and the fraction of cells expressing it, per cell type.
      </p>
    ),
    beta: "Larger exports and an .h5ad download.",
  },
  {
    id: "two-numbers",
    title: "Two numbers for the same thing",
    effect: "A cell or sample count on the website can differ from the QC inside the file.",
    action: "When they differ, the file is the truth.",
    details: <p>A sample GEO lists under two series is in both studies' files, so atlas-wide totals count it twice.</p>,
    beta: "The catalog rebuilt from the files, so both give the same number.",
  },
];

function Tag({ tone, children }: { tone: "do" | "beta"; children: ReactNode }) {
  return <span className={`mr-2 text-[11.5px] font-semibold uppercase tracking-wider ${tone === "beta" ? "text-primary" : "text-foreground"}`}>{children}</span>;
}

const KnownIssues = () => {
  usePageMeta({
    title: "Known issues",
    description: "What is known to be wrong or missing in the Singlet Research Alpha files, what to do about it, and what Beta changes.",
    path: "/known-issues",
  });
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 container-site py-12 md:py-16">
        <div className="max-w-3xl">
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tightest text-foreground">Known issues</h1>
          <p className="mt-3 text-[15px] text-muted-foreground">
            What we know is wrong or missing in the Research Alpha files, what to do about it, and what the Beta re-run (estimated
            Q1 2027) changes. Found another? Tell us.
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

        <ol className="mt-10 max-w-3xl space-y-4">
          {ISSUES.map((i) => (
            <li key={i.id} id={i.id} className="surface p-5 scroll-mt-20">
              <h2 className="text-[18px] leading-snug font-semibold text-foreground">{i.title}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-foreground">{i.effect}</p>
              <div className="mt-3 space-y-1.5 text-[14px] leading-relaxed text-muted-foreground">
                {i.action && (
                  <p>
                    <Tag tone="do">What to do</Tag>
                    {i.action}
                  </p>
                )}
                <p>
                  <Tag tone="beta">What Beta changes</Tag>
                  {i.beta}
                </p>
              </div>
              <details className="group mt-3">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                  <ChevronRight size={14} className="transition-transform group-open:rotate-90" aria-hidden="true" />
                  Details
                </summary>
                <div className="mt-2 pl-5 space-y-2 text-[14px] leading-relaxed text-foreground">{i.details}</div>
              </details>
            </li>
          ))}
        </ol>
      </main>
      <Footer />
    </div>
  );
};

export default KnownIssues;

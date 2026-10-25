/** The capabilities benchmarked (ids from the results contract), in display order. Hero copy lives here; numbers only ever come from result files. */

export interface Capability {
  slug: string;
  name: string;
  group: string;
  /** What Singlet does, in two plain sentences. */
  hero: string;
  /** Tools it is compared against. */
  competitors: string[];
}

export const CAPABILITIES: Capability[] = [
  { slug: "gex-counts", name: "Gene expression", group: "Counting", competitors: ["STARsolo", "Cell Ranger", "alevin-fry", "scBaseCount"],
    hero: "Singlet aligns raw reads with an exact aligner genome-wide and counts UMIs per gene and cell, with one pipeline for every chemistry. Counts are compared with the standard tools on the same reads." },
  { slug: "spliced-unspliced", name: "Spliced / unspliced counting", group: "Counting", competitors: ["STARsolo Velocyto", "alevin-fry USA"],
    hero: "Each read is assigned to spliced, unspliced or ambiguous, so RNA velocity and nascent-RNA analyses need no second pass." },
  { slug: "junctions-psi", name: "Splice junctions and PSI", group: "Counting", competitors: ["STARsolo SJ"],
    hero: "Singlet reports per-cell junction counts and percent spliced in (PSI) for exon-skipping events, stored in the same file as the gene counts." },
  { slug: "cell-calling", name: "Cell calling", group: "Quality", competitors: ["Cell Ranger", "EmptyDrops"],
    hero: "Singlet separates cells from empty droplets. Calls are compared with Cell Ranger and EmptyDrops, and with truth from barnyard, hashtag and antibody data." },
  { slug: "ambient-rna", name: "Ambient RNA", group: "Quality", competitors: ["SoupX", "DecontX", "CellBender"],
    hero: "Singlet estimates the ambient RNA contamination of each sample and can correct counts for it." },
  { slug: "doublets", name: "Doublets", group: "Quality", competitors: ["scDblFinder", "Scrublet", "vireo"],
    hero: "Each cell gets a doublet score from an atlas-trained model rather than one fitted to the sample alone. Accuracy is measured against genotype-based doublet calls." },
  { slug: "donor-demux", name: "Donor demultiplexing", group: "Genetics", competitors: ["vireo", "souporcell", "demuxlet"],
    hero: "Pooled samples are split by donor without a reference genotype, including when the number of donors is unknown." },
  { slug: "donor-snps", name: "Donor SNP calling", group: "Genetics", competitors: ["cellsnp-lite", "bcftools"],
    hero: "Singlet calls donor variants from the reads. SNPs are used inside the pipeline and are never included in public downloads, so this page reports accuracy only." },
  { slug: "genetic-ancestry", name: "Ancestry inference", group: "Genetics", competitors: ["somalier", "peddy"],
    hero: "Genetic ancestry is inferred from variants in the reads and compared with 1000 Genomes labels." },
  { slug: "chromosomal-sex", name: "Chromosomal sex", group: "Genetics", competitors: ["cellXY", "XIST/chrY rule"],
    hero: "Sex is inferred per cell from X and Y chromosome signal and checked against known donor sex." },
  { slug: "mtdna", name: "mtDNA", group: "Genetics", competitors: ["mgatk", "pileup"],
    hero: "Mitochondrial variants and heteroplasmy are called per cell and used for clonality and lineage inference." },
  { slug: "non-host", name: "Non-host screening", group: "Screening", competitors: ["Kraken2"],
    hero: "Reads that do not map to the host are screened against microbial and viral references, so contamination and infection are visible per sample." },
  { slug: "cell-type", name: "Cell-type calling", group: "Annotation", competitors: ["CellTypist", "Azimuth", "SingleR"],
    hero: "Cells are labelled against a shared ontology so studies can be combined. Labels are scored against CELLxGENE author and curated annotations." },
  { slug: "adt", name: "ADT", group: "Modalities", competitors: ["CITE-seq-Count", "Cell Ranger"],
    hero: "Antibody-derived tags are counted per cell alongside genes." },
  { slug: "hto", name: "HTO", group: "Modalities", competitors: ["HTODemux", "demuxEM", "GMM-Demux"],
    hero: "Hashtag oligos are counted per cell and used to assign cells to samples." },
  { slug: "atac", name: "ATAC", group: "Modalities", competitors: ["Cell Ranger ARC", "ArchR", "Signac"],
    hero: "Chromatin accessibility fragments are processed from the same raw reads as the rest of the pipeline." },
  { slug: "multiome", name: "Multiome", group: "Modalities", competitors: ["Cell Ranger ARC"],
    hero: "Joint RNA plus ATAC libraries are processed together, with cells matched across both." },
  { slug: "spatial", name: "Spatial", group: "Modalities", competitors: ["Space Ranger"],
    hero: "Visium-style spatial libraries are counted per spot and compared with Space Ranger output." },
  { slug: "vdj", name: "V(D)J", group: "Modalities", competitors: ["Cell Ranger VDJ", "TRUST4", "MiXCR"],
    hero: "T- and B-cell receptor sequences are assembled and attached to cells, for studies with V(D)J libraries." },
  { slug: "crispr-guides", name: "CRISPR guide capture", group: "Modalities", competitors: ["Cell Ranger"],
    hero: "Guide RNA tags are counted per cell and assigned, so perturbation screens can be analysed from the file." },
  { slug: "alignment-performance", name: "Optimized STAR aligner", group: "Engine", competitors: ["STARsolo", "alevin-fry", "Cell Ranger"],
    hero: "Singlet ships an optimized STAR. Each change is measured for speed and memory, and the output is checked against the stock aligner." },
  { slug: "download", name: "Download orchestration", group: "Engine", competitors: ["prefetch + fasterq-dump"],
    hero: "Downloads from SRA and ENA are fed straight into the pipeline, so alignment starts while reads arrive." },
];

export const GROUPS = Array.from(new Set(CAPABILITIES.map((c) => c.group)));

export function findCapability(slug: string | undefined): Capability | undefined {
  return CAPABILITIES.find((c) => c.slug === slug);
}

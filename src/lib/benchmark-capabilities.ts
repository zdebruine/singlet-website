/**
 * The capabilities benchmarked for the Beta engine (Singlet 1.0.0; ids from the results contract), in display order.
 * Hero copy lives here; numbers only ever come from result files. Hero copy describes the Beta engine or a Beta goal,
 * never the Alpha files.
 */

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
    hero: "The Beta engine aligns raw reads genome-wide with an exact aligner and counts UMIs per gene and cell, with one pipeline for every chemistry. This page compares its counts with the standard tools on the same reads." },
  { slug: "spliced-unspliced", name: "Spliced / unspliced counting", group: "Counting", competitors: ["STARsolo Velocyto", "alevin-fry USA"],
    hero: "Beta goal: assign each molecule once to spliced, unspliced or ambiguous, so RNA velocity needs no second pass. Alpha files are not suited to velocity (see Known issues)." },
  { slug: "junctions-psi", name: "Splice junctions and PSI", group: "Counting", competitors: ["STARsolo SJ"],
    hero: "The Beta engine reports per-cell junction counts and percent spliced in (PSI) for exon-skipping events. This page compares them with STARsolo on the same reads." },
  { slug: "cell-calling", name: "Cell calling", group: "Quality", competitors: ["Cell Ranger", "EmptyDrops"],
    hero: "Beta goal: modern droplet calling that keeps low-RNA cells. Calls are compared with Cell Ranger and EmptyDrops, and with truth from barnyard, hashtag and genotype data." },
  { slug: "ambient-rna", name: "Ambient RNA", group: "Quality", competitors: ["SoupX", "DecontX", "CellBender"],
    hero: "Beta goal: estimate the ambient RNA contamination of each sample. Alpha does not offer ambient estimates." },
  { slug: "doublets", name: "Doublets", group: "Quality", competitors: ["scDblFinder", "Scrublet", "vireo"],
    hero: "Beta goal: a doublet score for each cell, measured against genotype-based doublet calls. Alpha does not offer doublet calls." },
  { slug: "donor-demux", name: "Donor demultiplexing", group: "Genetics", competitors: ["vireo", "souporcell", "demuxlet"],
    hero: "Beta goal: split pooled samples by donor without a reference genotype, including when the number of donors is unknown." },
  { slug: "donor-snps", name: "Donor SNP calling", group: "Genetics", competitors: ["cellsnp-lite", "bcftools"],
    hero: "The Beta engine calls donor variants from the reads for use inside the pipeline. Variants are never in public downloads, so this page reports accuracy only." },
  { slug: "genetic-ancestry", name: "Ancestry inference", group: "Genetics", competitors: ["somalier", "peddy"],
    hero: "Measured for the Beta engine: genetic ancestry inferred from the reads, compared with 1000 Genomes labels. No genotypes are published." },
  { slug: "chromosomal-sex", name: "Chromosomal sex", group: "Genetics", competitors: ["cellXY", "XIST/chrY rule"],
    hero: "Measured for the Beta engine: sex inferred per cell from X and Y chromosome signal, checked against the donor sex recorded in GEO." },
  { slug: "mtdna", name: "mtDNA", group: "Genetics", competitors: ["mgatk", "pileup"],
    hero: "Being designed for Beta: mitochondrial heteroplasmy per cell for clonality and lineage, released only as derived, donor-relative values. Alpha does not offer mtDNA variants." },
  { slug: "non-host", name: "Non-host screening", group: "Screening", competitors: ["Kraken2"],
    hero: "Beta goal: screen reads that do not map to the host against microbial and viral references, per sample." },
  { slug: "cell-type", name: "Cell-type calling", group: "Annotation", competitors: ["CellTypist", "Azimuth", "SingleR"],
    hero: "Measured for the Beta engine: cell-type labels on a shared ontology, scored against CELLxGENE author and curated annotations." },
  { slug: "adt", name: "ADT", group: "Modalities", competitors: ["CITE-seq-Count", "Cell Ranger"],
    hero: "Beta goal: antibody-derived tags (CITE-seq) counted per cell alongside genes. Not in Alpha." },
  { slug: "hto", name: "HTO", group: "Modalities", competitors: ["HTODemux", "demuxEM", "GMM-Demux"],
    hero: "Beta goal: hashtag oligos counted per cell and used to assign cells to samples. Not in Alpha." },
  { slug: "atac", name: "ATAC", group: "Modalities", competitors: ["Cell Ranger ARC", "ArchR", "Signac"],
    hero: "Beta goal: chromatin accessibility processed from the same raw reads as the rest of the pipeline. Not in Alpha." },
  { slug: "multiome", name: "Multiome", group: "Modalities", competitors: ["Cell Ranger ARC"],
    hero: "Beta goal: joint RNA and ATAC libraries processed together, with cells matched across both. Not in Alpha." },
  { slug: "spatial", name: "Spatial", group: "Modalities", competitors: ["Space Ranger"],
    hero: "Beta goal: Visium-style libraries counted per spot with coordinates, compared with Space Ranger. Not in Alpha." },
  { slug: "vdj", name: "V(D)J", group: "Modalities", competitors: ["Cell Ranger VDJ", "TRUST4", "MiXCR"],
    hero: "Beta goal: T- and B-cell receptor clonotypes assembled and attached to cells. Not in Alpha." },
  { slug: "crispr-guides", name: "CRISPR guide capture", group: "Modalities", competitors: ["Cell Ranger"],
    hero: "Beta goal: guide RNA tags counted and assigned per cell, so perturbation screens can be analysed from the file. Not in Alpha." },
  { slug: "alignment-performance", name: "Optimized STAR aligner", group: "Engine", competitors: ["STARsolo", "alevin-fry", "Cell Ranger"],
    hero: "The Beta engine ships an optimized STAR. Each change is measured for speed and memory, and its output is checked against the stock aligner." },
  { slug: "download", name: "Download orchestration", group: "Engine", competitors: ["prefetch + fasterq-dump"],
    hero: "The Beta engine feeds downloads from SRA and ENA straight into the pipeline, so alignment starts while reads arrive." },
];

export const GROUPS = Array.from(new Set(CAPABILITIES.map((c) => c.group)));

export function findCapability(slug: string | undefined): Capability | undefined {
  return CAPABILITIES.find((c) => c.slug === slug);
}

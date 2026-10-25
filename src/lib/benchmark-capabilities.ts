/** The capabilities benchmarked, in display order. Hero copy lives here; numbers only ever come from result files. */

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
  { slug: "gene-expression", name: "Gene expression", group: "Counting", competitors: ["STARsolo", "Cell Ranger", "alevin-fry", "scBaseCount"],
    hero: "Singlet aligns raw reads and counts UMIs per gene and cell, using one pipeline for every chemistry. Counts are compared with the standard tools on the same reads." },
  { slug: "spliced-unspliced", name: "Spliced / unspliced counting", group: "Counting", competitors: ["STARsolo Velocyto", "alevin-fry", "kb-python"],
    hero: "Each read is assigned to spliced, unspliced or ambiguous, so RNA velocity and nascent-RNA analyses need no second pass. Totals are checked against exon plus intron counts." },
  { slug: "splice-junctions-psi", name: "Splice junctions and PSI", group: "Counting", competitors: ["STARsolo SJ", "MARVEL", "SpliZ"],
    hero: "Singlet reports per-cell junction counts and percent spliced in (PSI) for exon-skipping events, stored in the same file as the gene counts." },
  { slug: "cell-calling", name: "Cell calling and ambient RNA", group: "Quality", competitors: ["Cell Ranger", "EmptyDrops", "CellBender", "STARsolo"],
    hero: "Singlet separates cells from empty droplets and estimates ambient RNA contamination per sample. Calls are compared with Cell Ranger and EmptyDrops." },
  { slug: "doublets", name: "Doublets", group: "Quality", competitors: ["Scrublet", "DoubletFinder", "scDblFinder"],
    hero: "Each cell gets a doublet score from an atlas-trained model rather than one fitted to the sample alone. Accuracy is measured on samples with known doublets from genotype pooling." },
  { slug: "donor-demux", name: "Donor demultiplexing", group: "Genetics", competitors: ["demuxlet", "Vireo", "souporcell", "freemuxlet"],
    hero: "Pooled samples are split by donor without a reference genotype, including when the number of donors is unknown. Assignments are compared with known donor labels." },
  { slug: "donor-snps", name: "Donor SNP calling", group: "Genetics", competitors: ["cellsnp-lite", "bcftools", "GATK"],
    hero: "Singlet calls donor variants from the reads. SNPs are used inside the pipeline and are never included in public downloads." },
  { slug: "ancestry", name: "Ancestry inference", group: "Genetics", competitors: ["ADMIXTURE", "PLINK PCA"],
    hero: "Genetic ancestry is inferred from SNPs called in the reads and compared with labelled reference panels." },
  { slug: "chromosomal-sex", name: "Chromosomal sex", group: "Genetics", competitors: ["Y-gene expression", "XIST rule"],
    hero: "Sex is inferred from X and Y chromosome signal and checked against the sex reported in the GEO record." },
  { slug: "cell-types", name: "Cell-type calling", group: "Annotation", competitors: ["CellTypist", "Azimuth", "scType", "SingleR"],
    hero: "Cells are labelled against a shared ontology so studies can be combined. Labels are scored against expert annotations in published datasets." },
  { slug: "mtdna", name: "mtDNA", group: "Genetics", competitors: ["mgatk", "MAESTER"],
    hero: "Mitochondrial variants and heteroplasmy are called per cell and used for clonality and lineage inference." },
  { slug: "non-host", name: "Non-host screening", group: "Screening", competitors: ["Kraken2", "SAHMI", "Viral-Track"],
    hero: "Reads that do not map to the host are screened against microbial and viral references, so contamination and infection are visible per sample." },
  { slug: "adt-hto", name: "ADT and HTO", group: "Modalities", competitors: ["CITE-seq-Count", "kb-python", "Cell Ranger"],
    hero: "Antibody-derived and hashtag oligo tags are counted per cell alongside genes, and hashtags are used for sample assignment." },
  { slug: "atac-multiome", name: "ATAC and Multiome", group: "Modalities", competitors: ["Cell Ranger ARC", "chromap", "STARsolo"],
    hero: "Chromatin accessibility fragments and joint RNA plus ATAC libraries are processed from the same raw reads." },
  { slug: "spatial", name: "Spatial", group: "Modalities", competitors: ["Space Ranger", "STARsolo"],
    hero: "Visium-style spatial libraries are counted per spot and compared with Space Ranger output." },
  { slug: "vdj", name: "V(D)J", group: "Modalities", competitors: ["Cell Ranger VDJ", "TRUST4", "MiXCR"],
    hero: "T- and B-cell receptor sequences are assembled and attached to cells, for studies with VDJ libraries." },
  { slug: "crispr", name: "CRISPR guide capture", group: "Modalities", competitors: ["Cell Ranger", "CITE-seq-Count", "mixscape"],
    hero: "Guide RNA tags are counted per cell and assigned, so perturbation screens can be analysed from the file." },
  { slug: "star-optimizations", name: "Optimized STAR aligner", group: "Engine", competitors: ["STAR 2.7.11"],
    hero: "Singlet ships an optimized STAR. Each change is measured on its own for speed and checked for identical results." },
  { slug: "download-orchestration", name: "Download orchestration", group: "Engine", competitors: ["fasterq-dump", "prefetch", "kingfisher"],
    hero: "Downloads from SRA and ENA are fed straight into the pipeline, so alignment starts while reads arrive and no intermediate FASTQ is kept." },
];

export const GROUPS = Array.from(new Set(CAPABILITIES.map((c) => c.group)));

export function findCapability(slug: string | undefined): Capability | undefined {
  return CAPABILITIES.find((c) => c.slug === slug);
}

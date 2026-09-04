/**
 * Display-layer rules for the catalog UI.
 * These never change stored values — they only affect what users see.
 */

/**
 * Known `n_cells` pipeline bug: plate-based protocols are "one well = one cell",
 * so implausibly large counts are artifacts. Tune the threshold here.
 * Keep in sync with functions/_shared/suspect-cells.ts.
 */
export const SUSPECT_CELL_COUNT_THRESHOLD = 5000;

/** Any sample above this is implausible regardless of protocol. */
export const HARD_SUSPECT_CELL_COUNT = 2_000_000;

export const PLATE_PROTOCOLS = [
  "smartseq2",
  "smartseq",
  "smart-seq2",
  "smart-seq3",
  "plate",
];

export function isSuspectCellCount(
  protocol: string | null | undefined,
  nCells: number | null | undefined
): boolean {
  if (nCells == null) return false;
  if (nCells > HARD_SUSPECT_CELL_COUNT) return true;
  return PLATE_PROTOCOLS.includes((protocol ?? "").toLowerCase()) && nCells > SUSPECT_CELL_COUNT_THRESHOLD;
}

export const FLAGGED_CELLS_LABEL = "flagged — under review";

/** Friendly label for protocol values whose stored form is opaque. */
const PROTOCOL_LABELS: Record<string, string> = {
  "10x_suspect": "10x (protocol unconfirmed)",
  "10xv2": "10x 3' v2",
  "10xv3": "10x 3' v3",
  "10x-3p-v2": "10x 3' v2",
  "10x-3p-v3": "10x 3' v3",
  "10xv3_5prime": "10x 5'",
  "10x-5p": "10x 5'",
  dropseq: "Drop-seq",
  indrop: "inDrop",
  smartseq2: "Smart-seq2",
  smartseq3: "Smart-seq3",
  citeseq: "CITE-seq",
  bd_rhapsody: "BD Rhapsody",
  seqwell: "Seq-Well",
  spatial: "Spatial",
  unknown: "Unknown",
};

export function protocolLabel(protocol: string | null | undefined): string {
  if (!protocol) return "—";
  return PROTOCOL_LABELS[protocol] ?? protocol;
}

/**
 * QC artifacts like "blank sample; Homo sapiens" are not organisms — hide them
 * from the filter UI (the underlying rows are untouched).
 */
export function isDisplayableOrganism(value: string | null | undefined): boolean {
  return !!value && !value.toLowerCase().includes("blank sample");
}

/** Scientific → common name, display only. Unknown names pass through. */
const ORGANISM_COMMON: Record<string, string> = {
  "homo sapiens": "Human",
  "mus musculus": "Mouse",
  "danio rerio": "Zebrafish",
  "rattus norvegicus": "Rat",
  "macaca mulatta": "Rhesus macaque",
  "macaca fascicularis": "Cynomolgus macaque",
  "drosophila melanogaster": "Fruit fly",
  "sus scrofa": "Pig",
  "gallus gallus": "Chicken",
  "caenorhabditis elegans": "C. elegans",
  "xenopus laevis": "African clawed frog",
  "xenopus tropicalis": "Western clawed frog",
  "canis lupus familiaris": "Dog",
  "bos taurus": "Cow",
  "ovis aries": "Sheep",
  "oryctolagus cuniculus": "Rabbit",
  "pan troglodytes": "Chimpanzee",
  "callithrix jacchus": "Marmoset",
  "arabidopsis thaliana": "Arabidopsis",
  "saccharomyces cerevisiae": "Yeast",
  "mesocricetus auratus": "Hamster",
  "cricetulus griseus": "Chinese hamster",
  "oryzias latipes": "Medaka",
  "equus caballus": "Horse",
  "capra hircus": "Goat",
  "heterocephalus glaber": "Naked mole-rat",
  "nothobranchius furzeri": "Turquoise killifish",
  "petromyzon marinus": "Sea lamprey",
  "ambystoma mexicanum": "Axolotl",
  "mustela putorius furo": "Ferret",
  "felis catus": "Cat",
  "cavia porcellus": "Guinea pig",
  "monodelphis domestica": "Opossum",
  "schmidtea mediterranea": "Planarian",
  "strongylocentrotus purpuratus": "Sea urchin",
  "ciona intestinalis": "Sea squirt",
  "oryza sativa": "Rice",
  "zea mays": "Maize",
  "plasmodium falciparum": "Malaria parasite",
  "hydra vulgaris": "Hydra",
  "nematostella vectensis": "Starlet sea anemone",
  "octopus bimaculoides": "California two-spot octopus",
  "synthetic construct": "Synthetic construct",
};

/**
 * Display label for an organism string. Composite values ("Homo sapiens; Mus
 * musculus") are mapped part by part ("Human; Mouse").
 */
export function organismLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .split(";")
    .map((part) => {
      const t = part.trim();
      return ORGANISM_COMMON[t.toLowerCase()] ?? t;
    })
    .join("; ");
}

/** Short scientific label kept for tooltips / secondary text. */
export function organismScientific(value: string | null | undefined): string {
  return value ?? "—";
}

/**
 * Plain-language explanations of `failure_category` values seen in the catalog.
 * Unknown categories fall back to a humanised version of the raw string.
 */
const FAILURE_LABELS: Record<string, { label: string; detail: string }> = {
  fail_download: {
    label: "Download failed",
    detail: "The raw reads could not be fetched from SRA (missing run, transfer error, or the run was withdrawn).",
  },
  fail_no_r2: {
    label: "No read 2 file",
    detail: "Only one read file was available; droplet protocols need the cDNA read and the barcode read.",
  },
  fail_protocol_detect: {
    label: "Protocol not recognised",
    detail: "The library type could not be determined from the reads or the GEO metadata, so no barcode layout could be applied.",
  },
  fail_simpleaf_permit: {
    label: "Barcode whitelist mismatch",
    detail: "Too few barcodes matched the expected whitelist for the detected 10x chemistry — usually a mislabelled protocol.",
  },
  fail_simpleaf_map: {
    label: "Mapping step failed",
    detail: "The read mapper exited with an error on this sample.",
  },
  fail_simpleaf_timeout: {
    label: "Mapping timed out",
    detail: "The sample exceeded the wall-clock budget for its size class and was stopped.",
  },
  fail_simpleaf_other: {
    label: "Mapping error (other)",
    detail: "An uncategorised error occurred in the mapping/quantification step.",
  },
  fail_low_mapping: {
    label: "Low mapping rate",
    detail: "Fewer reads than the minimum threshold mapped to the reference — often a species or protocol mismatch.",
  },
  fail_qc_few_cells: {
    label: "Too few cells",
    detail: "After cell calling, fewer cells than the minimum threshold remained.",
  },
  fail_qc_low_genes: {
    label: "Too few genes per cell",
    detail: "The median genes detected per cell fell below the minimum threshold.",
  },
  fail_qc_other: {
    label: "Failed QC (other)",
    detail: "The sample was processed but did not meet one of the other per-sample QC checks.",
  },
  skip_plate_based: {
    label: "Skipped: plate-based",
    detail: "Plate-based (well-per-cell) libraries are not yet handled by the droplet pipeline and were skipped.",
  },
};

export function failureLabel(category: string | null | undefined): string {
  if (!category) return "Failed";
  return FAILURE_LABELS[category]?.label ?? category.replace(/^fail_/, "").replace(/_/g, " ");
}

export function failureDetail(category: string | null | undefined): string | null {
  if (!category) return null;
  return FAILURE_LABELS[category]?.detail ?? null;
}

export const FAILURE_CATEGORY_DOCS = Object.entries(FAILURE_LABELS).map(([value, v]) => ({ value, ...v }));

/** True when the sample completed processing (either DONE or DONE with a QC warning). */
export function isProcessed(status: string | null | undefined): boolean {
  return status === "DONE" || status === "DONE_QC_WARN";
}

export function isFailed(status: string | null | undefined): boolean {
  return status === "FAIL" || status === "HARD_FAIL";
}

// ── Number formatting ────────────────────────────────────────────────────────

/** 453,262,193 → "453M"; 1,234 → "1.2K"; 9,876,543 → "9.9M" */
export function fmtCompact(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(abs >= 1e10 ? 0 : 1).replace(/\.0$/, "") + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(abs >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
  return n.toLocaleString();
}

export function fmtInt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return Math.round(n).toLocaleString();
}

export function fmtPct(fraction: number | null | undefined, digits = 1): string {
  if (fraction == null || Number.isNaN(fraction)) return "—";
  return (fraction * 100).toFixed(digits) + "%";
}

export function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  return (bytes / 1e3).toFixed(0) + " KB";
}

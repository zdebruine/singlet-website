// scripts/search-eval/parser-only.ts
import { readFileSync } from "node:fs";

// functions/_shared/session.ts
var SESSION_DAYS = 30;
var SESSION_MS = SESSION_DAYS * 864e5;

// functions/_shared/vocab.ts
var TISSUE_GROUPS = [
  "Blood / PBMC",
  "Brain / CNS",
  "Lung / airway",
  "Gut / intestine",
  "Bone marrow",
  "Lymphoid organs",
  "Heart / vascular",
  "Skin",
  "Tumor (site unspecified)",
  "Reproductive",
  "Organoid",
  "Liver",
  "Cell line / in vitro",
  "Kidney / urinary",
  "Breast",
  "Muscle / bone / joint",
  "Pancreas",
  "Eye",
  "Embryo / development",
  "Immune cells (sorted)",
  "Peripheral nervous system",
  "Oral / head & neck",
  "Adipose",
  "Endocrine",
  "Ear / inner ear",
  "Multiple / mixed",
  "Plant",
  "Other"
];
var DISEASE_GROUPS = [
  "Healthy / control",
  "Cancer",
  "Autoimmune / inflammatory",
  "COVID-19",
  "Other infection",
  "Metabolic / cardiovascular",
  "Alzheimer's disease",
  "Parkinson's disease",
  "Other neurological / psychiatric",
  "Genetic / developmental",
  "Injury / transplant / aging",
  "Other / unspecified"
];
var ASSAY_FAMILIES = [
  "10x 3'",
  "10x 5'",
  "10x (version unconfirmed)",
  "10x Multiome / ATAC",
  "Drop-seq / inDrop",
  "Smart-seq / plate-based",
  "Spatial",
  "CITE-seq",
  "BD Rhapsody",
  "Seq-Well / Microwell",
  "Parse / SPLiT-seq",
  "Not single-cell RNA",
  "Unknown"
];
var CANON = {
  tissue_group: new Map(TISSUE_GROUPS.map((g) => [g.toLowerCase(), g])),
  disease_group: new Map(DISEASE_GROUPS.map((g) => [g.toLowerCase(), g])),
  assay_family: new Map(ASSAY_FAMILIES.map((g) => [g.toLowerCase(), g]))
};
function canonicalGroup(field, value) {
  return CANON[field].get(value.trim().toLowerCase()) ?? null;
}
var RULES_TTL_MS = 60 * 60 * 1e3;
var ORGANISM_COMMON = {
  "homo sapiens": "Human",
  "mus musculus": "Mouse",
  "rattus norvegicus": "Rat",
  "danio rerio": "Zebrafish",
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
  "schmidtea mediterranea": "Planarian",
  "strongylocentrotus purpuratus": "Sea urchin",
  "ciona intestinalis": "Sea squirt",
  "oryza sativa": "Rice",
  "zea mays": "Maize",
  "plasmodium falciparum": "Malaria parasite",
  "hydra vulgaris": "Hydra",
  "nematostella vectensis": "Starlet sea anemone",
  "octopus bimaculoides": "California two-spot octopus",
  "mustela putorius furo": "Ferret",
  "felis catus": "Cat",
  "cavia porcellus": "Guinea pig",
  "monodelphis domestica": "Opossum",
  "synthetic construct": "Synthetic construct"
};
var ORGANISM_ALIASES = {
  human: "Homo sapiens",
  humans: "Homo sapiens",
  "homo sapiens": "Homo sapiens",
  hsapiens: "Homo sapiens",
  hs: "Homo sapiens",
  patient: "Homo sapiens",
  patients: "Homo sapiens",
  mouse: "Mus musculus",
  mice: "Mus musculus",
  murine: "Mus musculus",
  "mus musculus": "Mus musculus",
  mmusculus: "Mus musculus",
  mm: "Mus musculus",
  rat: "Rattus norvegicus",
  rats: "Rattus norvegicus",
  "rattus norvegicus": "Rattus norvegicus",
  zebrafish: "Danio rerio",
  "danio rerio": "Danio rerio",
  macaque: "Macaca mulatta",
  macaques: "Macaca mulatta",
  rhesus: "Macaca mulatta",
  "rhesus macaque": "Macaca mulatta",
  "macaca mulatta": "Macaca mulatta",
  cynomolgus: "Macaca fascicularis",
  "cynomolgus macaque": "Macaca fascicularis",
  "crab-eating macaque": "Macaca fascicularis",
  "macaca fascicularis": "Macaca fascicularis",
  fly: "Drosophila melanogaster",
  flies: "Drosophila melanogaster",
  "fruit fly": "Drosophila melanogaster",
  drosophila: "Drosophila melanogaster",
  "drosophila melanogaster": "Drosophila melanogaster",
  pig: "Sus scrofa",
  pigs: "Sus scrofa",
  porcine: "Sus scrofa",
  swine: "Sus scrofa",
  "sus scrofa": "Sus scrofa",
  chicken: "Gallus gallus",
  chick: "Gallus gallus",
  "gallus gallus": "Gallus gallus",
  worm: "Caenorhabditis elegans",
  nematode: "Caenorhabditis elegans",
  "c. elegans": "Caenorhabditis elegans",
  "c elegans": "Caenorhabditis elegans",
  "caenorhabditis elegans": "Caenorhabditis elegans",
  frog: "Xenopus laevis",
  xenopus: "Xenopus laevis",
  "xenopus laevis": "Xenopus laevis",
  "xenopus tropicalis": "Xenopus tropicalis",
  dog: "Canis lupus familiaris",
  canine: "Canis lupus familiaris",
  "canis lupus familiaris": "Canis lupus familiaris",
  "canis familiaris": "Canis lupus familiaris",
  cow: "Bos taurus",
  cattle: "Bos taurus",
  bovine: "Bos taurus",
  "bos taurus": "Bos taurus",
  sheep: "Ovis aries",
  ovine: "Ovis aries",
  "ovis aries": "Ovis aries",
  rabbit: "Oryctolagus cuniculus",
  "oryctolagus cuniculus": "Oryctolagus cuniculus",
  chimpanzee: "Pan troglodytes",
  chimp: "Pan troglodytes",
  "pan troglodytes": "Pan troglodytes",
  marmoset: "Callithrix jacchus",
  "callithrix jacchus": "Callithrix jacchus",
  arabidopsis: "Arabidopsis thaliana",
  "arabidopsis thaliana": "Arabidopsis thaliana",
  yeast: "Saccharomyces cerevisiae",
  "saccharomyces cerevisiae": "Saccharomyces cerevisiae",
  hamster: "Mesocricetus auratus",
  "mesocricetus auratus": "Mesocricetus auratus",
  "chinese hamster": "Cricetulus griseus",
  cho: "Cricetulus griseus",
  "cricetulus griseus": "Cricetulus griseus",
  medaka: "Oryzias latipes",
  "oryzias latipes": "Oryzias latipes",
  horse: "Equus caballus",
  equine: "Equus caballus",
  "equus caballus": "Equus caballus",
  goat: "Capra hircus",
  "capra hircus": "Capra hircus",
  "naked mole rat": "Heterocephalus glaber",
  "naked mole-rat": "Heterocephalus glaber",
  "heterocephalus glaber": "Heterocephalus glaber",
  killifish: "Nothobranchius furzeri",
  "nothobranchius furzeri": "Nothobranchius furzeri",
  lamprey: "Petromyzon marinus",
  "petromyzon marinus": "Petromyzon marinus",
  axolotl: "Ambystoma mexicanum",
  "ambystoma mexicanum": "Ambystoma mexicanum",
  ferret: "Mustela putorius furo",
  ferrets: "Mustela putorius furo",
  "mustela putorius furo": "Mustela putorius furo",
  cat: "Felis catus",
  feline: "Felis catus",
  "felis catus": "Felis catus",
  "guinea pig": "Cavia porcellus",
  "cavia porcellus": "Cavia porcellus",
  opossum: "Monodelphis domestica",
  "monodelphis domestica": "Monodelphis domestica",
  planarian: "Schmidtea mediterranea",
  "schmidtea mediterranea": "Schmidtea mediterranea",
  "sea urchin": "Strongylocentrotus purpuratus",
  rice: "Oryza sativa",
  maize: "Zea mays",
  corn: "Zea mays",
  hydra: "Hydra vulgaris",
  octopus: "Octopus bimaculoides"
};
function organismToScientific(term) {
  if (!term) return null;
  const t = term.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return null;
  const hit = ORGANISM_ALIASES[t];
  if (hit) return hit;
  const m = /^([a-z]+) ([a-z]+(?: [a-z]+)?)$/.exec(t);
  if (m && ORGANISM_COMMON[t]) return t.charAt(0).toUpperCase() + t.slice(1);
  if (m && m[1].length > 3) return t.charAt(0).toUpperCase() + t.slice(1);
  return null;
}

// functions/_shared/suspect-cells.ts
var PLATE_CELL_CEILING = 5e3;
var DROPLET_REVIEW_THRESHOLD = 2e4;
var AMBIENT_UMI_FLOOR = 500;
var HARD_IMPLAUSIBLE_CELLS = 2e5;
var PLATE_PROTOCOLS = [
  "smartseq",
  "smartseq2",
  "smartseq3",
  "smart-seq2",
  "smart-seq3",
  "plate",
  "plate_based",
  "seqwell",
  "microwell",
  "microwell-seq",
  "celseq",
  "celseq2",
  "icell8",
  "marsseq",
  "marsseq2",
  "quartzseq2"
];
var COMBINATORIAL_PROTOCOLS = [
  "scirna",
  "scirnaseq",
  "sci-rna-seq",
  "splitseq",
  "split-seq",
  "parse",
  "parse-biosciences"
];
var sqlList = (xs) => xs.map((p) => `'${p}'`).join(", ");
var PLATE_SQL = `lower(coalesce(protocol, '')) IN (${sqlList(PLATE_PROTOCOLS)})`;
var COMBI_SQL = `lower(coalesce(protocol, '')) IN (${sqlList(COMBINATORIAL_PROTOCOLS)})`;
var SUSPECT_CELLS_SQL = `(
  (${PLATE_SQL} AND coalesce(n_cells, 0) > ${PLATE_CELL_CEILING})
  OR (coalesce(n_cells, 0) > ${DROPLET_REVIEW_THRESHOLD}
      AND median_umis IS NOT NULL AND median_umis < ${AMBIENT_UMI_FLOOR})
  OR (coalesce(n_cells, 0) > ${HARD_IMPLAUSIBLE_CELLS}
      AND NOT (${COMBI_SQL} AND coalesce(median_umis, 0) >= ${AMBIENT_UMI_FLOOR}))
)`;
var UNVERIFIED_CELLS_SQL = `(
  NOT ${SUSPECT_CELLS_SQL}
  AND coalesce(n_cells, 0) > ${DROPLET_REVIEW_THRESHOLD}
  AND median_umis IS NULL
)`;
var COUNTABLE_CELLS_SQL = `(NOT ${SUSPECT_CELLS_SQL} AND NOT ${UNVERIFIED_CELLS_SQL})`;

// functions/_shared/search-core.ts
var CAP_CELLS_PER_SAMPLE = 25e4;
var CAPPED_STUDY_CELLS = `MIN(m.n_cells, ${CAP_CELLS_PER_SAMPLE} * MAX(m.n_done, 1))`;
var CONDITIONS_TTL_MS = 7 * 24 * 3600 * 1e3;
var RANK_GSE = "rank MATCH 'bm25(0.0, 10.0, 1.0, 0.0)'";
var RANK_GSM = "rank MATCH 'bm25(0.0, 0.0, 1.0, 3.0, 3.0, 5.0, 0.0, 3.0, 2.0)'";
var HITS_CTE = `
  fg AS (SELECT id AS gse_id, rank AS s FROM fts_gse WHERE fts_gse MATCH ? AND ${RANK_GSE}),
  fs AS (SELECT gse_id, MIN(rank) AS s, COUNT(*) AS n
           FROM fts_gsm WHERE fts_gsm MATCH ? AND ${RANK_GSM}
          GROUP BY gse_id),
  hits AS (
    SELECT gse_id, MIN(s_gse) AS s_gse, MIN(s_gsm) AS s_gsm, MAX(n_match) AS n_match FROM (
      SELECT gse_id, s AS s_gse, NULL AS s_gsm, NULL AS n_match FROM fg
      UNION ALL
      SELECT gse_id, NULL, s, n FROM fs
    ) GROUP BY gse_id
  )`;

// functions/_shared/d1-limits.ts
var D1_MAX_COMPOUND_TERMS = 5;

// functions/_shared/facets-core.ts
var MAX_COMPOUND_TERMS = D1_MAX_COMPOUND_TERMS - 1;
var DAY_MS = 24 * 3600 * 1e3;

// functions/_shared/interpret.ts
var D1_CACHE_MAX_AGE_MS = 30 * 864e5;
var MAX_QUERY_CHARS = 500;
var MAX_TOKENS = 40;
var emptyInterpreted = () => ({
  organism: [],
  tissue_group: [],
  disease_group: [],
  assay_family: [],
  cell_type: [],
  min_cells: null,
  year_min: null,
  year_max: null,
  q: []
});
var ORGANISM_DENY = /* @__PURE__ */ new Set(["hs", "mm", "cho", "cat"]);
var TISSUE_SKIP = /* @__PURE__ */ new Set(["Tumor (site unspecified)", "Multiple / mixed", "Immune cells (sorted)", "Other"]);
var TISSUE_DISEASE_PATTERNS = /* @__PURE__ */ new Set([
  "glioma",
  "glioblastoma",
  "glioblatoma",
  "gbm",
  "medulloblastoma",
  "ependymoma",
  "schwannoma",
  "hnscc",
  "melanoma",
  "carcinoma",
  "leukemia",
  "leukaemia",
  "lymphoma",
  "sarcoma",
  "myeloma",
  "wound",
  "blister",
  "biopsy",
  "ascites"
]);
var TISSUE_PARSE_DENY = /* @__PURE__ */ new Set([
  ...TISSUE_DISEASE_PATTERNS,
  "neuron",
  "neural",
  "astrocyte",
  "oligodendro",
  "microglia",
  "glial",
  "melanocyte",
  "keratin",
  "adipocyte",
  "fibroblast",
  "myoblast",
  "satellite",
  "chondro",
  "osteo",
  "endotheli",
  "trophoblast",
  "oocyte",
  "sperm",
  "germ cell",
  "hair cell",
  "hspc",
  "cd34",
  "hematopoietic",
  "haematopoietic",
  "mononuclear",
  "leukocyte",
  "leucocyte",
  "plasma",
  "ganglion",
  "culture",
  "differentiated",
  "differentiation",
  "engineered",
  "car product",
  "car-t",
  "car t",
  "xenograft",
  "pdx",
  "cdx",
  "cell pellet",
  "head",
  "tail",
  "sigma",
  "all",
  "tissue",
  "mixed",
  "various",
  "multiple",
  "n.a"
]);
var WHOLE_WORD_TISSUE = /* @__PURE__ */ new Set(["colon", "sinus", "plant", "joint", "crypt", "lens", "root", "shoot"]);
var NO_WHOLE_WORD = /* @__PURE__ */ new Set();
var DISEASE_SKIP = /* @__PURE__ */ new Set(["Other / unspecified"]);
var HEALTHY_OK = /* @__PURE__ */ new Set(["healthy", "healthy donor", "healthy control", "healthy controls", "non-diseased", "no disease", "non-disease"]);
var DISEASE_DENY = /* @__PURE__ */ new Set([
  "no",
  "na",
  "n",
  "n/a",
  "none",
  "ct",
  "hc",
  "nc",
  "ctrl",
  "wt",
  "naive",
  "normal",
  "normal control",
  "control",
  "controls",
  "vehicle",
  "sham",
  "untreated",
  "uninfected",
  "uninfected control",
  "benign",
  "asymptomatic",
  "wild type",
  "wildtype",
  "wild-type",
  "mm",
  "load",
  "psc",
  "ssc",
  "amd",
  "anca",
  "aged",
  "aging",
  "ageing",
  "old",
  "elderly",
  "recipient",
  "knockout",
  "knock-out",
  "transgenic",
  "mutant",
  "mutation",
  "carrier",
  "deficiency",
  "deficient",
  "ko",
  // Perturbations, conditions and life stages: keywords (KNOWN_KEYWORDS), never a disease.
  "stress",
  "stressed",
  "hypoxia",
  "hypoxic",
  "diet",
  "exercise",
  "fasting",
  "sleep",
  "circadian",
  "treatment",
  "treated",
  "stimulation",
  "stimulated",
  "lps",
  "drug",
  "drugs",
  "vaccin",
  "vaccine",
  "vaccination",
  "development",
  "developmental",
  "developing",
  "regeneration",
  "repair",
  "differentiation",
  "reprogramming",
  "perturbation",
  "crispr",
  "screen",
  "young",
  "juvenile",
  "adult",
  "neonatal",
  "fetal",
  "embryonic",
  "postnatal",
  "sex",
  "male",
  "female"
]);
var EXACT_DISEASE = /* @__PURE__ */ new Set(["COVID-19", "Alzheimer's disease", "Parkinson's disease", "Healthy / control"]);
var GENERIC_DISEASE_WORDS = /* @__PURE__ */ new Set([
  "cancer",
  "cancers",
  "tumor",
  "tumors",
  "tumour",
  "tumours",
  "carcinoma",
  "carcinomas",
  "malignancy",
  "malignancies",
  "malignant",
  "neoplasm",
  "neoplasms",
  "neoplasia",
  "neoplastic",
  "oncology",
  "oncologic",
  "infection",
  "infections",
  "infected",
  "infectious",
  "inflammation",
  "inflammatory",
  "autoimmune",
  "autoimmunity",
  "metabolic"
]);
var ASSAY_SKIP = /* @__PURE__ */ new Set(["10x (version unconfirmed)", "Unknown", "Not single-cell RNA"]);
var WHOLE_WORD_PROTOCOL = /* @__PURE__ */ new Set(["plate"]);
var KEYWORD_PHRASES = /* @__PURE__ */ new Set([
  "high fat diet",
  "high fat",
  "western diet",
  "cell cycle",
  "cell death",
  "cell fate",
  "cell state",
  "wild type",
  "knock out",
  "single nucleus",
  "single nuclei",
  "gene regulatory network"
]);
var CELL_TYPES = [
  "t cell",
  "b cell",
  "nk cell",
  "nkt cell",
  "cd4 t cell",
  "cd8 t cell",
  "regulatory t cell",
  "treg",
  "helper t cell",
  "cytotoxic t cell",
  "memory t cell",
  "naive t cell",
  "effector t cell",
  "exhausted t cell",
  "gamma delta t cell",
  "mait cell",
  "tfh cell",
  "th17 cell",
  "car t cell",
  "tumor infiltrating lymphocyte",
  "lymphocyte",
  "plasma cell",
  "memory b cell",
  "germinal center b cell",
  "plasmablast",
  "macrophage",
  "tumor associated macrophage",
  "monocyte",
  "dendritic cell",
  "plasmacytoid dendritic cell",
  "neutrophil",
  "eosinophil",
  "basophil",
  "mast cell",
  "innate lymphoid cell",
  "platelet",
  "megakaryocyte",
  "erythrocyte",
  "erythroid cell",
  "red blood cell",
  "immune cell",
  "myeloid cell",
  "hematopoietic stem cell",
  "hematopoietic progenitor",
  "progenitor cell",
  "stem cell",
  "mesenchymal stem cell",
  "embryonic stem cell",
  "microglia",
  "astrocyte",
  "oligodendrocyte",
  "oligodendrocyte precursor cell",
  "neuron",
  "interneuron",
  "excitatory neuron",
  "inhibitory neuron",
  "motor neuron",
  "dopaminergic neuron",
  "sensory neuron",
  "radial glia",
  "neural progenitor",
  "neural stem cell",
  "schwann cell",
  "ependymal cell",
  "pericyte",
  "endothelial cell",
  "smooth muscle cell",
  "fibroblast",
  "cancer associated fibroblast",
  "myofibroblast",
  "cardiomyocyte",
  "hepatocyte",
  "cholangiocyte",
  "kupffer cell",
  "hepatic stellate cell",
  "stellate cell",
  "epithelial cell",
  "keratinocyte",
  "melanocyte",
  "adipocyte",
  "preadipocyte",
  "chondrocyte",
  "osteoblast",
  "osteoclast",
  "myoblast",
  "satellite cell",
  "muscle stem cell",
  "podocyte",
  "beta cell",
  "alpha cell",
  "acinar cell",
  "ductal cell",
  "islet cell",
  "enterocyte",
  "goblet cell",
  "paneth cell",
  "tuft cell",
  "enteroendocrine cell",
  "intestinal stem cell",
  "at1 cell",
  "at2 cell",
  "alveolar epithelial cell",
  "club cell",
  "ciliated cell",
  "basal cell",
  "secretory cell",
  "trophoblast",
  "oocyte",
  "spermatocyte",
  "spermatogonia",
  "sertoli cell",
  "leydig cell",
  "granulosa cell",
  "germ cell",
  "hair cell",
  "retinal ganglion cell",
  "photoreceptor",
  "muller glia"
];
var CELL_NOISE = /* @__PURE__ */ new Set([
  "cell",
  "single cell",
  "whole cell",
  "total cell",
  "live cell",
  "living cell",
  "all cell",
  "mixed cell",
  "sorted cell",
  "unsorted cell",
  "cancer cell",
  "tumor cell",
  "tumour cell",
  "bulk cell",
  "primary cell",
  "cultured cell",
  "dissociated cell",
  "viable cell",
  "na cell",
  "other cell",
  "unknown cell",
  "blood cell"
]);
var CELL_HEAD_RE = /(cell|cyte|blast|phage|glia|neuron|progenitor|treg|pericyte|photoreceptor|platelet|neutrophil|eosinophil|basophil|spermatogonia|spermatid|myotube|myofiber)$/;
var NO_SINGULAR = /* @__PURE__ */ new Set(["microglia", "glia", "nuclei", "bacteria", "villi", "status", "virus", "corpus", "plus", "spermatogonia"]);
var STOPWORDS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "the",
  "of",
  "in",
  "on",
  "at",
  "for",
  "to",
  "from",
  "with",
  "and",
  "or",
  "by",
  "is",
  "are",
  "was",
  "were",
  "be",
  "as",
  "that",
  "this",
  "these",
  "those",
  "into",
  "its",
  "their",
  "using",
  "via",
  "vs",
  "versus",
  "about",
  "over",
  "under",
  "after",
  "before",
  "during",
  "between",
  "within",
  "without",
  "show",
  "find",
  "me",
  "all",
  "any",
  "some",
  "studies",
  "study",
  "datasets",
  "dataset",
  "data",
  "i",
  "we",
  "my",
  "our",
  "it",
  "which",
  "what",
  "where",
  "when",
  "how",
  "who",
  "does",
  "do",
  "did",
  "can",
  "could",
  "would",
  "should",
  "there",
  "here",
  "have",
  "has",
  "had",
  "not",
  "but",
  "than",
  "then",
  "also",
  "such",
  "like",
  "please",
  "want",
  "need",
  "looking",
  "look",
  "search",
  "list",
  "give",
  "get",
  "related",
  "relating",
  "involving",
  "based",
  "derived",
  "different",
  "various",
  "several",
  "many",
  "much",
  "more",
  "most",
  "other",
  "new",
  "recent",
  "latest",
  "compared",
  "comparing",
  "comparison",
  "etc",
  "best",
  "good",
  "top",
  "available",
  "studying",
  "investigating",
  "examining",
  "exploring",
  "understanding",
  "role",
  "roles",
  "effect",
  "effects",
  "impact"
]);
var GENERIC_WORDS = /* @__PURE__ */ new Set([
  "cell",
  "cells",
  "single",
  "single-cell",
  "singlecell",
  "sc",
  "scrna",
  "scrna-seq",
  "scrnaseq",
  "sc-rna-seq",
  "rna",
  "rna-seq",
  "rnaseq",
  "seq",
  "sequencing",
  "sequenced",
  "sample",
  "samples",
  "atlas",
  "atlases",
  "profiling",
  "profile",
  "profiles",
  "profiled",
  "transcriptome",
  "transcriptomes",
  "transcriptomic",
  "transcriptomics",
  "analysis",
  "analyses",
  "10x",
  "10x-genomics",
  "chromium",
  "droplet",
  "genomics",
  "gene",
  "genes",
  "expression",
  "disease",
  "diseases",
  "tissue",
  "tissues",
  "type",
  "types",
  "level",
  "levels",
  "cohort",
  "cohorts",
  "experiment",
  "experiments",
  "public",
  "geo",
  "model",
  "models",
  "thousand",
  "million",
  "v1",
  "v2",
  "v3",
  "v4"
]);
var KNOWN_KEYWORDS = /* @__PURE__ */ new Set([
  "aging",
  "ageing",
  "aged",
  "old",
  "young",
  "elderly",
  "juvenile",
  "adult",
  "adults",
  "neonatal",
  "neonate",
  "newborn",
  "infant",
  "pediatric",
  "paediatric",
  "child",
  "children",
  "fetal",
  "embryonic",
  "postnatal",
  "knockout",
  "ko",
  "wildtype",
  "wt",
  "mutant",
  "transgenic",
  "deficient",
  "deficiency",
  "treatment",
  "treated",
  "untreated",
  "stimulation",
  "stimulated",
  "lps",
  "drug",
  "drugs",
  "vaccine",
  "vaccination",
  "exercise",
  "diet",
  "fasting",
  "sex",
  "male",
  "female",
  "circadian",
  "sleep",
  "stress",
  "hypoxia",
  "development",
  "developmental",
  "developing",
  "regeneration",
  "repair",
  "differentiation",
  "reprogramming",
  "perturbation",
  "crispr",
  "screen",
  "lineage",
  "tracing",
  "trajectory",
  "velocity",
  "chromatin",
  "splicing",
  "isoform",
  "tcr",
  "bcr",
  "clonotype",
  "clonal",
  "doublet",
  "ambient",
  "xenograft",
  "pdx",
  "metastasis",
  "progression",
  "resistance",
  "response",
  "responder",
  "responders",
  "immunotherapy",
  "chemotherapy",
  "radiation",
  "checkpoint",
  "healthy",
  "control",
  "controls",
  "normal",
  "injury",
  "transplant",
  "nuclei",
  "nucleus",
  "sorted",
  "organoid",
  "organoids",
  "primary",
  "human",
  "mouse"
]);
var TOKEN_RE = /[\p{L}\p{N}](?:[\p{L}\p{N}+'.\/-]*[\p{L}\p{N}+'])?/gu;
function prepare(q) {
  return q.slice(0, MAX_QUERY_CHARS).replace(/[‘’′´`]/g, "'").replace(/[‐-―−]/g, "-").replace(/(\p{L})'s\b/gu, "$1");
}
function tokenize(text) {
  const out = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    let raw = m[0];
    if (raw.endsWith("'") && !/\d'$/.test(raw)) raw = raw.replace(/'+$/, "");
    const key = raw.toLowerCase().replace(/\++$/, "");
    if (!key) continue;
    out.push({ raw, key, pos: out.length, used: false, tissueOk: false });
    if (out.length >= MAX_TOKENS) break;
  }
  return out;
}
function isUpper(raw) {
  return /\p{Lu}/u.test(raw) && raw === raw.toUpperCase();
}
function singular(w) {
  if (w === "cells") return "cell";
  if (NO_SINGULAR.has(w) || w.length <= 3) return w;
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (/(ss|us|is|as)$/.test(w)) return w;
  if (w.endsWith("s")) return w.slice(0, -1);
  return w;
}
function cellPhrase(words) {
  return words.flatMap((w) => w.toLowerCase().replace(/\+/g, "").split(/[\s-]+/)).filter(Boolean).map(singular).join(" ");
}
function scan(toks, maxN, available, visit) {
  for (let n = Math.min(maxN, toks.length); n >= 1; n--) {
    for (let i = 0; i + n <= toks.length; i++) {
      const span = toks.slice(i, i + n);
      if (span.every(available)) visit(span);
    }
  }
}
var free = (t) => !t.used;
function ruleMatches(r, span, wholeWord) {
  const p = r.pattern.trim();
  if (!p) return false;
  const pw = p.split(/\s+/);
  if (pw.length !== span.length) return false;
  const words = span.map((t) => t.key);
  if ((p.length <= 2 || p === "all") && !span.every((t) => isUpper(t.raw))) return false;
  if (r.match_type === "exact") return words.join(" ") === p;
  for (let i = 0; i < pw.length - 1; i++) if (words[i] !== pw[i]) return false;
  const last = words[words.length - 1];
  const plast = pw[pw.length - 1];
  if (plast.length <= 3 || wholeWord.has(plast)) {
    return last === plast || last === `${plast}s` || last === `${plast}es` || wholeWord.has(plast) && last === `${plast}ic`;
  }
  return last.startsWith(plast);
}
function protocolSuffixOk(pc, rest) {
  const m = /^(?:seq|er|ly)?(v?\d+(?:\.\d+)?)?('|p|prime)?$/.exec(rest);
  if (!m) return false;
  return !m[2] || Boolean(m[1]) || /\d$/.test(pc);
}
function protocolMatches(r, joined, compact) {
  const p = r.pattern.trim();
  if (!p) return false;
  const pc = p.replace(/[\s_-]+/g, "");
  if (r.match_type === "exact" || pc.length < 4 || WHOLE_WORD_PROTOCOL.has(pc)) return joined === p || compact === pc;
  return compact.startsWith(pc) && protocolSuffixOk(pc, compact.slice(pc.length));
}
function pushUnique(list, value) {
  if (!list.some((v) => v.toLowerCase() === value.toLowerCase())) list.push(value);
}
function uniqCi(values) {
  const out = [];
  for (const v of values) pushUnique(out, v);
  return out;
}
function speciesFor(phrase) {
  if (ORGANISM_DENY.has(phrase)) return null;
  const sci = organismToScientific(phrase);
  return sci && ORGANISM_COMMON[sci.toLowerCase()] ? sci : null;
}
function spanSpecies(span) {
  const phrase = span.map((t) => t.key).join(" ");
  const sci = speciesFor(phrase);
  if (sci) return sci;
  return span.length === 1 && phrase.length > 4 && phrase.endsWith("s") ? speciesFor(phrase.slice(0, -1)) : null;
}
function queryDiseaseRules(rules2) {
  return rules2.filter((r) => {
    const p = r.pattern.trim();
    if (r.field !== "disease" || !p || DISEASE_SKIP.has(r.grp)) return false;
    if (r.grp === "Healthy / control") return HEALTHY_OK.has(p);
    return !DISEASE_DENY.has(p);
  });
}
function diseaseFor(span, diseaseRules) {
  const phrase = span.map((t) => t.key).join(" ");
  const grp = canonicalGroup("disease_group", phrase) ?? diseaseRules.find((r) => ruleMatches(r, span, NO_WHOLE_WORD))?.grp ?? null;
  return grp && !DISEASE_SKIP.has(grp) ? grp : null;
}
function consumeDisease(span) {
  span.forEach((t, i) => {
    t.used = true;
    t.tissueOk = i < span.length - 1;
  });
}
function cellVocabulary(extra) {
  const set = new Set(CELL_TYPES);
  for (const v of extra) {
    const phrase = cellPhrase([v]);
    if (!phrase || phrase.length > 40 || phrase.split(" ").length > 4) continue;
    if (CELL_NOISE.has(phrase) || !CELL_HEAD_RE.test(phrase) || /^\d/.test(phrase)) continue;
    set.add(phrase);
  }
  for (const n of CELL_NOISE) set.delete(n);
  return set;
}
var NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)`;
var UNIT = String.raw`\s*(k|m|thousand|million)?`;
var CELLS = String.raw`(?:cells?|nuclei)\b`;
var MIN_CELLS_RES = [
  new RegExp(String.raw`(?:\bat\s+least|\bminimum(?:\s+of)?|\bmin\.?|\bmore\s+than|\bover|\babove|\bgreater\s+than|>=?|≥)\s*${NUM}${UNIT}\s*\+?\s*${CELLS}`, "i"),
  new RegExp(String.raw`\b${NUM}${UNIT}\s*\+\s*${CELLS}`, "i"),
  new RegExp(String.raw`\b${NUM}${UNIT}\s*${CELLS}\s+or\s+more\b`, "i")
];
var YEAR = String.raw`((?:19|20)\d{2})`;
var YEAR_RANGE_RE = new RegExp(String.raw`\b(?:between\s+|from\s+)?${YEAR}\s*(?:-|to|until|through|thru|and)\s*${YEAR}\b`, "i");
var YEAR_FROM_RE = new RegExp(String.raw`\b(since|after|from|starting(?:\s+in)?|post)\s+${YEAR}\b`, "i");
var YEAR_TO_RE = new RegExp(String.raw`\b(before|until|till|through|thru|up\s+to|prior\s+to|pre)\s+${YEAR}\b`, "i");
var YEAR_OPEN_RE = new RegExp(String.raw`\b${YEAR}\s*(\+|or\s+later|and\s+later|onwards?|or\s+newer|or\s+earlier|and\s+earlier|or\s+before)`, "i");
var YEAR_IN_RE = new RegExp(String.raw`\b(?:published\s+)?in\s+${YEAR}\b`, "i");
var LAST_YEARS_RE = /\b(?:last|past)\s+(\d{1,2})\s+years?\b/i;
function countValue(num, unit) {
  const n = parseFloat(num.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = (unit ?? "").toLowerCase();
  const mult = u === "k" || u === "thousand" ? 1e3 : u === "m" || u === "million" ? 1e6 : 1;
  const v = Math.round(n * mult);
  return v >= 1 && v <= 1e9 ? v : null;
}
function blank(text, m) {
  return text.slice(0, m.index) + " ".repeat(m[0].length) + text.slice(m.index + m[0].length);
}
function takeNumbers(input, nowYear) {
  const out = { text: input, min_cells: null, year_min: null, year_max: null };
  const okYear = (y) => y >= 1990 && y <= nowYear + 1;
  for (const re of MIN_CELLS_RES) {
    const m2 = re.exec(out.text);
    const v = m2 ? countValue(m2[1], m2[2]) : null;
    if (m2 && v != null) {
      out.min_cells = v;
      out.text = blank(out.text, m2);
      break;
    }
  }
  let m = YEAR_RANGE_RE.exec(out.text);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (okYear(a) && okYear(b)) {
      out.year_min = Math.min(a, b);
      out.year_max = Math.max(a, b);
      out.text = blank(out.text, m);
    }
  }
  if (out.year_min == null) {
    m = YEAR_FROM_RE.exec(out.text);
    if (m) {
      const y = Number(m[2]);
      const word = m[1].toLowerCase();
      if (okYear(y)) {
        out.year_min = word === "after" || word === "post" ? y + 1 : y;
        out.text = blank(out.text, m);
      }
    }
  }
  if (out.year_max == null) {
    m = YEAR_TO_RE.exec(out.text);
    if (m) {
      const y = Number(m[2]);
      const word = m[1].toLowerCase();
      if (okYear(y)) {
        out.year_max = word === "before" || word === "pre" || word.startsWith("prior") ? y - 1 : y;
        out.text = blank(out.text, m);
      }
    }
  }
  if (out.year_min == null && out.year_max == null) {
    m = YEAR_OPEN_RE.exec(out.text);
    if (m && okYear(Number(m[1]))) {
      const y = Number(m[1]);
      if (/earlier|before/i.test(m[2])) out.year_max = y;
      else out.year_min = y;
      out.text = blank(out.text, m);
    }
  }
  if (out.year_min == null && out.year_max == null) {
    m = YEAR_IN_RE.exec(out.text);
    if (m && okYear(Number(m[1]))) {
      out.year_min = Number(m[1]);
      out.year_max = Number(m[1]);
      out.text = blank(out.text, m);
    }
  }
  if (out.year_min == null) {
    m = LAST_YEARS_RE.exec(out.text);
    const n = m ? Number(m[1]) : 0;
    if (m && n >= 1 && n <= 30) {
      out.year_min = nowYear - n + 1;
      out.text = blank(out.text, m);
    }
  }
  if (out.year_min != null && out.year_max != null && out.year_min > out.year_max) {
    out.year_min = null;
    out.year_max = null;
  }
  return out;
}
function isSimpleKeyword(raw, key) {
  return /\d/.test(raw) || raw.includes("-") || /^\p{Lu}[\p{Lu}\d]{1,9}$/u.test(raw) || KNOWN_KEYWORDS.has(key) || key.length <= 2;
}
function parseQuery(query, vocab, nowYear = (/* @__PURE__ */ new Date()).getUTCFullYear()) {
  const res = emptyInterpreted();
  const nums = takeNumbers(prepare(query), nowYear);
  res.min_cells = nums.min_cells;
  res.year_min = nums.year_min;
  res.year_max = nums.year_max;
  const toks = tokenize(nums.text);
  const echoes = [];
  const echo = (span) => echoes.push({ pos: span[0].pos, text: span.map((t) => t.raw).join(" ") });
  const consume2 = (span) => {
    for (const t of span) {
      t.used = true;
      t.tissueOk = false;
    }
  };
  scan(toks, 3, free, (span) => {
    if (span.length < 2) return;
    if (KEYWORD_PHRASES.has(span.map((t) => t.key).join(" ")) || KEYWORD_PHRASES.has(cellPhrase(span.map((t) => t.key)))) {
      echo(span);
      consume2(span);
    }
  });
  scan(toks, 3, free, (span) => {
    const sci = spanSpecies(span);
    if (!sci) return;
    pushUnique(res.organism, sci);
    consume2(span);
  });
  const chem = (span) => {
    const k = span.map((t) => t.key);
    const one = k.length === 1 ? /^([35])(?:'|p|prime|-prime)$/.exec(k[0]) : null;
    if (one) return one[1] === "3" ? "3" : "5";
    if (k.length === 2 && (k[0] === "3" || k[0] === "5") && k[1] === "prime") return k[0] === "3" ? "3" : "5";
    return null;
  };
  scan(toks, 2, free, (span) => {
    const c = chem(span);
    if (!c) return;
    pushUnique(res.assay_family, c === "3" ? "10x 3'" : "10x 5'");
    consume2(span);
    for (const t of toks) if (!t.used && (t.key === "10x" || t.key === "chromium")) consume2([t]);
  });
  const protocolRules = vocab.rules.filter((r) => r.field === "protocol" && !ASSAY_SKIP.has(r.grp));
  scan(toks, 3, free, (span) => {
    const joined = span.map((t) => t.key).join(" ");
    const compact = joined.replace(/[\s_-]+/g, "");
    let grp = canonicalGroup("assay_family", joined);
    if (!grp) grp = protocolRules.find((r) => protocolMatches(r, joined, compact))?.grp ?? null;
    if (!grp || ASSAY_SKIP.has(grp)) return;
    pushUnique(res.assay_family, grp);
    consume2(span);
  });
  const cells = cellVocabulary(vocab.cellTypes ?? []);
  scan(toks, 4, free, (span) => {
    const phrase = cellPhrase(span.map((t) => t.key));
    if (!phrase || CELL_NOISE.has(phrase) || !cells.has(phrase)) return;
    pushUnique(res.cell_type, phrase);
    span.forEach((t, i) => {
      t.used = true;
      t.tissueOk = i < span.length - 1;
    });
  });
  const diseaseRules = queryDiseaseRules(vocab.rules);
  scan(toks, 4, free, (span) => {
    const grp = diseaseFor(span, diseaseRules);
    if (!grp) return;
    pushUnique(res.disease_group, grp);
    if (!EXACT_DISEASE.has(grp) && !(span.length === 1 && GENERIC_DISEASE_WORDS.has(span[0].key))) echo(span);
    consumeDisease(span);
  });
  const tissueRules = vocab.rules.filter((r) => r.field === "tissue" && !TISSUE_SKIP.has(r.grp) && !TISSUE_PARSE_DENY.has(r.pattern.trim()));
  scan(toks, 4, (t) => !t.used || t.tissueOk, (span) => {
    const phrase = span.map((t) => t.key).join(" ");
    let grp = canonicalGroup("tissue_group", phrase);
    if (!grp) grp = tissueRules.find((r) => ruleMatches(r, span, WHOLE_WORD_TISSUE))?.grp ?? null;
    if (!grp || TISSUE_SKIP.has(grp)) return;
    pushUnique(res.tissue_group, grp);
    consume2(span);
  });
  const leftovers = toks.filter(
    (t) => !t.used && !STOPWORDS.has(t.key) && !GENERIC_WORDS.has(t.key) && !/^\d+(?:[.,]\d+)?[km]?$/.test(t.key)
  );
  const ordered = [...echoes, ...leftovers.map((t) => ({ pos: t.pos, text: t.raw }))].sort((a, b) => a.pos - b.pos);
  res.q = uniqCi(ordered.map((e) => e.text));
  const unplaced = leftovers.filter((t) => !isSimpleKeyword(t.raw, t.key)).map((t) => t.raw);
  const keep = uniqCi([...echoes.map((e) => e.text), ...leftovers.filter((t) => isSimpleKeyword(t.raw, t.key)).map((t) => t.raw)]);
  const structured = res.organism.length > 0 || res.tissue_group.length > 0 || res.disease_group.length > 0 || res.assay_family.length > 0 || res.cell_type.length > 0 || res.min_cells != null || res.year_min != null || res.year_max != null;
  const content = toks.filter((t) => !STOPWORDS.has(t.key) && !GENERIC_WORDS.has(t.key)).length;
  const ambiguous = unplaced.length >= 3 || unplaced.length >= 2 && !structured && content >= 3;
  return { interpreted: res, keep, unplaced, ambiguous };
}
var stringArray = { type: "array", items: { type: "string" } };
var enumArray = (values) => ({ type: "array", items: { type: "string", enum: [...values] } });
var INTERPRET_SCHEMA = {
  type: "object",
  properties: {
    organism: stringArray,
    tissue_group: enumArray(TISSUE_GROUPS),
    disease_group: enumArray(DISEASE_GROUPS),
    assay_family: enumArray(ASSAY_FAMILIES),
    cell_type: stringArray,
    min_cells: { type: "integer" },
    year_min: { type: "integer" },
    year_max: { type: "integer" },
    q: stringArray
  },
  required: ["organism", "tissue_group", "disease_group", "assay_family", "cell_type", "min_cells", "year_min", "year_max", "q"],
  additionalProperties: false
};
var CELL_COUNT_HINT_RE = new RegExp(
  String.raw`\b${NUM}${UNIT}\s*\+?(?:\s+[a-z]+)?[\s-]*(?:cells?|nuclei)\b(?![\s-]*(?:types?|lines?|states?)\b)|\b(?:cells|nuclei)\s*(?:>=?|≥|:)\s*\d`,
  "i"
);

// scripts/search-eval/parser-only.ts
var rules = JSON.parse(readFileSync(new URL("./.rules.json", import.meta.url), "utf8"));
var golden = JSON.parse(readFileSync(new URL("./golden-nl.json", import.meta.url), "utf8"));
for (const g of golden) {
  const p = parseQuery(String(g.query), { rules, cellTypes: [] });
  console.log(JSON.stringify({ query: g.query, ambiguous: p.ambiguous, unplaced: p.unplaced, got: p.interpreted, want: { o: g.organism, t: g.tissue_group, d: g.disease_group, a: g.assay_family, c: g.cell_type, q: g.q } }));
}

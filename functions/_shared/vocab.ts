/**
 * Controlled vocabulary for the catalog.
 *
 * - Canonical group lists (tissue_group / disease_group / assay_family) — the
 *   values stored in `gsm.tissue_group|disease_group|assay_family` and in the
 *   `gse_meta` JSON arrays. The UI never hard-codes these; it reads them from
 *   /api/facets, which is built on this module.
 * - `vocab_rules` loader + `toGroup()` — the same synonym rules (and the same
 *   semantics) that produced the normalized columns in D1, so free text coming
 *   from a user or a model can be mapped to a canonical group in code.
 * - Organism alias → scientific name, and scientific → common name for display.
 */

export type RuleField = "tissue" | "disease" | "protocol";

export const TISSUE_GROUPS = [
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
  "Other",
] as const;

export const DISEASE_GROUPS = [
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
  "Other / unspecified",
] as const;

export const ASSAY_FAMILIES = [
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
  "Unknown",
] as const;

export type TissueGroup = (typeof TISSUE_GROUPS)[number];
export type DiseaseGroup = (typeof DISEASE_GROUPS)[number];
export type AssayFamily = (typeof ASSAY_FAMILIES)[number];

/** Assay families whose per-sample cell counts are known to be unreliable (one well = one "cell"). */
export const PLATE_ASSAY_FAMILIES: readonly string[] = ["Smart-seq / plate-based", "Seq-Well / Microwell"];

const CANON = {
  tissue_group: new Map(TISSUE_GROUPS.map((g) => [g.toLowerCase(), g])),
  disease_group: new Map(DISEASE_GROUPS.map((g) => [g.toLowerCase(), g])),
  assay_family: new Map(ASSAY_FAMILIES.map((g) => [g.toLowerCase(), g])),
};

export type GroupField = keyof typeof CANON;

/** Exact (case-insensitive) canonical group lookup. */
export function canonicalGroup(field: GroupField, value: string): string | null {
  return CANON[field].get(value.trim().toLowerCase()) ?? null;
}

// ── vocab_rules ─────────────────────────────────────────────────────────────

export interface VocabRule {
  field: RuleField;
  priority: number;
  grp: string;
  match_type: "exact" | "contains";
  pattern: string;
}

interface RuleCache {
  rules: VocabRule[];
  loadedAt: number;
}

const RULES_TTL_MS = 60 * 60 * 1000;
const RULES_CACHE_URL = "https://singlet.bio/__internal/vocab_rules";
let isolateRules: RuleCache | null = null;

function edgeCache(): Cache | null {
  try {
    return (caches as unknown as { default?: Cache }).default ?? null;
  } catch {
    return null;
  }
}

/**
 * Load `vocab_rules`, cached per isolate (1h) and in the Cache API (1h) so D1
 * is touched roughly once an hour per colo.
 */
export async function loadRules(
  db: D1Database,
  waitUntil?: (p: Promise<unknown>) => void
): Promise<VocabRule[]> {
  const now = Date.now();
  if (isolateRules && now - isolateRules.loadedAt < RULES_TTL_MS) return isolateRules.rules;

  const cache = edgeCache();
  if (cache) {
    try {
      const hit = await cache.match(RULES_CACHE_URL);
      if (hit) {
        const rules = (await hit.json()) as VocabRule[];
        isolateRules = { rules, loadedAt: now };
        return rules;
      }
    } catch {
      /* fall through to D1 */
    }
  }

  const res = await db
    .prepare(
      `SELECT field, priority, grp, match_type, pattern
         FROM vocab_rules
        ORDER BY field, priority ASC, rowid ASC`
    )
    .all<VocabRule>();
  const rules = res.results.map((r) => ({
    field: r.field,
    priority: Number(r.priority),
    grp: String(r.grp),
    match_type: r.match_type === "exact" ? "exact" : "contains",
    pattern: String(r.pattern ?? "").toLowerCase(),
  })) as VocabRule[];

  isolateRules = { rules, loadedAt: now };
  if (cache) {
    const put = cache.put(
      RULES_CACHE_URL,
      new Response(JSON.stringify(rules), {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
      })
    );
    if (waitUntil) waitUntil(put.catch(() => undefined));
    else put.catch(() => undefined);
  }
  return rules;
}

/**
 * Map a raw value to its canonical group using the same semantics as the SQL
 * that populated the normalized columns: first matching rule by priority;
 * `exact` compares the lowercased, trimmed value; `contains` is a substring test
 * (LIKE '%pattern%').
 */
export function toGroup(rules: VocabRule[], field: RuleField, raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const v = String(raw).trim().toLowerCase();
  if (!v) return null;
  for (const r of rules) {
    if (r.field !== field) continue;
    if (r.match_type === "exact" ? v === r.pattern : v.includes(r.pattern)) return r.grp;
  }
  return null;
}

/** Field on `vocab_rules` that backs each canonical group field. */
export const GROUP_RULE_FIELD: Record<GroupField, RuleField> = {
  tissue_group: "tissue",
  disease_group: "disease",
  assay_family: "protocol",
};

/**
 * Resolve any user/model-supplied string for a group field: canonical name
 * first, then the synonym rules. Returns null when nothing applies.
 */
export function resolveGroup(rules: VocabRule[], field: GroupField, value: string): string | null {
  return canonicalGroup(field, value) ?? toGroup(rules, GROUP_RULE_FIELD[field], value);
}

// ── Organisms ───────────────────────────────────────────────────────────────

/** Scientific → common name (display only). */
export const ORGANISM_COMMON: Record<string, string> = {
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
  "synthetic construct": "Synthetic construct",
};

/** Common names, abbreviations and adjectives → scientific name. */
const ORGANISM_ALIASES: Record<string, string> = {
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
  octopus: "Octopus bimaculoides",
};

/**
 * Map a common name, adjective, abbreviation or scientific name to the
 * scientific name used in `organism_primary` / `gse_meta.organisms`.
 * Unknown "Genus species" strings are returned capitalised; anything else null.
 */
export function organismToScientific(term: string | null | undefined): string | null {
  if (!term) return null;
  const t = term.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return null;
  const hit = ORGANISM_ALIASES[t];
  if (hit) return hit;
  // "Genus species" (two latin words) — capitalise the genus.
  const m = /^([a-z]+) ([a-z]+(?: [a-z]+)?)$/.exec(t);
  if (m && ORGANISM_COMMON[t]) return t.charAt(0).toUpperCase() + t.slice(1);
  if (m && m[1].length > 3) return t.charAt(0).toUpperCase() + t.slice(1);
  return null;
}

/** Scientific → common display name. Composite values ("A; B") map part by part. */
export function organismToCommon(sci: string | null | undefined): string {
  if (!sci) return "Unknown";
  return sci
    .split(";")
    .map((p) => {
      const t = p.trim();
      return ORGANISM_COMMON[t.toLowerCase()] ?? t;
    })
    .join("; ");
}

/** Common names offered to the query interpreter as its organism vocabulary. */
export function organismVocabForModel(): string[] {
  return Object.entries(ORGANISM_COMMON).map(([sci, common]) => {
    const s = sci.charAt(0).toUpperCase() + sci.slice(1);
    return `${common} (${s})`;
  });
}

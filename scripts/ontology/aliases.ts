/**
 * Curated aliases: values GEO submitters write often that the ontologies do not list as a label or synonym.
 * Each entry names the source attribute, the normalised values (normLabel form) and one term. Only entries whose
 * reading does not depend on the study: an abbreviation with two common readings ("AD": Alzheimer's disease or
 * atopic dermatitis) is not here and goes to the model pass with the study title.
 */
export interface Alias {
  attr: string;
  values: string[];
  term: string;
  /** The term's primary label, checked by build.ts so a mistyped id fails the build. */
  label: string;
  note: string;
  confidence?: number;
}

export const ALIASES: Alias[] = [
  // tissue -> UBERON
  { attr: "tissue", values: ["pbmc", "pbmcs", "peripheral blood mononuclear cells", "peripheral blood mononuclear cell", "pbmc sample"], term: "UBERON:0000178", label: "blood", note: "PBMCs are isolated from blood" },
  { attr: "tissue", values: ["whole blood", "peripheral whole blood", "venous blood"], term: "UBERON:0000178", label: "blood", note: "blood" },
  { attr: "tissue", values: ["csf"], term: "UBERON:0001359", label: "cerebrospinal fluid", note: "cerebrospinal fluid" },
  { attr: "tissue", values: ["bone marrow aspirate", "bm aspirate", "bm", "bone marrow aspirates"], term: "UBERON:0002371", label: "bone marrow", note: "bone marrow" },
  { attr: "tissue", values: ["cardiac", "cardiac tissue", "heart tissue"], term: "UBERON:0000948", label: "heart", note: "heart" },
  { attr: "tissue", values: ["gut"], term: "UBERON:0001555", label: "digestive tract", note: "digestive tract", confidence: 0.8 },
  { attr: "tissue", values: ["islet", "islets", "pancreatic islets", "human islets", "islets of langerhans"], term: "UBERON:0000006", label: "islet of Langerhans", note: "islet of Langerhans" },
  { attr: "tissue", values: ["pfc"], term: "UBERON:0000451", label: "prefrontal cortex", note: "prefrontal cortex" },

  { attr: "tissue", values: ["skeletal muscle", "skeletal muscles", "muscle biopsy", "skeletal muscle biopsy"], term: "UBERON:0001134", label: "skeletal muscle tissue", note: "skeletal muscle" },

  { attr: "tissue", values: ["peripheral blood", "human peripheral blood", "peripheral venous blood", "pb"], term: "UBERON:0000178", label: "blood", note: "peripheral blood is not a separate UBERON term" },
  { attr: "tissue", values: ["hippocampus", "hippocampi", "human hippocampus", "mouse hippocampus", "hippocampal"], term: "UBERON:0002421", label: "hippocampal formation", note: "hippocampus (the formation, as CELLxGENE uses it)" },
  { attr: "tissue", values: ["terminal ileum", "distal ileum"], term: "UBERON:0002116", label: "ileum", note: "the terminal ileum is part of the ileum", confidence: 0.85 },

  // cell_type_sorted -> CL
  { attr: "cell_type_sorted", values: ["pbmc", "pbmcs", "peripheral blood mononuclear cells", "peripheral blood mononuclear cells pbmcs", "peripheral blood mono nuclear cells", "human blood mononuclear cells", "pbmc cells"], term: "CL:2000001", label: "peripheral blood mononuclear cell", note: "peripheral blood mononuclear cell" },
  { attr: "cell_type_sorted", values: ["bmmc", "bmmcs", "bmmnc", "bmmncs", "bone marrow mononuclear cells"], term: "CL:0010004", label: "mononuclear cell of bone marrow", note: "mononuclear cell of bone marrow" },
  { attr: "cell_type_sorted", values: ["cd8", "cd8 cells", "cd8 positive", "cd8 positive cells", "cd8 t", "cd8 positive t cells", "cd8 tcells"], term: "CL:0000625", label: "CD8-positive, alpha-beta T cell", note: "CD8+ (sorted) T cells", confidence: 0.85 },
  { attr: "cell_type_sorted", values: ["cd4", "cd4 cells", "cd4 positive", "cd4 positive cells", "cd4 t", "cd4 positive t cells", "cd4 tcells"], term: "CL:0000624", label: "CD4-positive, alpha-beta T cell", note: "CD4+ (sorted) T cells", confidence: 0.85 },
  { attr: "cell_type_sorted", values: ["cd3", "cd3 positive", "cd3 cells", "cd3 positive cells", "tcells", "t lymphocytes", "t lymphocyte"], term: "CL:0000084", label: "T cell", note: "CD3+ cells are T cells", confidence: 0.85 },
  { attr: "cell_type_sorted", values: ["mait", "mait cells", "mait cell"], term: "CL:0000940", label: "mucosal-associated invariant T cell", note: "MAIT" },
  { attr: "cell_type_sorted", values: ["immune cell", "immune cells", "cd45 leukocytes", "cd45 cells", "cd45 positive cells", "cd45"], term: "CL:0000738", label: "leukocyte", note: "leukocyte (CD45+)" , confidence: 0.85 },
  { attr: "cell_type_sorted", values: ["hspc", "hspcs", "primary hspcs", "cd34 hspcs"], term: "CL:0008001", label: "hematopoietic precursor cell", note: "hematopoietic precursor cell", confidence: 0.85 },
  { attr: "cell_type_sorted", values: ["car t cells", "car t cell", "car t", "manufactured car t cells"], term: "CL:0000084", label: "T cell", note: "CAR T cells are T cells", confidence: 0.85 },
  { attr: "cell_type_sorted", values: ["ipsc", "ipscs", "hipsc", "hipscs"], term: "CL:0002248", label: "pluripotent stem cell", note: "pluripotent stem cell (induced)", confidence: 0.85 },

  // disease -> MONDO, PATO normal
  { attr: "disease", values: ["healthy", "normal", "healthy control", "healthy controls", "healthy donor", "healthy donors", "control healthy", "none", "no disease", "hc", "hd", "healthy volunteer", "healthy individual"], term: "PATO:0000461", label: "normal", note: "no disease stated: PATO normal" },
  { attr: "disease", values: ["nsclc", "non small cell lung cancer", "non small cell lung carcinoma"], term: "MONDO:0005233", label: "non-small cell lung carcinoma", note: "non-small cell lung carcinoma" },
  { attr: "disease", values: ["aml"], term: "MONDO:0018874", label: "acute myeloid leukemia", note: "acute myeloid leukemia" },
  { attr: "disease", values: ["copd"], term: "MONDO:0005002", label: "chronic obstructive pulmonary disease", note: "chronic obstructive pulmonary disease" },
  { attr: "disease", values: ["ipf"], term: "MONDO:0800504", label: "idiopathic pulmonary fibrosis", note: "idiopathic pulmonary fibrosis" },
  { attr: "disease", values: ["covid", "covid 19", "sars cov 2", "sars cov 2 infection", "covid19"], term: "MONDO:0100096", label: "COVID-19", note: "COVID-19" },
  { attr: "disease", values: ["uc"], term: "MONDO:0005101", label: "ulcerative colitis", note: "ulcerative colitis", confidence: 0.8 },
  { attr: "disease", values: ["pdac"], term: "MONDO:0005184", label: "pancreatic ductal adenocarcinoma", note: "pancreatic ductal adenocarcinoma" },
  { attr: "disease", values: ["hgsoc"], term: "MONDO:0005211", label: "ovarian serous adenocarcinoma", note: "ovarian serous adenocarcinoma (high grade is not a separate term)", confidence: 0.85 },
  { attr: "disease", values: ["t1d"], term: "MONDO:0005147", label: "type 1 diabetes mellitus", note: "type 1 diabetes mellitus" },
  { attr: "disease", values: ["t2d"], term: "MONDO:0005148", label: "type 2 diabetes mellitus", note: "type 2 diabetes mellitus" },
  { attr: "disease", values: ["hiv", "hiv infected", "hiv infection", "hiv positive"], term: "MONDO:0005109", label: "HIV infectious disease", note: "HIV infectious disease" },
  { attr: "disease", values: ["b all"], term: "MONDO:0004947", label: "B-cell acute lymphoblastic leukemia", note: "B-cell acute lymphoblastic leukemia" },
  { attr: "disease", values: ["cll"], term: "MONDO:0004948", label: "B-cell chronic lymphocytic leukemia", note: "B-cell chronic lymphocytic leukemia" },
  { attr: "disease", values: ["sle"], term: "MONDO:0007915", label: "systemic lupus erythematosus", note: "systemic lupus erythematosus" },
  { attr: "disease", values: ["ra"], term: "MONDO:0008383", label: "rheumatoid arthritis", note: "rheumatoid arthritis", confidence: 0.8 },
  { attr: "disease", values: ["ms"], term: "MONDO:0005301", label: "multiple sclerosis", note: "multiple sclerosis", confidence: 0.8 },
  { attr: "disease", values: ["als"], term: "MONDO:0004976", label: "amyotrophic lateral sclerosis", note: "amyotrophic lateral sclerosis" },
  { attr: "disease", values: ["hcc"], term: "MONDO:0007256", label: "hepatocellular carcinoma", note: "hepatocellular carcinoma" },
  { attr: "disease", values: ["ccrcc"], term: "MONDO:0005005", label: "clear cell renal carcinoma", note: "clear cell renal carcinoma" },
  { attr: "disease", values: ["gbm"], term: "MONDO:0018177", label: "glioblastoma", note: "glioblastoma" },
  { attr: "disease", values: ["coeliac", "coeliac disease"], term: "MONDO:0005130", label: "celiac disease", note: "celiac disease" },

  // ancestry -> HANCESTRO (the US census categories GEO submitters use). Only children of HANCESTRO:0004 "ancestry
  // category", the terms the per-cell inferred ancestry uses, not the geography-based "Asian" (HANCESTRO:0847).
  { attr: "ancestry", values: ["asian", "asian american", "asian unspecified"], term: "HANCESTRO:0008", label: "Asian ancestry", note: "Asian ancestry" },
  { attr: "ancestry", values: ["german"], term: "HANCESTRO:0005", label: "European ancestry", note: "European ancestry", confidence: 0.85 },
  { attr: "ancestry", values: ["white", "caucasian", "caucacian", "casusasian", "white or caucasian", "white or caucasion", "white not hispanic or latino", "european", "european american"], term: "HANCESTRO:0005", label: "European ancestry", note: "European ancestry (\"white\", \"Caucasian\" are exact synonyms)" },
  { attr: "ancestry", values: ["black", "black or african american", "black african american", "black african american aa", "african american", "black not hispanic or latino", "america african", "aa"], term: "HANCESTRO:0016", label: "African American or Afro-Caribbean ancestry", note: "African American or Afro-Caribbean ancestry", confidence: 0.85 },
  { attr: "ancestry", values: ["afro carribean", "afro caribbean"], term: "HANCESTRO:0016", label: "African American or Afro-Caribbean ancestry", note: "African American or Afro-Caribbean ancestry" },
  { attr: "ancestry", values: ["hispanic or latin american", "hispanic or latino", "hispanic latino", "hispanic", "latino", "latina", "hispanic white", "white hispanic or latino"], term: "HANCESTRO:0014", label: "Latin or Admixed American ancestry", note: "Latin or Admixed American ancestry (Hispanic/Latino)", confidence: 0.8 },
  { attr: "ancestry", values: ["middle eastern north african", "middle eastern", "arab", "mena"], term: "HANCESTRO:0015", label: "Greater Middle Eastern (Middle Eastern or North African or Persian) ancestry", note: "Greater Middle Eastern ancestry" },
  { attr: "ancestry", values: ["native american", "native american alaska native", "american indian or alaska native", "american indian"], term: "HANCESTRO:0013", label: "Indigenous American ancestry", note: "Native American ancestry" },
  { attr: "ancestry", values: ["south east asian filipino", "filipino"], term: "HANCESTRO:0007", label: "South East Asian ancestry", note: "South East Asian ancestry" },
  { attr: "ancestry", values: ["indian"], term: "HANCESTRO:0006", label: "South Asian ancestry", note: "South Asian ancestry", confidence: 0.75 },

  // sex -> PATO
  { attr: "sex", values: ["mixed", "pooled", "both", "male and female", "female and male"], term: "PATO:0001338", label: "mixed sex", note: "mixed sex" },
];

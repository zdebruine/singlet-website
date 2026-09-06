/**
 * POST /functions/v1/interpret-search-query   (contract v2)
 *
 * Translates a natural-language single-cell catalog query into strict JSON
 * filters using a Gemini model through the Lovable AI Gateway (auto-provisioned
 * LOVABLE_API_KEY — no external provider key).
 *
 * Body:
 *   { version: 2, q: string,
 *     vocab?: { organism: string[], tissue_group: string[], disease_group: string[],
 *               assay_family: string[], cell_type: string[] } }
 *   `organism` entries look like "Mouse (Mus musculus)"; the model must answer
 *   with the scientific name. Group fields must be exact strings from the lists.
 *   If `vocab` is omitted, it is fetched from the public catalog facets.
 *
 * Reply:
 *   { interpreted: { organism: string[], tissue_group: string[], disease_group: string[],
 *                    assay_family: string[], cell_type: string[], min_cells: int|null,
 *                    year_min: int|null, year_max: int|null, q: string[] },
 *     model: string }
 */
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { consume, quotaMessage, resolveSubject } from "../_shared/quota.ts";

const FACETS_URL = "https://singlet.bio/api/facets?level=gsm";
/**
 * Model ladder. The lite model answers this extraction task in ~1–2 s; the
 * full Flash model reasons for 3–10 s, which blew the search API's 9 s budget
 * often enough to drop users into plain keyword search. Try fast first and
 * only escalate when the fast model errors or returns nothing parseable.
 */
const MODELS = ["google/gemini-3.1-flash-lite", "google/gemini-3.7-flash"] as const;
const MODEL_TIMEOUT_MS: Record<(typeof MODELS)[number], number> = {
  "google/gemini-3.1-flash-lite": 6000,
  "google/gemini-3.7-flash": 12000,
};
const CELL_TYPE_LIMIT = 200;

type ListField = "organism" | "tissue_group" | "disease_group" | "assay_family" | "cell_type";
const LIST_FIELDS: ListField[] = ["organism", "tissue_group", "disease_group", "assay_family", "cell_type"];
type Vocab = Record<ListField, string[]>;

interface Interpreted {
  organism: string[];
  tissue_group: string[];
  disease_group: string[];
  assay_family: string[];
  cell_type: string[];
  min_cells: number | null;
  year_min: number | null;
  year_max: number | null;
  q: string[];
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function emptyVocab(): Vocab {
  return { organism: [], tissue_group: [], disease_group: [], assay_family: [], cell_type: [] };
}

function strList(v: unknown, limit = 400): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? String((x as { value?: unknown }).value ?? "") : ""))
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function coerceVocab(raw: unknown): Vocab {
  const out = emptyVocab();
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  for (const f of LIST_FIELDS) out[f] = strList(obj[f], f === "cell_type" ? CELL_TYPE_LIMIT : 400);
  return out;
}

/** Fallback: derive the vocabulary from the public facets endpoint. */
async function loadVocab(): Promise<Vocab> {
  try {
    const res = await fetch(FACETS_URL, { headers: { accept: "application/json" } });
    if (!res.ok) return emptyVocab();
    const data = (await res.json()) as Record<string, unknown>;
    const vocab = (data.vocab ?? {}) as Record<string, unknown>;
    const organisms = strList(data.organism).map((sci) => {
      const label = (Array.isArray(data.organism) ? (data.organism as { value: string; label?: string }[]).find((o) => o.value === sci)?.label : null) ?? sci;
      return label === sci ? sci : `${label} (${sci})`;
    });
    return {
      organism: organisms,
      tissue_group: strList(vocab.tissue_group ?? data.tissue_group),
      disease_group: strList(vocab.disease_group ?? data.disease_group),
      assay_family: strList(vocab.assay_family ?? data.assay_family),
      cell_type: strList(data.cell_type, CELL_TYPE_LIMIT),
    };
  } catch {
    return emptyVocab();
  }
}

const SYSTEM_PROMPT = `You translate a plain-English search for single-cell RNA-seq studies into strict JSON filters for a catalog.

The catalog has these filter fields:
- "organism": array of SCIENTIFIC names (e.g. "Mus musculus"). Choose from the organism vocabulary, which lists "Common name (Scientific name)". Always answer with the scientific name only. "human", "patient", "donor" → "Homo sapiens"; "mouse", "mice", "murine" → "Mus musculus".
- "tissue_group": array of EXACT strings from the tissue_group vocabulary (anatomical site / sample origin).
- "disease_group": array of EXACT strings from the disease_group vocabulary. Use "Healthy / control" only when the user explicitly asks for healthy or control samples.
- "assay_family": array of EXACT strings from the assay_family vocabulary (10x 3', 10x 5', Smart-seq / plate-based, …).
- "cell_type": array of short lowercase cell-type terms as they would appear in GEO sample annotations ("microglia", "t cell", "cd8 t cell", "hepatocyte", "cardiomyocyte"). Prefer spellings that occur in the cell_type vocabulary when the concept matches; otherwise use the common lowercase form. Singular, no plural.
- "min_cells": integer minimum cell count per study if the user asks for one ("at least 50k cells" → 50000), else null.
- "year_min" / "year_max": integers if the user constrains the year ("since 2021" → year_min 2021), else null.
- "q": array of RESIDUAL keywords that are not captured by the fields above — genes, proteins, drugs, treatments, perturbations, techniques, phenotypes, developmental stages, authors, consortium names. Each entry is one short term or phrase. Do NOT repeat concepts already captured by other fields (never put "mouse", "brain", "microglia", "covid" in q if you set organism/tissue_group/cell_type/disease_group for them). Do not include generic words (study, dataset, data, single-cell, scRNA-seq, sequencing, samples, cells, atlas, profiling).

Rules:
- Every field must be present. Empty arrays and nulls are fine.
- Use ONLY vocabulary strings for organism, tissue_group, disease_group and assay_family. If nothing fits, leave the array empty and put the concept in q.
- Interpret common synonyms: PBMC/blood/leukocytes → "Blood / PBMC"; cortex/hippocampus/neurons/CNS → "Brain / CNS"; lung/airway/bronchial → "Lung / airway"; colon/ileum/intestinal → "Gut / intestine"; tumour/tumor/carcinoma/melanoma/glioma/leukemia/lymphoma → disease_group "Cancer" (and tissue_group when the site is named, e.g. melanoma → "Skin"; glioma/glioblastoma → "Brain / CNS"; leukemia → "Blood / PBMC" or "Bone marrow"); SARS-CoV-2 → "COVID-19"; AD → "Alzheimer's disease"; injury/transplant → "Injury / transplant / aging"; aging, aged, old vs young, development stages, treatments and perturbations are NOT diseases — put them in q (e.g. "aging"); 10x/Chromium (unspecified chemistry) → leave assay_family empty; "10x 3 prime" → "10x 3'"; Smart-seq2/plate → "Smart-seq / plate-based"; organoids → tissue_group "Organoid"; embryo/fetal/developing → "Embryo / development".
- Never guess a species. Set organism ONLY when the query names one (human, patient, donor, mouse, mice, murine, rat, zebrafish, …). A disease, tissue or cell type alone says nothing about species — leave organism empty.
- NEVER infer a tissue from a disease or from a cell type. A disease name (melanoma, glioma, leukemia, AML, breast cancer …) sets disease_group only, plus the disease word as a keyword in q; leave tissue_group empty unless the query itself names an anatomical site or sample source ("skin biopsy", "bone marrow aspirate", "lung tissue"). A cell type never sets a tissue either.
- Write keywords in q in their plain hyphenated form ("tumor-infiltrating"); the search matches hyphen and space forms and common abbreviations (TIL) on its own. Cell types are singular ("t cell", "cd8 t cell"), never "T cells" or "T-cell".
- Never guess an assay chemistry. Bare "10x", "Chromium" or "droplet" → assay_family empty. Only a stated chemistry (3', 5', v2/v3 with prime, Multiome, Smart-seq2, Drop-seq, …) sets assay_family.
- Output STRICT JSON only — no prose, no markdown fences.

Examples:
Query: microglia in the aging mouse brain
{"organism":["Mus musculus"],"tissue_group":["Brain / CNS"],"disease_group":[],"assay_family":[],"cell_type":["microglia"],"min_cells":null,"year_min":null,"year_max":null,"q":["aging"]}
Query: human PBMC COVID-19 10x 5'
{"organism":["Homo sapiens"],"tissue_group":["Blood / PBMC"],"disease_group":["COVID-19"],"assay_family":["10x 5'"],"cell_type":[],"min_cells":null,"year_min":null,"year_max":null,"q":[]}
Query: AML bone marrow 10x
{"organism":[],"tissue_group":["Bone marrow"],"disease_group":["Cancer"],"assay_family":[],"cell_type":[],"min_cells":null,"year_min":null,"year_max":null,"q":["AML"]}
Query: tumor-infiltrating T cells in melanoma
{"organism":[],"tissue_group":[],"disease_group":["Cancer"],"assay_family":[],"cell_type":["t cell"],"min_cells":null,"year_min":null,"year_max":null,"q":["melanoma","tumor-infiltrating"]}
Query: CD8+ T cells in glioblastoma
{"organism":[],"tissue_group":[],"disease_group":["Cancer"],"assay_family":[],"cell_type":["cd8 t cell"],"min_cells":null,"year_min":null,"year_max":null,"q":["glioblastoma"]}
Query: TILs from human breast tumours
{"organism":["Homo sapiens"],"tissue_group":[],"disease_group":["Cancer"],"assay_family":[],"cell_type":["t cell"],"min_cells":null,"year_min":null,"year_max":null,"q":["breast","tumor-infiltrating"]}
Query: FOXP3 knockout regulatory T cells with at least 20k cells since 2022
{"organism":[],"tissue_group":[],"disease_group":[],"assay_family":[],"cell_type":["regulatory t cell"],"min_cells":20000,"year_min":2022,"year_max":null,"q":["FOXP3","knockout"]}`;

function extractJson(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function coerceInterpreted(raw: unknown, vocab: Vocab): Interpreted {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === "string" && v.trim() ? [v.trim()] : [];
  const int = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
    if (typeof v === "string" && v.trim()) {
      const n = parseInt(v.replace(/[,_\s]/g, ""), 10);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  // Organism: accept "Common (Scientific)" or bare common names and unwrap to the scientific name.
  const sciByAny = new Map<string, string>();
  for (const entry of vocab.organism) {
    const m = /^(.*?)\s*\((.+)\)\s*$/.exec(entry);
    const sci = (m ? m[2] : entry).trim();
    sciByAny.set(sci.toLowerCase(), sci);
    if (m) sciByAny.set(m[1].trim().toLowerCase(), sci);
    sciByAny.set(entry.toLowerCase(), sci);
  }
  const organism = [...new Set(arr(obj.organism).map((o) => sciByAny.get(o.toLowerCase()) ?? o))];

  const exact = (field: Exclude<ListField, "organism" | "cell_type">, vals: string[]) => {
    const canon = new Map(vocab[field].map((g) => [g.toLowerCase(), g]));
    return [...new Set(vals.map((v) => canon.get(v.toLowerCase()) ?? v))];
  };

  const generic = new Set(["study", "studies", "dataset", "datasets", "data", "single-cell", "single cell", "scrna-seq", "scrnaseq", "sequencing", "samples", "sample", "cells", "cell", "atlas", "profiling", "rna-seq"]);
  const q = [...new Set(arr(obj.q).map((s) => s.replace(/\s+/g, " ")).filter((s) => !generic.has(s.toLowerCase())))];

  return {
    organism,
    tissue_group: exact("tissue_group", arr(obj.tissue_group ?? obj.tissue)),
    disease_group: exact("disease_group", arr(obj.disease_group ?? obj.disease)),
    assay_family: exact("assay_family", arr(obj.assay_family ?? obj.protocol)),
    cell_type: [...new Set(arr(obj.cell_type).map((s) => s.toLowerCase()))],
    min_cells: int(obj.min_cells),
    year_min: int(obj.year_min),
    year_max: int(obj.year_max),
    q,
  };
}

type ModelOutcome =
  | { ok: true; parsed: unknown; model: string }
  | { ok: false; status: number; detail: string; model: string };

/** One gateway call with its own timeout; never throws. */
async function askModel(
  apiKey: string,
  model: (typeof MODELS)[number],
  messages: { role: string; content: string }[],
): Promise<ModelOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS[model]);
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify({ model, temperature: 0, messages }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, status: res.status, detail: detail.slice(0, 500), model };
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(text);
    if (parsed == null) return { ok: false, status: 0, detail: "no JSON in model reply", model };
    return { ok: true, parsed, model };
  } catch (e) {
    return { ok: false, status: 0, detail: String(e), model };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const q = typeof body.q === "string" ? body.q.trim().slice(0, 500) : "";
    if (!q) return json({ error: "Missing query 'q'" }, 400);

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    // Daily budget: 10 interpretations/day per anonymous visitor, 200 when
    // signed in (an API key counts against its owner). Cached interpretations
    // never reach this function, so the counter reflects real model calls only.
    const subject = await resolveSubject(req);
    if (subject.invalidKey) {
      return json({ error: "invalid_api_key", message: subject.invalidKey.message, reason: subject.invalidKey.reason }, 401);
    }
    const quota = await consume(subject, "search");
    if (quota.exceeded) {
      return json({ error: "quota_exceeded", message: quotaMessage(quota, "AI searches"), quota }, 429);
    }

    const vocab = body.vocab ? coerceVocab(body.vocab) : await loadVocab();
    const vocabText = LIST_FIELDS.map((f) => `${f}: ${vocab[f].length ? vocab[f].join(" | ") : "(none)"}`).join("\n\n");
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Vocabulary (allowed values per field, separated by " | "):\n\n${vocabText}\n\nQuery: ${q}\n\nReturn the JSON now.`,
      },
    ];

    let last: ModelOutcome | null = null;
    for (const model of MODELS) {
      const outcome = await askModel(apiKey, model, messages);
      last = outcome;
      if (outcome.ok) {
        return json({ interpreted: coerceInterpreted(outcome.parsed, vocab), model: outcome.model, version: 2, quota });
      }
      // Quota / billing problems apply to every model — don't burn a second call.
      if (outcome.status === 429 || outcome.status === 402) break;
    }

    if (last && !last.ok && (last.status === 429 || last.status === 402)) {
      return json({ error: `AI gateway ${last.status}`, detail: last.detail, quota }, last.status === 429 ? 503 : last.status);
    }
    return json(
      { error: "AI gateway unavailable", detail: last && !last.ok ? `${last.model}: ${last.detail}` : "", quota },
      502,
    );
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

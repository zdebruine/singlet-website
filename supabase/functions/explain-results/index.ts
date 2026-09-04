/**
 * POST /functions/v1/explain-results
 *
 * Signed-in only. Writes a one-sentence, grounded "why this study matches
 * your question" for up to 10 studies in a single model call. Explanations are
 * cached per (normalised question, study) in public.explanations so the same
 * pair is never paid for twice; each *uncached* call costs one unit of the
 * signed-in "explain" budget (100/day).
 *
 * Body:
 *   { q: string,
 *     studies: [{ gse_id, title, abstract?, organism_label?, tissue_groups?,
 *                 disease_groups?, cell_types_raw?, conditions_label?, n_cells?, year? }] }
 * Reply:
 *   { explanations: { [gse_id]: string }, cached: number, generated: number,
 *     quota?: Quota, model?: string }
 * Errors: 401 (not signed in), 400 (bad body), 429 (budget), 502 (model).
 */
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { consume, quotaMessage, resolveSubject, service, sha256Hex } from "../_shared/quota.ts";

const MODEL = "google/gemini-3.1-flash-lite";
const MODEL_VERSION = "v1"; // bump to invalidate the cache
const MAX_STUDIES = 10;
const MODEL_TIMEOUT_MS = 15000;

interface StudyIn {
  gse_id: string;
  title: string;
  abstract: string;
  organism_label: string;
  tissue_groups: string[];
  disease_groups: string[];
  cell_types_raw: string[];
  conditions_label: string;
  n_cells: number | null;
  year: number | null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const str = (v: unknown, max = 2000): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strs = (v: unknown, max = 12): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean).slice(0, max) : [];
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function coerceStudies(raw: unknown): StudyIn[] {
  if (!Array.isArray(raw)) return [];
  const out: StudyIn[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const id = str(r.gse_id, 20).toUpperCase();
    if (!/^GSE\d{3,8}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      gse_id: id,
      title: str(r.title, 400),
      abstract: str(r.abstract, 1800),
      organism_label: str(r.organism_label, 80),
      tissue_groups: strs(r.tissue_groups),
      disease_groups: strs(r.disease_groups),
      cell_types_raw: strs(r.cell_types_raw, 15),
      conditions_label: str(r.conditions_label, 300),
      n_cells: numOrNull(r.n_cells),
      year: numOrNull(r.year),
    });
    if (out.length >= MAX_STUDIES) break;
  }
  return out;
}

const normQ = (q: string) => q.toLowerCase().replace(/\s+/g, " ").trim();

async function cacheKey(qn: string, gse: string): Promise<string> {
  return sha256Hex(`${MODEL_VERSION}|${qn}|${gse}`);
}

const SYSTEM_PROMPT = `You help biologists judge whether a single-cell RNA-seq study answers their question.

For each study, write ONE sentence (max 30 words) that says concretely why it does or does not fit the question, grounded ONLY in the metadata given: organism, tissue, disease, cell types named in sample annotations, experimental conditions, title and abstract. Name the specific evidence (e.g. "profiles CD45+ microglia from 18-month-old mouse cortex"). If the fit is partial, say what is missing (e.g. "human, not mouse" or "no aged animals mentioned"). Never invent facts, sample sizes, or results that are not in the metadata. Plain language, no marketing, no exclamation marks.

Answer with STRICT JSON only: {"<GSE id>": "<sentence>", ...} — one entry per study, same ids as given, no markdown fences.`;

function studyBlock(s: StudyIn): string {
  const parts = [
    `ID: ${s.gse_id}`,
    s.title && `Title: ${s.title}`,
    s.organism_label && `Organism: ${s.organism_label}`,
    s.tissue_groups.length && `Tissue: ${s.tissue_groups.join(", ")}`,
    s.disease_groups.length && `Disease: ${s.disease_groups.join(", ")}`,
    s.cell_types_raw.length && `Cell types in annotations: ${s.cell_types_raw.join(", ")}`,
    s.conditions_label && `Conditions: ${s.conditions_label}`,
    s.n_cells != null && `Cells: ${s.n_cells}`,
    s.year != null && `Year: ${s.year}`,
    s.abstract && `Abstract: ${s.abstract}`,
  ].filter(Boolean);
  return parts.join("\n");
}

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function askModel(apiKey: string, q: string, studies: StudyIn[]): Promise<{ ok: true; map: Record<string, string> } | { ok: false; status: number; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Question: ${q}\n\nStudies:\n\n${studies.map(studyBlock).join("\n\n---\n\n")}\n\nReturn the JSON now.` },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, status: res.status, detail: (await res.text().catch(() => "")).slice(0, 500) };
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const parsed = extractJson(data.choices?.[0]?.message?.content ?? "");
    if (!parsed) return { ok: false, status: 0, detail: "no JSON in model reply" };
    const map: Record<string, string> = {};
    for (const s of studies) {
      const v = parsed[s.gse_id] ?? parsed[s.gse_id.toLowerCase()];
      if (typeof v === "string" && v.trim()) map[s.gse_id] = v.trim().replace(/\s+/g, " ").slice(0, 400);
    }
    if (!Object.keys(map).length) return { ok: false, status: 0, detail: "model reply had no matching ids" };
    return { ok: true, map };
  } catch (e) {
    return { ok: false, status: 0, detail: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const subject = await resolveSubject(req);
    if (subject.invalidKey) {
      return json({ error: "invalid_api_key", message: subject.invalidKey.message, reason: subject.invalidKey.reason }, 401);
    }
    if (subject.kind !== "user") {
      return json({ error: "sign_in_required", message: "AI explanations are available when you are signed in (free)." }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const q = str(body.q, 500);
    const studies = coerceStudies(body.studies);
    if (!q) return json({ error: "Missing 'q'" }, 400);
    if (!studies.length) return json({ error: "Provide 1–10 studies with a gse_id" }, 400);

    const qn = normQ(q);
    const db = service();

    // Cache lookup — anything already explained for this question is free.
    const keys = await Promise.all(studies.map((s) => cacheKey(qn, s.gse_id)));
    const keyToGse = new Map(keys.map((k, i) => [k, studies[i].gse_id]));
    const explanations: Record<string, string> = {};
    let model: string | undefined;
    try {
      const { data } = await db.from("explanations").select("cache_key, explanation, model").in("cache_key", keys);
      for (const row of data ?? []) {
        const gse = keyToGse.get(row.cache_key as string);
        if (gse) {
          explanations[gse] = row.explanation as string;
          if (typeof row.model === "string") model = row.model;
        }
      }
    } catch (e) {
      console.warn("[explain] cache read failed:", String(e));
    }
    const cached = Object.keys(explanations).length;
    const missing = studies.filter((s) => !explanations[s.gse_id]);
    if (!missing.length) return json({ explanations, cached, generated: 0, model });

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    const quota = await consume(subject, "explain");
    if (quota.exceeded) {
      return json({ error: "quota_exceeded", message: quotaMessage(quota, "AI explanations"), quota, explanations, cached }, 429);
    }

    const outcome = await askModel(apiKey, q, missing);
    if (!outcome.ok) {
      const status = outcome.status === 402 ? 402 : outcome.status === 429 ? 503 : 502;
      return json({ error: "AI gateway unavailable", detail: outcome.detail, quota, explanations, cached }, status);
    }

    const rows = await Promise.all(
      Object.entries(outcome.map).map(async ([gse, text]) => ({
        cache_key: await cacheKey(qn, gse),
        query_norm: qn.slice(0, 500),
        gse_id: gse,
        explanation: text,
        model: MODEL,
      })),
    );
    for (const r of rows) explanations[r.gse_id] = r.explanation;
    try {
      await db.from("explanations").upsert(rows, { onConflict: "cache_key", ignoreDuplicates: true });
    } catch (e) {
      console.warn("[explain] cache write failed:", String(e));
    }

    return json({ explanations, cached, generated: rows.length, quota, model: MODEL });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

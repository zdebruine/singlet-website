/**
 * Scores the query-interpreter prompt + model against golden.json.
 *
 *   npx wrangler dev --remote --port 8799 --config scripts/search-eval/worker/wrangler.toml   (one terminal)
 *   npm run eval:search -- --models @cf/meta/llama-3.3-70b-instruct-fp8-fast,@cf/qwen/qwen3-30b-a3b-fp8 --prompts v1,v2
 *
 * Reports per-field accuracy, how many queries are fully right, tokens and cost per call.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { JSON_ONLY } from "../../functions/_shared/ai";
import { INTERPRET_SCHEMA, SYSTEM_PROMPT, mergeReadings, parseQuery, userPrompt, validateModelReading } from "../../functions/_shared/interpret";
import { COMPACT_SYSTEM_PROMPT, compactUserPrompt } from "../../functions/_shared/interpret-prompt";
import { organismVocabForModel, type VocabRule } from "../../functions/_shared/vocab";

const PRICES: Record<string, [number, number]> = {
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": [0.293, 2.253],
  "@cf/meta/llama-3.1-8b-instruct-fp8": [0.152, 0.287],
  "@cf/meta/llama-3.2-3b-instruct": [0.0509, 0.335],
  "@cf/qwen/qwen3-30b-a3b-fp8": [0.051, 0.335],
  "@cf/openai/gpt-oss-20b": [0.2, 0.3],
  "@cf/openai/gpt-oss-120b": [0.35, 0.75],
  "@cf/mistralai/mistral-small-3.1-24b-instruct": [0.351, 0.555],
  "@cf/google/gemma-3-12b-it": [0.345, 0.556],
  "@cf/meta/llama-4-scout-17b-16e-instruct": [0.27, 0.85],
};
const arg = (name: string, d: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const models = arg("models", "@cf/meta/llama-3.3-70b-instruct-fp8-fast").split(",");
const prompts = arg("prompts", "v1,v2").split(",");
const base = arg("url", "http://localhost:8799");
const only = Number(arg("limit", "0"));
const plain = arg("plain", "0") === "1"; // no JSON-schema mode: how production falls back for models that lack it
const golden = JSON.parse(readFileSync(new URL(`./${arg("set", "golden")}.json`, import.meta.url), "utf8")) as Record<string, unknown>[];
const rows = only ? golden.slice(0, only) : golden;
// Production's own vocabulary rules (fetch with wrangler d1 execute, see README.md); without them only raw model output is scored.
let RULES: VocabRule[] = [];
try { RULES = JSON.parse(readFileSync(new URL("./.rules.json", import.meta.url), "utf8")) as VocabRule[]; } catch { /* raw scoring only */ }
const CELL_TYPES = ["t cell", "b cell", "macrophage", "neuron", "fibroblast", "hepatocyte", "microglia", "monocyte", "epithelial cell", "nk cell"];

function build(prompt: string, query: string) {
  if (prompt === "v1") return { system: SYSTEM_PROMPT, user: userPrompt(query, CELL_TYPES) };
  return { system: COMPACT_SYSTEM_PROMPT, user: compactUserPrompt(query, CELL_TYPES) };
}
void organismVocabForModel;

const norm = (v: unknown): string[] =>
  Array.isArray(v)
    ? v
        .map((x) => String(x).toLowerCase().trim().replace(/^.*\(([^)]+)\)$/, "$1")) // "Rat (Rattus norvegicus)" -> scientific name, as validateModelReading does
        .filter((x) => x && x !== "other / unspecified")
    : [];
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const covered = (want: string, got: string[]) => got.some((g) => g.includes(want) || want.includes(g));

const CORE = ["organism", "tissue_group", "disease_group", "assay_family", "min_cells", "year_min", "year_max"];
const coreOk = (s: Record<string, boolean>) => CORE.every((k) => s[k]);

function score(exp: Record<string, unknown>, out: Record<string, unknown> | null) {
  const f: Record<string, boolean> = {};
  const o = out ?? {};
  for (const k of ["organism", "tissue_group", "disease_group", "assay_family", "cell_type"]) f[k] = sameSet(norm(exp[k]), norm(o[k]));
  f.min_cells = Number(o.min_cells ?? 0) === Number(exp.min_cells);
  // "after 2023" and "before 2021" are read inclusively or not; both are fine.
  for (const k of ["year_min", "year_max"]) f[k] = Math.abs(Number(o[k] ?? 0) - Number(exp[k])) <= (Number(exp[k]) ? 1 : 0);
  const wantQ = norm(exp.q);
  const gotQ = norm(o.q);
  f.q = wantQ.every((w) => covered(w, gotQ)) && gotQ.length <= wantQ.length + 2;
  return f;
}

async function call(model: string, prompt: string, query: string) {
  const { system, user } = build(prompt, query);
  const res = await fetch(base, {
    method: "POST",
    body: JSON.stringify({ model, system: system + JSON_ONLY, user, schema: INTERPRET_SCHEMA, maxTokens: 500, plain }),
  });
  const body = (await res.json()) as { result?: Record<string, unknown>; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: string; ms?: number };
  if (typeof body.result === "string") {
    const m = /\{[\s\S]*\}/.exec(body.result); // production's parseJsonText: first balanced object wins
    try { body.result = m ? JSON.parse(m[0]) : undefined; } catch { body.result = undefined; body.error = "unparseable JSON"; }
  }
  return body;
}

if (RULES.length) {
  const alone = rows.filter((r) => {
    const p = parseQuery(String(r.query), { rules: RULES, cellTypes: CELL_TYPES });
    return !p.ambiguous && Object.values(score(r, p.interpreted as unknown as Record<string, unknown>)).every(Boolean);
  }).length;
  console.log(JSON.stringify({ vocabulary_alone_fully_right: `${alone}/${rows.length}` }));
}
const report: unknown[] = [];
for (const model of models) {
  for (const prompt of prompts) {
    const totals: Record<string, number> = {};
    let modelCalls = 0, coreRaw = 0, coreValid = 0, coreFlow = 0, flowOk = 0, allOk = 0, finalOk = 0, tin = 0, tout = 0, ms = 0, errors = 0;
    const misses: string[] = [];
    for (let i = 0; i < rows.length; i += 4) {
      const batch = rows.slice(i, i + 4);
      const outs = await Promise.all(batch.map((r) => call(model, prompt, String(r.query)).catch((e) => ({ error: String(e) }))));
      outs.forEach((o, j) => {
        const exp = batch[j]!;
        if (RULES.length) {
          const p0 = parseQuery(String(exp.query), { rules: RULES, cellTypes: CELL_TYPES });
          if (p0.ambiguous) modelCalls++;
        }
        if (o.error || !o.result) { errors++; misses.push(`${exp.query} -> ERROR ${String(o.error).slice(0, 80)}`); return; }
        tin += o.usage?.prompt_tokens ?? 0; tout += o.usage?.completion_tokens ?? 0; ms += o.ms ?? 0;
        const s = score(exp, o.result);
        if (RULES.length) {
          const parsed = parseQuery(String(exp.query), { rules: RULES, cellTypes: CELL_TYPES });
          const final = mergeReadings(parsed, validateModelReading(o.result, String(exp.query), RULES)) as unknown as Record<string, unknown>;
          if (Object.values(score(exp, final)).every(Boolean)) finalOk++;
          if (coreOk(score(exp, final))) coreValid++;
          // What production returns: the parser alone when it is sure, else the validated, merged model reading.
          const shipped = parsed.ambiguous ? final : (parsed.interpreted as unknown as Record<string, unknown>);
          if (Object.values(score(exp, shipped)).every(Boolean)) flowOk++;
          if (coreOk(score(exp, shipped))) coreFlow++;
        }
        for (const [k, v] of Object.entries(s)) totals[k] = (totals[k] ?? 0) + (v ? 1 : 0);
        if (coreOk(s)) coreRaw++;
        if (Object.values(s).every(Boolean)) allOk++;
        else misses.push(`${exp.query} -> ${Object.entries(s).filter(([, v]) => !v).map(([k]) => k).join(",")} :: ${JSON.stringify(o.result).slice(0, 220)}`);
      });
    }
    const n = rows.length - errors;
    const [pi, po] = PRICES[model] ?? [0, 0];
    const cost = (tin * pi + tout * po) / 1e6 / Math.max(n, 1);
    const costPerQuery = modelCalls ? (cost * n) / n * (modelCalls / n) : 0; // only ambiguous queries pay
    const line = {
      model, prompt, n, errors, fully_right: `${allOk}/${n}`, after_validation: RULES.length ? `${finalOk}/${n}` : "n/a", core_fields_raw: `${coreRaw}/${n}`, core_fields_validated: `${coreValid}/${n}`, core_fields_production: `${coreFlow}/${n}`, production_flow: RULES.length ? `${flowOk}/${n}` : "n/a", model_calls: modelCalls,
      fields: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, `${v}/${n}`])),
      avg_in_tokens: Math.round(tin / Math.max(n, 1)), avg_out_tokens: Math.round(tout / Math.max(n, 1)),
      usd_per_call: Number(cost.toFixed(7)), usd_per_query_in_production: Number(costPerQuery.toFixed(7)), avg_ms: Math.round(ms / Math.max(n, 1)),
    };
    console.log(JSON.stringify(line));
    report.push({ ...line, misses });
  }
}
writeFileSync(new URL("./last-report.json", import.meta.url), JSON.stringify(report, null, 1));

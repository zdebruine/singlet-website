/**
 * One JSON-returning model call, for AI search (query interpretation) and
 * result explanations. No third-party backend beyond the model provider.
 *
 * Provider order:
 *   1. ANTHROPIC_API_KEY set → the Anthropic Messages API directly (model
 *      ANTHROPIC_MODEL, default claude-haiku-4-5). The reply is constrained to
 *      the schema with structured outputs; a model that rejects them (HTTP
 *      400) is asked once more with the prompt alone.
 *   2. AI binding → Workers AI (AI_MODEL, default Llama 3.3 70B fp8-fast) in
 *      JSON mode, routed through AI Gateway AI_GATEWAY_ID for logs, caching
 *      and rate limits when set. A failed attempt steps down one thing at a
 *      time inside the same deadline: without the gateway, then without JSON
 *      mode.
 *   3. Neither → AiNotConfigured. Callers degrade to deterministic answers.
 *
 * Every call has a hard deadline (Promise.race; the Anthropic fetch is also
 * aborted). Replies are parsed defensively: Workers AI hands back `response`
 * as an object or as a JSON string, third-party models routed through the
 * binding answer OpenAI-style (`choices[0].message.content`), and chatty
 * models wrap JSON in prose or fences — the first balanced JSON object wins.
 */
import type { AppEnv } from "./env";

export type AiEnv = Pick<AppEnv, "AI" | "AI_MODEL" | "AI_GATEWAY_ID" | "ANTHROPIC_API_KEY" | "ANTHROPIC_MODEL">;

export const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 800;
const DEFAULT_TIMEOUT_MS = 10_000;
/** Below this much time left, a retry cannot finish — give up instead. */
const MIN_RETRY_MS = 800;

const JSON_ONLY = "\n\nReply with a single JSON object that matches the requested fields. No prose, no markdown fences.";

export interface RunJsonOptions {
  system: string;
  user: string;
  /**
   * JSON Schema of the reply. Keep it to the portable subset: every object
   * sets `additionalProperties: false` and lists all keys in `required`; no
   * numeric/length constraints; no nullable types (use 0 / "" / [] instead).
   */
  schema: Record<string, unknown>;
  maxTokens?: number;
  timeoutMs?: number;
}

/** Neither ANTHROPIC_API_KEY nor the AI binding is available. */
export class AiNotConfigured extends Error {
  constructor() {
    super("No AI provider is configured (set ANTHROPIC_API_KEY or bind Workers AI as AI).");
    this.name = "AiNotConfigured";
  }
}

/** The provider did not answer within the deadline. */
export class AiTimeout extends Error {
  constructor(ms: number) {
    super(`AI call timed out after ${ms} ms`);
    this.name = "AiTimeout";
  }
}

/** The provider answered, but with an error or nothing usable. */
export class AiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "AiError";
    this.status = status;
  }
}

/**
 * The Workers AI binding, typed loosely on purpose: @cloudflare/workers-types
 * keys `Ai.run` on a literal union of model names, which would make any model
 * id read from an env var a compile error.
 */
interface LooseAi {
  run(model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export function aiConfigured(env: AiEnv): boolean {
  return !!env.ANTHROPIC_API_KEY || !!env.AI;
}

/** The model that `runJson` would use, for response bodies ("model": …); null when none is configured. */
export function modelLabel(env: AiEnv): string | null {
  if (env.ANTHROPIC_API_KEY) return `anthropic/${env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL}`;
  if (env.AI) return env.AI_MODEL || DEFAULT_WORKERS_AI_MODEL;
  return null;
}

/** Ask the configured model for one JSON object. Throws AiNotConfigured, AiTimeout or AiError. */
export async function runJson(env: AiEnv, opts: RunJsonOptions): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  if (env.ANTHROPIC_API_KEY) return runAnthropic(env, env.ANTHROPIC_API_KEY, opts, maxTokens, timeoutMs);
  if (env.AI) return runWorkersAi(env, env.AI as unknown as LooseAi, opts, maxTokens, timeoutMs);
  throw new AiNotConfigured();
}

// ── Anthropic Messages API ──────────────────────────────────────────────────

interface AnthropicReply {
  content?: { type?: string; text?: string }[];
  stop_reason?: string;
}

/** Only these accept `temperature`; newer models reject sampling parameters outright. */
function takesTemperature(model: string): boolean {
  return /^claude-(haiku-4-5|3)/.test(model);
}

async function runAnthropic(env: AiEnv, key: string, opts: RunJsonOptions, maxTokens: number, timeoutMs: number): Promise<unknown> {
  const model = env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
  const controller = new AbortController();
  const post = (structured: boolean) =>
    fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: opts.system + JSON_ONLY,
        messages: [{ role: "user", content: opts.user }],
        ...(takesTemperature(model) ? { temperature: 0 } : {}),
        ...(structured ? { output_config: { format: { type: "json_schema", schema: opts.schema } } } : {}),
      }),
      signal: controller.signal,
    });

  const call = async (): Promise<unknown> => {
    let res = await post(true);
    if (res.status === 400) {
      // A model without structured outputs, or a schema it cannot compile: ask again with the prompt alone.
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      console.warn("[ai] structured output refused, retrying without it:", detail);
      res = await post(false);
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new AiError(`Anthropic ${res.status}: ${detail}`, res.status);
    }
    const data = (await res.json()) as AnthropicReply;
    if (data.stop_reason === "refusal") throw new AiError("Anthropic declined the request");
    const text = (data.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text ?? "")
      .join("");
    return parseJsonText(text);
  };

  return withTimeout(call(), timeoutMs, () => controller.abort());
}

// ── Workers AI (optionally through AI Gateway) ──────────────────────────────

async function runWorkersAi(env: AiEnv, ai: LooseAi, opts: RunJsonOptions, maxTokens: number, timeoutMs: number): Promise<unknown> {
  const model = env.AI_MODEL || DEFAULT_WORKERS_AI_MODEL;
  // Workers AI's own models take JSON mode and sampling knobs; a third-party id
  // routed through the binding gets the plain chat shape and the JSON-only prompt.
  const native = model.startsWith("@cf/") || model.startsWith("@hf/");
  const messages = [
    { role: "system", content: opts.system + JSON_ONLY },
    { role: "user", content: opts.user },
  ];
  const plain: Record<string, unknown> = { messages, max_tokens: maxTokens, ...(native ? { temperature: 0 } : {}) };
  const jsonMode: Record<string, unknown> = native ? { ...plain, response_format: { type: "json_schema", json_schema: opts.schema } } : plain;
  const gateway = env.AI_GATEWAY_ID ? { gateway: { id: env.AI_GATEWAY_ID } } : undefined;

  // Step down one thing at a time: gateway + JSON mode, then direct + JSON
  // mode (gateway missing or down), then direct without JSON mode (schema not
  // satisfiable). A timeout ends it: the deadline is shared.
  const attempts: { label: string; inputs: Record<string, unknown>; options?: Record<string, unknown> }[] = [];
  if (gateway) attempts.push({ label: "via gateway", inputs: jsonMode, options: gateway });
  attempts.push({ label: "direct", inputs: jsonMode });
  if (jsonMode !== plain) attempts.push({ label: "direct, no JSON mode", inputs: plain });

  const deadline = Date.now() + timeoutMs;
  let last: unknown = null;
  for (const [i, a] of attempts.entries()) {
    const left = deadline - Date.now();
    if (i > 0 && left < MIN_RETRY_MS) break;
    try {
      const call = a.options ? ai.run(model, a.inputs, a.options) : ai.run(model, a.inputs);
      return parseAiResult(await withTimeout(call, left));
    } catch (e) {
      if (e instanceof AiTimeout) throw e;
      last = e;
      console.warn(`[ai] ${model} ${a.label} failed:`, String(e).slice(0, 200));
    }
  }
  throw last instanceof AiError ? last : new AiError(String(last));
}

/** Pull the JSON object out of whatever shape the binding returned. */
export function parseAiResult(result: unknown): unknown {
  if (result == null) throw new AiError("empty reply");
  if (typeof result === "string") return parseJsonText(result);
  if (typeof result !== "object") throw new AiError("unrecognised reply");
  const r = result as Record<string, unknown>;

  // Workers AI: { response: object } in JSON mode, { response: "…" } otherwise.
  const response = r.response;
  if (response !== null && typeof response === "object") return response;
  if (typeof response === "string" && response.trim()) return parseJsonText(response);

  // OpenAI-style (third-party models through the binding / gateway).
  const choices = r.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as { message?: { content?: unknown }; text?: unknown } | null;
    const content: unknown = first?.message?.content ?? first?.text;
    if (content !== null && typeof content === "object" && !Array.isArray(content)) return content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? textOfParts(content) : "";
    if (text.trim()) return parseJsonText(text);
  }

  // Anthropic-style content blocks.
  const blocks = r.content;
  if (Array.isArray(blocks)) {
    const text = textOfParts(blocks);
    if (text.trim()) return parseJsonText(text);
  }

  // Some wrappers nest the payload one level down.
  const nested = r.result;
  if (nested !== null && typeof nested === "object") return parseAiResult(nested);
  throw new AiError("no JSON in the model reply");
}

function textOfParts(parts: unknown[]): string {
  return parts
    .map((p) => (typeof p === "string" ? p : p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : ""))
    .join("");
}

// ── Parsing helpers ─────────────────────────────────────────────────────────

/** Parse model text into JSON: the whole text if it is JSON, else the first balanced {…}. */
export function parseJsonText(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.parse(t);
    } catch {
      /* fall through to the scanner */
    }
  }
  const found = extractJsonObject(t);
  if (found === null) throw new AiError("no JSON in the model reply");
  return found;
}

/** The first balanced JSON object in `text` (string-aware), or null. */
export function extractJsonObject(text: string): unknown | null {
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

/** Resolve or reject with AiTimeout after `ms`; `onTimeout` can abort the underlying work. */
function withTimeout<T>(work: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (onTimeout) onTimeout();
      reject(new AiTimeout(ms));
    }, ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

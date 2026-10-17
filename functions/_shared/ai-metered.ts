/**
 * runJson behind the monthly token allowance (spend.ts): reserve, call, settle.
 * Every AI call in the Functions goes through here; nothing else may call the
 * model directly.
 */
import { AiTimeout, runJson, type AiEnv, type RunJsonOptions } from "./ai";
import type { Identity } from "./identity";
import {
  allowanceFor,
  allowanceMessage,
  estimateMicros,
  priceFor,
  purgeExpired,
  releaseSpend,
  reserveSpend,
  settleSpend,
  type AllowanceSnapshot,
  type SpendEnv,
  type Usage,
} from "./spend";

export type MeteredResult =
  | { ok: true; value: unknown; usage: Usage | null }
  | { ok: false; reason: "allowance" | "service_cap" | "anon_pool" | "unavailable"; message: string; snapshot?: AllowanceSnapshot };

const DEFAULT_MAX_TOKENS = 800;

export async function runMeteredJson(
  env: AiEnv & SpendEnv & { DB: D1Database },
  identity: Pick<Identity, "subject">,
  opts: RunJsonOptions,
  waitUntil?: (p: Promise<unknown>) => void
): Promise<MeteredResult> {
  const price = priceFor(env);
  const est = estimateMicros(price, opts.system.length + opts.user.length + JSON.stringify(opts.schema).length, opts.maxTokens ?? DEFAULT_MAX_TOKENS);
  const got = await reserveSpend(env.DB, env, identity, est);
  if (!got.ok) {
    const snapshot = got.reason === "allowance" ? await allowanceFor(env.DB, env, identity.subject).catch(() => undefined) : undefined;
    return { ok: false, reason: got.reason, message: allowanceMessage(got.reason, snapshot), ...(snapshot ? { snapshot } : {}) };
  }
  if (waitUntil) waitUntil(purgeExpired(env.DB));

  // A call can run the model more than once (the provider step-down retries), and each run is billed:
  // add the runs up instead of keeping the last one.
  let usage: Usage | null = null;
  const addUsage = (u: Usage) => {
    usage = usage ? { inputTokens: usage.inputTokens + u.inputTokens, outputTokens: usage.outputTokens + u.outputTokens } : u;
  };
  // Settling also goes to waitUntil, so it still finishes if the request is cancelled after the provider answered.
  const settle = (u: Usage | null) => {
    const done = settleSpend(env.DB, env, got.reservation, u);
    waitUntil?.(done);
    return done;
  };
  try {
    const value = await runJson(env, { ...opts, onUsage: addUsage });
    await settle(usage);
    return { ok: true, value, usage };
  } catch (e) {
    // The prompt was sent either way: a timeout may still be billed for its input.
    if (e instanceof AiTimeout) {
      await settle(usage ?? { inputTokens: Math.ceil((opts.system.length + opts.user.length) / 3), outputTokens: 0 });
    } else if (usage) {
      await settle(usage);
    } else {
      await releaseSpend(env.DB, got.reservation);
    }
    throw e;
  }
}

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
  | { ok: false; reason: "allowance" | "service_cap" | "unavailable"; message: string; snapshot?: AllowanceSnapshot };

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

  let usage: Usage | null = null;
  try {
    const value = await runJson(env, { ...opts, onUsage: (u) => (usage = u) });
    await settleSpend(env.DB, env, got.reservation, usage);
    return { ok: true, value, usage };
  } catch (e) {
    // The prompt was sent either way: a timeout may still be billed for its input.
    if (e instanceof AiTimeout) {
      await settleSpend(env.DB, env, got.reservation, usage ?? { inputTokens: Math.ceil((opts.system.length + opts.user.length) / 3), outputTokens: 0 });
    } else if (usage) {
      await settleSpend(env.DB, env, got.reservation, usage);
    } else {
      await releaseSpend(env.DB, got.reservation);
    }
    throw e;
  }
}

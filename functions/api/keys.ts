/**
 * POST /api/keys — manage the signed-in user's personal API keys (D1).
 *
 * Browser session only (the session cookie from a same-origin page): an API
 * key can call the API as its owner but can never list, mint or revoke keys.
 * Body:
 *   { action: "list" }
 *     → { items: ApiKeyItem[] }  (newest first, revoked and expired included)
 *   { action: "create", name: string, expires_in_days?: number | null }
 *     → { key: "sk_live_…" (shown once), item: ApiKeyItem }
 *   { action: "revoke", id: string }
 *     → { item: ApiKeyItem }
 *
 * ApiKeyItem = { id, name, key_prefix, created_at, last_used_at, expires_at, revoked_at }
 * Errors are { error, message } with a matching status. How keys look, hash
 * and are stored lives in ../_shared/api-keys.
 */
import type { AppEnv } from "../_shared/env";
import { forgetKeyMemo, requireUser } from "../_shared/identity";
import { MAX_ACTIVE_KEYS, MAX_EXPIRY_DAYS, cleanName, createKey, expiryFromDays, isKeyId, listKeys, revokeKey } from "../_shared/api-keys";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

export const onRequest: PagesFunction<AppEnv> = async ({ request, env, waitUntil }) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed", message: "POST only." }, 405, { Allow: "POST" });

  const who = await requireUser(request, env, waitUntil, "Sign in to manage API keys.");
  if (!who.ok) return who.response;
  if (who.identity.kind === "api_key") {
    return json(
      { error: "session_required", message: "API keys cannot manage API keys. Sign in at https://singlet.bio/account to create or revoke them." },
      403,
    );
  }
  const userId = who.identity.userId;

  const raw: unknown = await request.json().catch(() => null);
  const body = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "list") {
      return json({ items: await listKeys(env.DB, userId) });
    }

    if (action === "create") {
      const name = cleanName(body.name);
      if (!name) return json({ error: "invalid_name", message: "Give the key a name (1–60 characters)." }, 400);
      const expiry = expiryFromDays(body.expires_in_days);
      if (!expiry.ok) {
        return json({ error: "invalid_expiry", message: `Expiry must be between 1 and ${MAX_EXPIRY_DAYS} days, or left empty.` }, 400);
      }
      const created = await createKey(env.DB, userId, name, expiry.expiresAt);
      if (!created.ok) {
        return json({ error: "too_many_keys", message: `You can have up to ${MAX_ACTIVE_KEYS} active keys. Revoke one first.` }, 409);
      }
      return json({ key: created.key, item: created.item });
    }

    if (action === "revoke") {
      const id = body.id;
      if (!isKeyId(id)) return json({ error: "invalid_id", message: "Unknown key." }, 400);
      const item = await revokeKey(env.DB, userId, id);
      if (!item) return json({ error: "not_found", message: "That key does not exist or is already revoked." }, 404);
      // This isolate stops accepting the key at once; others within a minute (identity.ts memo).
      forgetKeyMemo();
      return json({ item });
    }

    return json({ error: "unknown_action", message: "action must be create, revoke or list." }, 400);
  } catch (e) {
    console.error("[api-keys]", String(e));
    return json({ error: "server_error", message: "Could not update API keys right now." }, 500);
  }
};

/**
 * POST /functions/v1/api-keys — manage the signed-in user's personal API keys.
 *
 * Requires a user session (Authorization: Bearer <access token>). Body:
 *   { action: "create", name: string, expires_in_days?: number | null }
 *     → { key: "sk_live_…" (shown once), item: ApiKeyItem }
 *   { action: "revoke", id: string }
 *     → { item: ApiKeyItem }
 *   { action: "list" }
 *     → { items: ApiKeyItem[] }
 *
 * ApiKeyItem = { id, name, key_prefix, created_at, last_used_at, expires_at, revoked_at }
 *
 * The table is written only here (service role) so the hashing rule lives in
 * one file; the account page reads the list through RLS.
 */
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { service } from "../_shared/service.ts";
import { displayPrefix, generateApiKey, hashApiKey } from "../_shared/api-keys.ts";

const MAX_ACTIVE_KEYS = 20;
const MAX_EXPIRY_DAYS = 365 * 2;
const ITEM_COLUMNS = "id, name, key_prefix, created_at, last_used_at, expires_at, revoked_at";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function requireUser(req: Request): Promise<{ id: string } | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!token || token === anon || token.split(".").length !== 3) return null;
  try {
    const { data, error } = await service().auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id };
  } catch {
    return null;
  }
}

function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = v.replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 60) return null;
  return name;
}

function expiryFromDays(v: unknown): string | null | "invalid" {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  if (!Number.isFinite(n) || n < 1 || n > MAX_EXPIRY_DAYS) return "invalid";
  return new Date(Date.now() + Math.floor(n) * 86_400_000).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const user = await requireUser(req);
  if (!user) return json({ error: "sign_in_required", message: "Sign in to manage API keys." }, 401);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  const db = service();

  try {
    if (action === "list") {
      const { data, error } = await db
        .from("api_keys")
        .select(ITEM_COLUMNS)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return json({ items: data ?? [] });
    }

    if (action === "create") {
      const name = cleanName(body.name);
      if (!name) return json({ error: "invalid_name", message: "Give the key a name (1–60 characters)." }, 400);
      const expires_at = expiryFromDays(body.expires_in_days);
      if (expires_at === "invalid") {
        return json({ error: "invalid_expiry", message: `Expiry must be between 1 and ${MAX_EXPIRY_DAYS} days, or left empty.` }, 400);
      }

      const { count, error: countErr } = await db
        .from("api_keys")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("revoked_at", null);
      if (countErr) throw countErr;
      if ((count ?? 0) >= MAX_ACTIVE_KEYS) {
        return json({ error: "too_many_keys", message: `You can have up to ${MAX_ACTIVE_KEYS} active keys. Revoke one first.` }, 400);
      }

      const key = generateApiKey();
      const key_hash = await hashApiKey(key);
      const { data, error } = await db
        .from("api_keys")
        .insert({ user_id: user.id, name, key_prefix: displayPrefix(key), key_hash, expires_at })
        .select(ITEM_COLUMNS)
        .single();
      if (error) throw error;
      return json({ key, item: data });
    }

    if (action === "revoke") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "invalid_id", message: "Unknown key." }, 400);
      const { data, error } = await db
        .from("api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", user.id)
        .is("revoked_at", null)
        .select(ITEM_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "not_found", message: "That key does not exist or is already revoked." }, 404);
      return json({ item: data });
    }

    return json({ error: "unknown_action", message: "action must be create, revoke or list." }, 400);
  } catch (e) {
    console.error("[api-keys]", String(e));
    return json({ error: "server_error", message: "Could not update API keys right now." }, 500);
  }
});

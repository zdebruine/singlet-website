/**
 * Personal API keys — the one place that knows how a key looks and hashes.
 *
 *   sk_live_<40 url-safe chars>
 *
 * Only `sha256(key)` is stored (public.api_keys.key_hash) together with a
 * display prefix ("sk_live_" + first 8 secret chars). The plain key is shown
 * exactly once, when it is created.
 */
import { service, sha256Hex } from "./quota.ts";

export const KEY_PREFIX = "sk_live_";
export const KEY_SECRET_LENGTH = 40;
export const KEY_RE = /^sk_live_[A-Za-z0-9_-]{20,64}$/;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function looksLikeApiKey(token: string | null | undefined): token is string {
  return !!token && KEY_RE.test(token);
}

export function generateApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_SECRET_LENGTH));
  let secret = "";
  for (const b of bytes) secret += ALPHABET[b % ALPHABET.length];
  return KEY_PREFIX + secret;
}

export function displayPrefix(key: string): string {
  return key.slice(0, KEY_PREFIX.length + 8);
}

export function hashApiKey(key: string): Promise<string> {
  return sha256Hex(key);
}

export interface KeyOwner {
  keyId: string;
  userId: string;
}

export type KeyLookup =
  | { ok: true; owner: KeyOwner }
  | { ok: false; reason: "unknown" | "revoked" | "expired" | "unavailable" };

/** Resolve a key to its owner (service role). Never throws. */
export async function lookupApiKey(key: string): Promise<KeyLookup> {
  try {
    const hash = await hashApiKey(key);
    const { data, error } = await service()
      .from("api_keys")
      .select("id, user_id, expires_at, revoked_at")
      .eq("key_hash", hash)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, reason: "unknown" };
    if (data.revoked_at) return { ok: false, reason: "revoked" };
    if (data.expires_at && Date.parse(data.expires_at) <= Date.now()) return { ok: false, reason: "expired" };
    return { ok: true, owner: { keyId: data.id, userId: data.user_id } };
  } catch (e) {
    console.warn("[api-keys] lookup failed:", String(e));
    return { ok: false, reason: "unavailable" };
  }
}

export function keyErrorMessage(reason: Exclude<KeyLookup, { ok: true }>["reason"]): string {
  switch (reason) {
    case "revoked":
      return "This API key was revoked. Create a new one at https://singlet.bio/account.";
    case "expired":
      return "This API key has expired. Create a new one at https://singlet.bio/account.";
    case "unavailable":
      return "API keys cannot be checked right now. Try again in a minute.";
    default:
      return "Unknown API key. Create one at https://singlet.bio/account.";
  }
}

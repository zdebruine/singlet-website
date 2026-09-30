/**
 * Personal API keys — the one place that knows how a key looks, hashes and is
 * stored (D1 table `api_keys`, schema/010_accounts.sql).
 *
 *   sk_live_<40 chars from [A-Za-z0-9]>
 *
 * Only sha256(key) is stored, together with a display prefix ("sk_live_" + the
 * first 8 secret characters). The plain key is returned exactly once, by
 * createKey. Checking a key on an incoming request is identity.ts
 * (checkApiKey); this file only mints, lists and revokes.
 */
import { sha256Hex } from "./hash";
import { nowIso } from "./session";

export const KEY_PREFIX = "sk_live_";
export const KEY_SECRET_LENGTH = 40;
export const MAX_ACTIVE_KEYS = 20;
export const MAX_EXPIRY_DAYS = 365 * 2;
export const MAX_NAME_LENGTH = 60;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** Bytes at or above the largest multiple of 62 are redrawn, so every character is equally likely. */
const UNBIASED_BELOW = 256 - (256 % ALPHABET.length);

const ITEM_COLUMNS = "id, name, key_prefix, created_at, last_used_at, expires_at, revoked_at";

/** What the account page sees for a key; never the key or its hash. */
export interface ApiKeyItem {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export function generateApiKey(): string {
  let secret = "";
  while (secret.length < KEY_SECRET_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(KEY_SECRET_LENGTH))) {
      if (b < UNBIASED_BELOW && secret.length < KEY_SECRET_LENGTH) secret += ALPHABET[b % ALPHABET.length];
    }
  }
  return KEY_PREFIX + secret;
}

export function displayPrefix(key: string): string {
  return key.slice(0, KEY_PREFIX.length + 8);
}

export function hashApiKey(key: string): Promise<string> {
  return sha256Hex(key);
}

/** Collapse whitespace and trim; null unless 1–60 characters remain. */
export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = v.replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > MAX_NAME_LENGTH) return null;
  return name;
}

/**
 * `expires_in_days` → an ISO expiry. Empty/null means the key never expires;
 * anything else must be 1–730 days (numeric strings are accepted, fractions
 * are floored).
 */
export function expiryFromDays(v: unknown, now = Date.now()): { ok: true; expiresAt: string | null } | { ok: false } {
  if (v === null || v === undefined || v === "") return { ok: true, expiresAt: null };
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  if (!Number.isFinite(n) || n < 1 || n > MAX_EXPIRY_DAYS) return { ok: false };
  return { ok: true, expiresAt: nowIso(now + Math.floor(n) * 86_400_000) };
}

/** Key ids are uuids (crypto.randomUUID). */
export function isKeyId(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
}

/** Every key the user has ever made, newest first (revoked and expired included). */
export async function listKeys(db: D1Database, userId: string): Promise<ApiKeyItem[]> {
  const rows = await db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM api_keys WHERE user_id = ?1 ORDER BY created_at DESC, rowid DESC`)
    .bind(userId)
    .all<ApiKeyItem>();
  return rows.results ?? [];
}

export type CreateKeyResult = { ok: true; key: string; item: ApiKeyItem } | { ok: false; reason: "too_many_keys" };

/**
 * Mint a key. The active-key cap (non-revoked, non-expired) is checked inside
 * the INSERT itself, so two tabs creating keys at once can never exceed it.
 */
export async function createKey(db: D1Database, userId: string, name: string, expiresAt: string | null): Promise<CreateKeyResult> {
  const key = generateApiKey();
  const now = nowIso();
  const item = await db
    .prepare(
      `INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, created_at, expires_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
        WHERE (SELECT COUNT(*) FROM api_keys
                WHERE user_id = ?2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?6)) < ?8
       RETURNING ${ITEM_COLUMNS}`,
    )
    .bind(crypto.randomUUID(), userId, name, displayPrefix(key), await hashApiKey(key), now, expiresAt, MAX_ACTIVE_KEYS)
    .first<ApiKeyItem>();
  return item ? { ok: true, key, item } : { ok: false, reason: "too_many_keys" };
}

/** Revoke one of the user's own keys; null if it does not exist, is someone else's, or is already revoked. */
export async function revokeKey(db: D1Database, userId: string, id: string): Promise<ApiKeyItem | null> {
  return db
    .prepare(
      `UPDATE api_keys SET revoked_at = ?3
        WHERE id = ?1 AND user_id = ?2 AND revoked_at IS NULL
       RETURNING ${ITEM_COLUMNS}`,
    )
    .bind(id, userId, nowIso())
    .first<ApiKeyItem>();
}

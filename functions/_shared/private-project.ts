import { cloudAnonKey, cloudBase, type CloudEnv } from "./cloud";
import { apiKeyFromRequest, checkApiKey, sha256Hex, userBearer } from "./identity";

export const PROJECT_CAP = 5;
export const FILE_CAP = 20;
export const ACCOUNT_BYTES_CAP = 10 * 1024 ** 3;
export const GLOBAL_BYTES_CAP = 2 * 1024 ** 4;
export const FILE_BYTES_CAP = 2 * 1024 ** 3;
export const PART_BYTES = 50 * 1024 ** 2;

export interface PrivateEnv extends CloudEnv {
  DB: D1Database;
  USER_DATA: R2Bucket;
  PRIVATE_URL_SECRET?: string;
}

export async function productCall<T>(request: Request, env: CloudEnv, action: string, body: Record<string, unknown> = {}): Promise<T> {
  const anon = cloudAnonKey(env);
  const bearer = request.headers.get("Authorization") ?? `Bearer ${anon}`;
  const res = await fetch(`${cloudBase(env)}/functions/v1/product-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon, Authorization: bearer, ...(apiKeyFromRequest(request) ? { "X-API-Key": apiKeyFromRequest(request) ?? "" } : {}) },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json().catch(() => ({})) as T & { message?: string };
  if (!res.ok) throw Object.assign(new Error(data.message ?? `Request failed (${res.status})`), { status: res.status, data });
  return data;
}

export async function requirePrivateIdentity(request: Request, env: CloudEnv, waitUntil: (p: Promise<unknown>) => void): Promise<string | null> {
  const token = userBearer(request, cloudAnonKey(env));
  if (token) return token;
  const key = apiKeyFromRequest(request);
  if (!key) return null;
  const result = await checkApiKey(env, key, waitUntil);
  return result.ok ? key : null;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(prefix: string): string {
  return `${prefix}_${bytesToHex(crypto.getRandomValues(new Uint8Array(24)))}`;
}

export async function signedFileToken(env: PrivateEnv, fileId: string, expires: number): Promise<string> {
  const secret = env.PRIVATE_URL_SECRET;
  if (!secret) throw new Error("Private download signing is not configured");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${fileId}:${expires}`))));
}

export async function validSignedFileToken(env: PrivateEnv, fileId: string, expires: number, token: string): Promise<boolean> {
  if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000) || expires > Math.floor(Date.now() / 1000) + 3700) return false;
  const expected = await signedFileToken(env, fileId, expires);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export { sha256Hex };
/**
 * Cheap presence check for a caller identity (session bearer or API key).
 * Every private endpoint calls this *before* reading a body, fetching a URL
 * or touching the database, so an anonymous request can never cause work.
 */
export function hasPrivateIdentity(request: Request, env: CloudEnv): boolean {
  return Boolean(userBearer(request, cloudAnonKey(env)) || apiKeyFromRequest(request));
}

export function unauthorized(): Response {
  return new Response(
    JSON.stringify({ error: "sign_in_required", message: "Sign in to use private projects, cohorts and workspaces." }),
    { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
}

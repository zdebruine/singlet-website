/** Service-role database client + hashing, shared by every edge function. */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

let serviceClient: SupabaseClient | null = null;
export function service(): SupabaseClient {
  if (serviceClient) return serviceClient;
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  serviceClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return serviceClient;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

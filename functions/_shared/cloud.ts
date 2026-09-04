/**
 * Where the Lovable Cloud backend lives (auth, AI functions, API keys).
 *
 * The anon key is public / client-safe by design, so it is inlined: the
 * catalog API must never depend on a secret typed into a dashboard by hand.
 * Optional env overrides exist for local harnesses and previews.
 */
export interface CloudEnv {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

const DEFAULT_SUPABASE_URL = "https://vbswbitfyallghbgxkuw.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZic3diaXRmeWFsbGdoYmd4a3V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjkzNDksImV4cCI6MjA5MDIwNTM0OX0.GtX_3p0L78p0KqmgNY71ENagf-lugz5FhvhYrtKqLhs";

export function cloudBase(env: CloudEnv): string {
  return (env.SUPABASE_URL ?? DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
}

export function cloudAnonKey(env: CloudEnv): string {
  return env.SUPABASE_ANON_KEY ?? DEFAULT_SUPABASE_ANON_KEY;
}

/** Call a public (anon-executable) database function through the REST API. */
export async function cloudRpc<T>(env: CloudEnv, fn: string, args: Record<string, unknown>, timeoutMs = 4000): Promise<T> {
  const anon = cloudAnonKey(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${cloudBase(env)}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify(args),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`rpc ${fn} → ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

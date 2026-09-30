/**
 * Everything a Pages Function can find on `context.env`.
 *
 * Bindings (wrangler.toml): DB (D1 singlet-catalog), USER_DATA (R2, private
 * uploads), AI (Workers AI / AI Gateway).
 *
 * Plain vars live in wrangler.toml [vars]; secrets are set in the Cloudflare
 * dashboard (Pages → singlet → Settings → Variables and Secrets) for both
 * Production and Preview. Every secret is optional: a missing one turns the
 * feature it powers off cleanly instead of failing the request.
 */
export interface AppEnv {
  DB: D1Database;
  USER_DATA?: R2Bucket;
  AI?: Ai;
  ENVIRONMENT?: string;

  // ── Sign-in (OAuth apps) ────────────────────────────────────────────────
  /** Public client id of the GitHub OAuth app (wrangler.toml var). */
  GITHUB_CLIENT_ID?: string;
  /** Secret. */
  GITHUB_CLIENT_SECRET?: string;
  /** Public client id of the Google OAuth client (var or secret). */
  GOOGLE_CLIENT_ID?: string;
  /** Secret. */
  GOOGLE_CLIENT_SECRET?: string;

  // ── AI search / explanations ────────────────────────────────────────────
  /** Model for query interpretation and explanations. Workers AI ids start "@cf/"; "anthropic/…" etc. route through AI Gateway unified billing. */
  AI_MODEL?: string;
  /** AI Gateway id for logs/caching/rate limits ("default" is created automatically). Empty string disables the gateway. */
  AI_GATEWAY_ID?: string;
  /** Secret, optional: call the Anthropic Messages API directly instead of the AI binding. */
  ANTHROPIC_API_KEY?: string;
  /** Anthropic model id used with ANTHROPIC_API_KEY. */
  ANTHROPIC_MODEL?: string;

  /** Daily budget overrides (integers). */
  AI_LIMIT_SEARCH_ANON?: string;
  AI_LIMIT_SEARCH_USER?: string;
  AI_LIMIT_EXPLAIN_ANON?: string;
  AI_LIMIT_EXPLAIN_USER?: string;

  // ── Ingest ──────────────────────────────────────────────────────────────
  /** sha256 hex of the HPC ingest token. */
  INGEST_TOKEN_SHA256?: string;
}

/** Waits on background work without blocking the response. */
export type WaitUntil = (p: Promise<unknown>) => void;

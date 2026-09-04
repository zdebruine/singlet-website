/**
 * GET /auth/github/callback — the single callback URL registered on the
 * GitHub OAuth App.
 *
 * GitHub allows one callback per app, but sign-in can start from singlet.bio,
 * a *.pages.dev preview or a local dev server. The `state` minted by the
 * `github-oauth` Cloud function carries the starting origin, so this function
 * only has to relay the browser (with the one-time code) back to the SPA at
 * that origin, where /auth/callback finishes the exchange.
 *
 * The state signature is verified by the Cloud function during the exchange;
 * here the origin is merely allow-listed so this can never act as an open
 * redirect.
 */

/** Keep in sync with ORIGIN_RE in supabase/functions/github-oauth/index.ts. */
const ORIGIN_RE =
  /^(https:\/\/(www\.)?singlet\.bio|https:\/\/[a-z0-9-]+\.singlet-4gc\.pages\.dev|https:\/\/[a-z0-9.-]+\.(lovable\.app|lovableproject\.com)|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/i;

const FALLBACK_ORIGIN = "https://singlet.bio";

function originFromState(state: string | null): string | null {
  if (!state) return null;
  const body = state.split(".")[0];
  if (!body) return null;
  try {
    const pad = body.length % 4 === 0 ? "" : "=".repeat(4 - (body.length % 4));
    const text = atob(body.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const payload = JSON.parse(text) as { o?: unknown };
    return typeof payload.o === "string" && ORIGIN_RE.test(payload.o) ? payload.o.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

export const onRequestGet: PagesFunction = async ({ request }) => {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const origin = originFromState(state);

  const target = new URL("/auth/callback", origin ?? FALLBACK_ORIGIN);
  target.searchParams.set("provider", "github");

  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (!origin) {
    target.searchParams.set("error", "invalid_state");
  } else if (error) {
    target.searchParams.set("error", error);
    const desc = url.searchParams.get("error_description");
    if (desc) target.searchParams.set("error_description", desc);
  } else if (code && state) {
    target.searchParams.set("code", code);
    target.searchParams.set("state", state);
  } else {
    target.searchParams.set("error", "missing_code");
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
};

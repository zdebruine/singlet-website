/**
 * POST /api/beta-signup — the Beta sign-up form on /beta (D1 table `beta_signups`, schema/037_beta_signups.sql).
 *
 * Body: { email, name?, institution?, role?, interests?, updates?: boolean, website? }
 * Anyone can sign up; each sender is limited to a few new sign-ups per hour. A signed-in visitor's account id is attached.
 * `website` is a hidden field that people never fill in: a filled value is dropped silently. A repeat sign-up with the
 * same address answers { ok: true } and changes nothing. → { ok: true } | { error, message }.
 */
import type { AppEnv } from "../_shared/env";
import { isSignedIn, resolveIdentity } from "../_shared/identity";
import { parseBetaSignup, saveBetaSignup, underLimit } from "../_shared/beta-signup";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

export const onRequest: PagesFunction<AppEnv> = async ({ request, env, waitUntil }) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed", message: "POST only." }, 405, { Allow: "POST" });

  const who = await resolveIdentity(request, env, waitUntil);
  if ("response" in who) return who.response;

  const raw: unknown = await request.json().catch(() => null);
  const body = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!body) return json({ error: "invalid_body", message: "Send a JSON body with an email address." }, 400);
  if (typeof body.website === "string" && body.website.trim()) return json({ ok: true });

  const parsed = parseBetaSignup(body);
  if ("message" in parsed) return json({ error: "invalid_signup", message: parsed.message }, 400);

  const { identity } = who;
  const { value } = parsed;
  try {
    if (!(await underLimit(env.DB, identity.subject))) {
      return json({ error: "rate_limited", message: "That is a few sign-ups in a short time. Please try again in an hour." }, 429);
    }
    await saveBetaSignup(env.DB, { subject: identity.subject, userId: isSignedIn(identity) ? identity.userId : null }, value);
    return json({ ok: true });
  } catch {
    return json({ error: "signup_unavailable", message: "The sign-up could not be saved right now. Try again shortly." }, 503);
  }
};

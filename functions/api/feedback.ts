/**
 * POST /api/feedback — the site's feedback form (D1 table `feedback`).
 *
 * Body: { message, category?: "bug"|"data"|"idea"|"other", email?, page?, website? }
 * Anyone can send one; each sender is limited to a few per hour. `website` is a hidden field that
 * people never fill in: a filled value is dropped silently. → { ok: true } | { error, message }.
 */
import type { AppEnv } from "../_shared/env";
import { isSignedIn, resolveIdentity } from "../_shared/identity";
import { parseFeedback, saveFeedback, underLimit } from "../_shared/feedback";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

export const onRequest: PagesFunction<AppEnv> = async ({ request, env, waitUntil }) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed", message: "POST only." }, 405, { Allow: "POST" });

  const who = await resolveIdentity(request, env, waitUntil);
  if (!who.ok) return who.response;

  const raw: unknown = await request.json().catch(() => null);
  const body = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!body) return json({ error: "invalid_body", message: "Send a JSON body with a message." }, 400);
  if (typeof body.website === "string" && body.website.trim()) return json({ ok: true });

  const parsed = parseFeedback(body);
  if (!parsed.ok) return json({ error: "invalid_feedback", message: parsed.message }, 400);

  const { identity } = who;
  try {
    if (!(await underLimit(env.DB, identity.subject))) {
      return json({ error: "rate_limited", message: "That is a few messages in a short time. Please try again in an hour." }, 429);
    }
    await saveFeedback(
      env.DB,
      { subject: identity.subject, userId: isSignedIn(identity) ? identity.userId : null, userAgent: request.headers.get("User-Agent") },
      parsed.value,
    );
    return json({ ok: true });
  } catch {
    return json({ error: "feedback_unavailable", message: "Feedback could not be saved right now. Try again shortly." }, 503);
  }
};

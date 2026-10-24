/**
 * POST /api/connections — the signed-in user's connected apps: MCP clients (such as a Claude
 * connector) they approved through /oauth/consent (D1 oauth_grants, ../_shared/mcp-oauth).
 *
 * Browser session only, like /api/keys: a connected app or API key can never list or end
 * connections. Body:
 *   { action: "list" }               → { items: ConnectionItem[] }  (live connections, newest first)
 *   { action: "revoke", id: string } → { ok: true }  (ends every token of that connection)
 *
 * ConnectionItem = { id, client_name, created_at, last_used_at }
 */
import type { AppEnv } from "../_shared/env";
import { requireUser } from "../_shared/identity";
import { listConnections, revokeConnection } from "../_shared/mcp-oauth";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const onRequest: PagesFunction<AppEnv> = async ({ request, env, waitUntil }) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed", message: "POST only." }, 405, { Allow: "POST" });

  const who = await requireUser(request, env, waitUntil, "Sign in to manage connected apps.");
  if (!who.ok) return who.response;
  if (who.identity.kind !== "session") {
    return json({ error: "session_required", message: "Manage connected apps from https://singlet.bio/account." }, 403);
  }
  const userId = who.identity.userId;

  const raw: unknown = await request.json().catch(() => null);
  const body = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  try {
    if (body.action === "list") return json({ items: await listConnections(env.DB, userId) });
    if (body.action === "revoke") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!UUID_RE.test(id) || !(await revokeConnection(env.DB, userId, id))) {
        return json({ error: "not_found", message: "No such connection." }, 404);
      }
      return json({ ok: true });
    }
    return json({ error: "invalid_action", message: "action must be list or revoke." }, 400);
  } catch (e) {
    console.error("connections:", e instanceof Error ? e.message : String(e));
    return json({ error: "unavailable", message: "Connected apps cannot be loaded right now. Try again in a minute." }, 503);
  }
};

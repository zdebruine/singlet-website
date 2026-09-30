/**
 * POST /api/product — private projects, cohorts and workspaces (action router).
 *
 * Body: {"action": "<name>", ...fields}. The implementations live in
 * _shared/product.ts on D1:
 *
 *   dashboard · create_project · get_project · list_private_studies ·
 *   get_private_study · get_file · delete_file · delete_project ·
 *   create_workspace · get_workspace · invite_workspace · accept_invite ·
 *   save_cohort · get_cohort · comment_cohort · set_weekly_summary · log_usage
 *
 * Every action needs a signed-in caller (session cookie on a same-origin
 * request, or an API key) except get_cohort, which also works anonymously
 * with the cohort's share token.
 *
 * Errors are {error, message}: 400 validation / unknown action, 401
 * sign_in_required or invalid_api_key, 403, 404, 409 caps and conflicts, 410
 * used invites, 503 storage paused. Anything but POST → 405.
 *
 * Uploads, URL registration and indexing are not actions here: they run
 * through /api/projects/:id/upload/* so a client can never pick an R2 object
 * key or hand in its own index.
 */
import type { AppEnv } from "../_shared/env";
import { handleOptions } from "../_shared/cors";
import { isSignedIn, requireUser, resolveIdentity } from "../_shared/identity";
import { deleteFile, deleteProject, isProductAction, productErrorResponse, productJson, runProductAction } from "../_shared/product";
import { productContext, removeObjects } from "../_shared/private-project";

export const onRequest: PagesFunction<AppEnv> = async ({ request, env, waitUntil }) => {
  const method = request.method.toUpperCase();
  if (method === "OPTIONS") return handleOptions();
  if (method !== "POST") return productJson({ error: "method", message: "POST only." }, 405);

  const raw: unknown = await request.json().catch(() => null);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return productJson({ error: "invalid_body", message: "action is required." }, 400);
  const body = raw as Record<string, unknown>;
  const action = body.action;
  if (typeof action !== "string") return productJson({ error: "invalid_body", message: "action is required." }, 400);
  if (action !== "delete_file" && action !== "delete_project" && !isProductAction(action)) {
    return productJson({ error: "unknown_action", message: `Unknown action '${action.slice(0, 80)}'.` }, 400);
  }

  const ctx = productContext(request, env);
  try {
    if (action === "get_cohort") {
      const who = await resolveIdentity(request, env, waitUntil);
      if (!who.ok) return who.response;
      return productJson(await runProductAction(ctx, isSignedIn(who.identity) ? who.identity.userId : null, action, body));
    }

    const who = await requireUser(request, env, waitUntil);
    if (!who.ok) return who.response;
    const uid = who.identity.userId;

    // Deletes also remove the stored objects, so they are routed here rather than in product.ts.
    if (action === "delete_file") {
      const result = await deleteFile(ctx, uid, body);
      await removeObjects(env.USER_DATA, result.object_key ? [result.object_key] : []);
      return productJson({ ok: true });
    }
    if (action === "delete_project") {
      const result = await deleteProject(ctx, uid, body);
      await removeObjects(env.USER_DATA, result.object_keys);
      return productJson({ ok: true });
    }

    return productJson(await runProductAction(ctx, uid, action, body));
  } catch (e) {
    return productErrorResponse(e, action);
  }
};

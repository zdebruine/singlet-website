/**
 * GET    /api/projects/:id — one private project (same body as the get_project action).
 * DELETE /api/projects/:id — the project, its files, indexed studies, stored objects and unfinished uploads (owner only).
 */
import type { AppEnv } from "../../_shared/env";
import { requireUser } from "../../_shared/identity";
import { deleteProject, getProject } from "../../_shared/product";
import { abortUploads, json, productContext, removeObjects, routeError } from "../../_shared/private-project";

export const onRequestGet: PagesFunction<AppEnv> = async ({ request, env, params, waitUntil }) => {
  const who = await requireUser(request, env, waitUntil);
  if (!who.ok) return who.response;
  try {
    return json(await getProject(productContext(request, env), who.identity.userId, { id: String(params.id ?? "") }));
  } catch (e) {
    return routeError(e, "Project not found.");
  }
};

export const onRequestDelete: PagesFunction<AppEnv> = async ({ request, env, params, waitUntil }) => {
  const who = await requireUser(request, env, waitUntil);
  if (!who.ok) return who.response;
  try {
    const result = await deleteProject(productContext(request, env), who.identity.userId, { id: String(params.id ?? "") });
    await abortUploads(env.USER_DATA, result.uploads);
    await removeObjects(env.USER_DATA, result.object_keys);
    return json({ ok: true });
  } catch (e) {
    return routeError(e, "Could not delete project.");
  }
};

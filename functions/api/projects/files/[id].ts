/** DELETE /api/projects/files/:id — one private file, what was indexed from it, its stored object and any unfinished upload (owner only). */
import type { AppEnv } from "../../../_shared/env";
import { requireUser } from "../../../_shared/identity";
import { deleteFile } from "../../../_shared/product";
import { abortUploads, json, productContext, removeObjects, routeError } from "../../../_shared/private-project";

export const onRequestDelete: PagesFunction<AppEnv> = async ({ request, env, params, waitUntil }) => {
  const who = await requireUser(request, env, waitUntil);
  if (!who.ok) return who.response;
  try {
    const result = await deleteFile(productContext(request, env), who.identity.userId, { id: String(params.id ?? "") });
    await abortUploads(env.USER_DATA, result.uploads);
    await removeObjects(env.USER_DATA, result.object_key ? [result.object_key] : []);
    return json({ ok: true });
  } catch (e) {
    return routeError(e, "Could not delete file.");
  }
};

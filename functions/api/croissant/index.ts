/**
 * GET /api/croissant
 * The atlas Croissant document (the same as /croissant.json). Public; a key that is sent must be valid, as for /api/stats.
 */
import { atlasDocument, type CroissantEnv } from "../../_shared/croissant-routes";
import { handleOptions } from "../../_shared/cors";
import { resolveIdentity } from "../../_shared/identity";

export const onRequestGet: PagesFunction<CroissantEnv> = async (ctx) => {
  const id = await resolveIdentity(ctx.request, ctx.env, ctx.waitUntil);
  if (!id.ok) return id.response;
  return atlasDocument(ctx);
};

export const onRequestOptions: PagesFunction<CroissantEnv> = async () => handleOptions();

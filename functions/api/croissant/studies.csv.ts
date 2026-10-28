/**
 * GET /api/croissant/studies.csv
 * The atlas Croissant document's `studies` record set: one row per downloadable study.
 */
import { atlasStudiesCsv, type CroissantEnv } from "../../_shared/croissant-routes";
import { handleOptions } from "../../_shared/cors";
import { resolveIdentity } from "../../_shared/identity";

export const onRequestGet: PagesFunction<CroissantEnv> = async (ctx) => {
  const id = await resolveIdentity(ctx.request, ctx.env, ctx.waitUntil);
  if (!id.ok) return id.response;
  return atlasStudiesCsv(ctx);
};

export const onRequestOptions: PagesFunction<CroissantEnv> = async () => handleOptions();

/**
 * GET /api/croissant/:gse
 * Croissant metadata of one study. A withheld, unknown or not-downloadable study answers 404.
 */
import { studyResource, type CroissantEnv } from "../../_shared/croissant-routes";
import { handleOptions } from "../../_shared/cors";
import { resolveIdentity } from "../../_shared/identity";

export const onRequestGet: PagesFunction<CroissantEnv> = async (ctx) => {
  const id = await resolveIdentity(ctx.request, ctx.env, ctx.waitUntil);
  if (!id.ok) return id.response;
  return studyResource(ctx, String(ctx.params.id ?? ""), { kind: "study" });
};

export const onRequestOptions: PagesFunction<CroissantEnv> = async () => handleOptions();

/**
 * GET /api/croissant/:gse/samples.csv
 * The `samples` record set of a study's Croissant document.
 */
import { studyResource, type CroissantEnv } from "../../../_shared/croissant-routes";
import { handleOptions } from "../../../_shared/cors";
import { resolveIdentity } from "../../../_shared/identity";

export const onRequestGet: PagesFunction<CroissantEnv> = async (ctx) => {
  const id = await resolveIdentity(ctx.request, ctx.env, ctx.waitUntil);
  if (!id.ok) return id.response;
  return studyResource(ctx, String(ctx.params.id ?? ""), { kind: "samples.csv" });
};

export const onRequestOptions: PagesFunction<CroissantEnv> = async () => handleOptions();

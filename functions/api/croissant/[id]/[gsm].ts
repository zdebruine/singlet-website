/**
 * GET /api/croissant/:gse/:gsm
 * Croissant metadata of one sample of a study (its cells record set reads that sample's label sidecar alone). A sample the study
 * does not serve answers 404.
 */
import { studyResource, type CroissantEnv } from "../../../_shared/croissant-routes";
import { handleOptions } from "../../../_shared/cors";
import { resolveIdentity } from "../../../_shared/identity";

export const onRequestGet: PagesFunction<CroissantEnv> = async (ctx) => {
  const id = await resolveIdentity(ctx.request, ctx.env, ctx.waitUntil);
  if (!id.ok) return id.response;
  return studyResource(ctx, String(ctx.params.id ?? ""), { kind: "sample", gsm: String(ctx.params.gsm ?? "") });
};

export const onRequestOptions: PagesFunction<CroissantEnv> = async () => handleOptions();

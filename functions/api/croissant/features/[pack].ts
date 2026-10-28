/**
 * GET /api/croissant/features/:pack.csv
 * The `features` record set: the genes of an exon pack (s1/ref/<pack>.pack) and the matrix rows each one owns.
 */
import { featuresResource, type CroissantEnv } from "../../../_shared/croissant-routes";
import { handleOptions } from "../../../_shared/cors";
import { resolveIdentity } from "../../../_shared/identity";

export const onRequestGet: PagesFunction<CroissantEnv> = async (ctx) => {
  const id = await resolveIdentity(ctx.request, ctx.env, ctx.waitUntil);
  if (!id.ok) return id.response;
  return featuresResource(ctx, String(ctx.params.pack ?? ""));
};

export const onRequestOptions: PagesFunction<CroissantEnv> = async () => handleOptions();

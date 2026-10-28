/**
 * GET /croissant.json
 * MLCommons Croissant 1.1 metadata (JSON-LD, with the RAI vocabulary) of the Research Alpha atlas: the same document as
 * /api/croissant. See ./_shared/croissant and docs/CROISSANT.md.
 */
import { atlasDocument, type CroissantEnv } from "./_shared/croissant-routes";
import { handleOptions } from "./_shared/cors";

export const onRequestGet: PagesFunction<CroissantEnv> = (ctx) => atlasDocument(ctx);
export const onRequestOptions: PagesFunction<CroissantEnv> = async () => handleOptions();

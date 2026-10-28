/**
 * GET|POST /api/cells/slice — the cells of a cell search, one page at a time (functions/_shared/cells/slice.ts; docs/CELL-SEARCH.md).
 *
 * Same filter parameters as /api/cells, plus page_cells (<= 10,000, default 5,000), cursor (next_cursor of the last page) and
 * modalities. Each page: the cells as [GSM, [columns]] (the input of singlet.s1.atlas.gather), the byte ranges of their matrix chunks
 * per sample object, and the body that streams them in one `POST data.singlet.bio/s1/cidx/gather`. An `Authorization: Bearer` API key
 * is forwarded to the data Worker so the key's allowance applies.
 */
import { handleOptions } from "../../_shared/cors";
import type { AppEnv } from "../../_shared/env";
import { resolveIdentity } from "../../_shared/identity";
import { errorResponse, parseCellRequest, sliceResponse } from "../../_shared/cells/http";

async function handle(request: Request, env: AppEnv, waitUntil: (p: Promise<unknown>) => void, body: Record<string, unknown> | null): Promise<Response> {
  const id = await resolveIdentity(request, env, waitUntil);
  if (!id.ok) return id.response;
  try {
    return await sliceResponse(env, request, waitUntil, parseCellRequest(new URL(request.url), body), id.identity);
  } catch (e) {
    return errorResponse(e, "slice");
  }
}

export const onRequestGet: PagesFunction<AppEnv> = ({ request, env, waitUntil }) => handle(request, env, waitUntil, null);

export const onRequestPost: PagesFunction<AppEnv> = async ({ request, env, waitUntil }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(request, env, waitUntil, body);
};

export const onRequestOptions: PagesFunction<AppEnv> = () => handleOptions();

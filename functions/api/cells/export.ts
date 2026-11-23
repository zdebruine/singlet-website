/**
 * GET|POST /api/cells/export — the cells of a cell search as files: a zip of matrix.mtx.gz, features.tsv.gz, barcodes.tsv.gz and
 * obs.tsv.gz (10x layout; scanpy.read_10x_mtx, Seurat::Read10X), or with format=summary per-cell-type means of the given genes (JSON).
 * Same filter parameters as /api/cells, plus genes, max_cells (<= 10,000, default 2,000), modality (counts | spliced | unspliced) and
 * cursor (from the X-Export-Next link of the previous page). No account needed. functions/_shared/cells/export.ts; docs/CELL-SEARCH.md.
 */
import { handleOptions } from "../../_shared/cors";
import type { AppEnv } from "../../_shared/env";
import { resolveIdentity } from "../../_shared/identity";
import { errorResponse } from "../../_shared/cells/http";
import { exportResponse, parseExportRequest } from "../../_shared/cells/export";

async function handle(request: Request, env: AppEnv, waitUntil: (p: Promise<unknown>) => void, body: Record<string, unknown> | null): Promise<Response> {
  const id = await resolveIdentity(request, env, waitUntil);
  if (!id.ok) return id.response;
  try {
    return await exportResponse(env, request, waitUntil, parseExportRequest(new URL(request.url), body), id.identity);
  } catch (e) {
    return errorResponse(e, "export");
  }
}

export const onRequestGet: PagesFunction<AppEnv> = ({ request, env, waitUntil }) => handle(request, env, waitUntil, null);

export const onRequestPost: PagesFunction<AppEnv> = async ({ request, env, waitUntil }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(request, env, waitUntil, body);
};

export const onRequestOptions: PagesFunction<AppEnv> = () => handleOptions();

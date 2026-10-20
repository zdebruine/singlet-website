/**
 * GET /api/ingest/export?table=samples|studies|sample_attr&after=<cursor>&limit=<n> — token-gated, paged, read-only
 * export of the rows the cohort bit index is built from (see ../../_shared/index-export). The nightly search-index
 * Action pages through it, builds the index and POSTs it to /api/ingest/search-index.
 *
 * Auth: `X-Ingest-Token`, as the other /api/ingest routes. Answers `{table, columns, rows, next}`; `next` is the
 * `after` for the following page and null on the last. Start with an empty `after`. `limit` is 1..5000 (default 1000).
 * Pages Functions prefer this static file over ./[table].ts; it exports GET only.
 */
import { serverError } from "../../_shared/errors";
import { checkIngestToken } from "../../_shared/ingest-auth";
import { EXPORT_MAX_LIMIT, EXPORT_TABLES, exportPage, parseExportLimit, type ExportTable } from "../../_shared/index-export";

interface Env {
  DB: D1Database;
  INGEST_TOKEN_SHA256?: string;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await checkIngestToken(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);

  const url = new URL(request.url);
  const table = url.searchParams.get("table") ?? "";
  if (!(EXPORT_TABLES as readonly string[]).includes(table)) return json({ error: `table must be one of ${EXPORT_TABLES.join(", ")}` }, 400);
  const limit = parseExportLimit(url.searchParams.get("limit"));
  if (limit == null) return json({ error: `limit must be an integer from 1 to ${EXPORT_MAX_LIMIT}` }, 400);
  const after = url.searchParams.get("after") ?? "";
  if (after.length > 64 || !/^[A-Za-z0-9_.-]*$/.test(after)) return json({ error: "after is not a cursor from this endpoint" }, 400);

  try {
    return json(await exportPage(env.DB, table as ExportTable, after, limit), 200);
  } catch (e) {
    return serverError(e, "index export", { table });
  }
};

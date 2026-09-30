/**
 * GET /api/projects/:id/:study[?token=spr_…] — download (or range-read) one
 * private study's .singlet. Allowed for the owner, workspace members when the
 * project is shared with the workspace, or anyone holding the project's read
 * token — the loader token is the only anonymous way in.
 */
import type { AppEnv } from "../../../_shared/env";
import { isSignedIn, resolveIdentity, signInRequired } from "../../../_shared/identity";
import { authorizePrivateFile, logUsage } from "../../../_shared/product";
import { json, productContext, routeError, storageUnavailable } from "../../../_shared/private-project";

export const onRequestGet: PagesFunction<AppEnv> = async ({ request, env, params, waitUntil }) => {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const who = await resolveIdentity(request, env, waitUntil);
  if (!who.ok) return who.response;
  const uid = isSignedIn(who.identity) ? who.identity.userId : null;
  // A project read token is the only anonymous route into a private file.
  if (!uid && !token) return signInRequired();
  const ctx = productContext(request, env);
  try {
    const { file } = await authorizePrivateFile(ctx, uid, { project_id: String(params.id ?? ""), study_id: String(params.study ?? ""), read_token: token });
    const range = request.headers.get("Range") ?? undefined;
    const filename = String(file.filename).replace(/["\r\n]/g, "");
    let upstream: Response;
    if (file.kind === "upload" && typeof file.object_key === "string") {
      if (!env.USER_DATA) return storageUnavailable();
      const parsed = range?.match(/^bytes=(\d+)-(\d*)$/);
      const object = await env.USER_DATA.get(file.object_key, parsed ? { range: { offset: Number(parsed[1]), ...(parsed[2] ? { length: Number(parsed[2]) - Number(parsed[1]) + 1 } : {}) } } : undefined);
      if (!object) return json({ error: "not_found", message: "The stored file could not be found." }, 404);
      const headers = new Headers({ "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${filename}"`, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", ETag: object.etag });
      if (object.range) {
        const offset = "offset" in object.range && typeof object.range.offset === "number" ? object.range.offset : 0;
        const length = "length" in object.range && typeof object.range.length === "number" ? object.range.length : object.size;
        headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
        headers.set("Content-Length", String(length));
      } else headers.set("Content-Length", String(object.size));
      upstream = new Response(object.body, { status: object.range ? 206 : 200, headers });
    } else if (typeof file.source_url === "string") {
      upstream = await fetch(file.source_url, { headers: range ? { Range: range } : {}, redirect: "follow" });
      const headers = new Headers(upstream.headers);
      headers.set("Cache-Control", "private, no-store");
      headers.set("Content-Disposition", `attachment; filename="${filename}"`);
      upstream = new Response(upstream.body, { status: upstream.status, headers });
    } else return json({ error: "not_found", message: "The file has no readable source." }, 404);
    // Token-only (anonymous) downloads have no account to log against.
    if (uid) {
      const bytes = Math.max(0, Math.floor(Number(file.bytes) || 0));
      waitUntil(logUsage(ctx, uid, { tool: "private_file", kind: range ? "partial_download" : "download", bytes }).catch(() => undefined));
    }
    return upstream;
  } catch (e) {
    return routeError(e, "Private file not found.", 404, "not_found");
  }
};

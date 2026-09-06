import { hasPrivateIdentity, productCall, unauthorized, type PrivateEnv } from "../../../_shared/private-project";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const onRequestGet: PagesFunction<PrivateEnv> = async ({ request, env, params, waitUntil }) => {
  if (!hasPrivateIdentity(request, env)) return unauthorized();
  const url = new URL(request.url);
  const projectId = String(params.id ?? "");
  const studyId = String(params.study ?? "");
  try {
    const auth = await productCall<{ file: Record<string, unknown> }>(request, env, "authorize_private_file", { project_id: projectId, study_id: studyId, read_token: url.searchParams.get("token") });
    const file = auth.file;
    const range = request.headers.get("Range") ?? undefined;
    let upstream: Response;
    if (file.kind === "upload" && typeof file.object_key === "string") {
      const parsed = range?.match(/^bytes=(\d+)-(\d*)$/);
      const object = await env.USER_DATA.get(file.object_key, parsed ? { range: { offset: Number(parsed[1]), ...(parsed[2] ? { length: Number(parsed[2]) - Number(parsed[1]) + 1 } : {}) } } : undefined);
      if (!object) return json({ error: "not_found", message: "The stored file could not be found." }, 404);
      const headers = new Headers({ "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${String(file.filename).replace(/["\r\n]/g, "")}"`, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", ETag: object.etag });
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
      headers.set("Content-Disposition", `attachment; filename="${String(file.filename).replace(/["\r\n]/g, "")}"`);
      upstream = new Response(upstream.body, { status: upstream.status, headers });
    } else return json({ error: "not_found", message: "The file has no readable source." }, 404);
    waitUntil(productCall(request, env, "log_usage", { tool: "private_file", kind: range ? "partial_download" : "download", bytes: Number(file.bytes ?? 0) }).catch(() => undefined));
    return upstream;
  } catch (e) {
    return json({ error: "not_found", message: e instanceof Error ? e.message : "Private file not found." }, Number((e as { status?: number })?.status) || 404);
  }
};
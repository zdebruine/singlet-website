import { httpBundleSource, r2BundleSource } from "../../../../_shared/bundle-reader";
import { indexPrivateBundle, assertPublicBundleUrl } from "../../../../_shared/private-indexer";
import { FILE_BYTES_CAP, hasPrivateIdentity, PART_BYTES, productCall, unauthorized, type PrivateEnv } from "../../../../_shared/private-project";

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const error = (e: unknown) => json({ error: "request_failed", message: e instanceof Error ? e.message : "Could not complete the upload." }, Number((e as { status?: number })?.status) || 400);

async function indexAndFinish(request: Request, env: PrivateEnv, source: ReturnType<typeof httpBundleSource>, file: Record<string, unknown>, waitUntil: (p: Promise<unknown>) => void) {
  const indexed = await indexPrivateBundle(env.DB, source, String(file.filename ?? "private-study").replace(/\.singlet$/i, ""), waitUntil);
  return productCall<{ study: unknown }>(request, env, "finish_index", { file_id: file.id, bytes: indexed.bytes, etag: file.etag ?? null, study: indexed.study, samples: indexed.samples, qc: indexed.qc });
}

export const onRequestPost: PagesFunction<PrivateEnv> = async ({ request, env, params, waitUntil }) => {
  if (!hasPrivateIdentity(request, env)) return unauthorized();
  const action = String(params.action ?? "");
  const projectId = String(params.id ?? "");
  try {
    if (action === "init") {
      const body = await request.json<Record<string, unknown>>();
      const filename = String(body.filename ?? "");
      const bytes = Number(body.bytes);
      if (!Number.isInteger(bytes) || bytes <= 0 || bytes > FILE_BYTES_CAP) return json({ error: "invalid_size", message: "Choose a .singlet file up to 2 GB." }, 400);
      const begun = await productCall<{ file: Record<string, unknown>; object_key: string }>(request, env, "begin_file", { project_id: projectId, filename, bytes, kind: "upload" });
      try {
        const upload = await env.USER_DATA.createMultipartUpload(begun.object_key);
        await productCall(request, env, "set_multipart", { file_id: begun.file.id, upload_id: upload.uploadId, object_key: begun.object_key, expected_bytes: bytes });
        return json({ file_id: begun.file.id, part_bytes: PART_BYTES, parts: Math.ceil(bytes / PART_BYTES), expires_in: 86400 });
      } catch (e) {
        await productCall(request, env, "mark_file_failed", { file_id: begun.file.id, error: String(e) }).catch(() => undefined);
        throw e;
      }
    }

    if (action === "complete") {
      const body = await request.json<{ file_id?: string; parts?: { partNumber: number; etag: string }[] }>();
      const state = await productCall<{ upload: Record<string, unknown> }>(request, env, "get_multipart", { file_id: body.file_id });
      const parts = Array.isArray(body.parts) ? body.parts : [];
      if (!parts.length || parts.some((p, i) => p.partNumber !== i + 1 || !p.etag)) return json({ error: "invalid_parts", message: "Upload parts are missing or out of order." }, 400);
      const upload = env.USER_DATA.resumeMultipartUpload(String(state.upload.object_key), String(state.upload.r2_upload_id));
      const object = await upload.complete(parts);
      if (object.size !== Number(state.upload.expected_bytes)) {
        await env.USER_DATA.delete(String(state.upload.object_key));
        throw new Error("Uploaded byte count does not match the selected file.");
      }
      try {
        const file = { id: body.file_id, filename: (state.upload.user_files as Record<string, unknown>)?.filename, etag: object.etag };
        const done = await indexAndFinish(request, env, r2BundleSource(env.USER_DATA, String(state.upload.object_key)), file, waitUntil);
        return json({ ok: true, file_id: body.file_id, ...done });
      } catch (e) {
        await env.USER_DATA.delete(String(state.upload.object_key));
        await productCall(request, env, "mark_file_failed", { file_id: body.file_id, error: String(e) }).catch(() => undefined);
        throw e;
      }
    }

    if (action === "register") {
      const body = await request.json<Record<string, unknown>>();
      const url = assertPublicBundleUrl(String(body.url ?? ""));
      const head = await fetch(url, { method: "HEAD", redirect: "manual" });
      if (!head.ok || head.status >= 300) throw new Error("The URL must directly serve a public .singlet file.");
      const bytes = Number(head.headers.get("content-length"));
      if (!Number.isInteger(bytes) || bytes <= 0 || bytes > FILE_BYTES_CAP) throw new Error("The remote file must report a size up to 2 GB.");
      const begun = await productCall<{ file: Record<string, unknown> }>(request, env, "begin_file", { project_id: projectId, filename: url.pathname.split("/").pop(), bytes, kind: "url", source_url: url.toString() });
      try {
        const done = await indexAndFinish(request, env, httpBundleSource(url.toString()), begun.file, waitUntil);
        return json({ ok: true, file_id: begun.file.id, ...done });
      } catch (e) {
        await productCall(request, env, "mark_file_failed", { file_id: begun.file.id, error: String(e) }).catch(() => undefined);
        throw e;
      }
    }
    return json({ error: "unknown_action", message: "Use init, complete or register." }, 404);
  } catch (e) { return error(e); }
};

export const onRequestPut: PagesFunction<PrivateEnv> = async ({ request, env, params }) => {
  if (!hasPrivateIdentity(request, env)) return unauthorized();
  if (String(params.action ?? "") !== "part") return json({ error: "unknown_action" }, 404);
  try {
    const url = new URL(request.url);
    const fileId = url.searchParams.get("file_id") ?? "";
    const partNumber = Number(url.searchParams.get("n"));
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 42) return json({ error: "invalid_part", message: "Part number is invalid." }, 400);
    const length = Number(request.headers.get("content-length"));
    if (!Number.isInteger(length) || length <= 0 || length > PART_BYTES) return json({ error: "invalid_part_size", message: "Each upload part must be no larger than 50 MB." }, 400);
    const state = await productCall<{ upload: Record<string, unknown> }>(request, env, "get_multipart", { file_id: fileId });
    const upload = env.USER_DATA.resumeMultipartUpload(String(state.upload.object_key), String(state.upload.r2_upload_id));
    const part = await upload.uploadPart(partNumber, request.body!);
    return json({ partNumber: part.partNumber, etag: part.etag });
  } catch (e) { return error(e); }
};
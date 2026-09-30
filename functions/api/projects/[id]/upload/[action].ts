/**
 * Adding a .singlet to a private project (owner only).
 *
 *   POST /api/projects/:id/upload/init      {filename, bytes} → reserve the file, start an R2 multipart upload
 *   PUT  /api/projects/:id/upload/part?file_id=…&n=…   (≤ 50 MB body) → {partNumber, etag}
 *   POST /api/projects/:id/upload/complete  {file_id, parts} → finish the upload, index it
 *   POST /api/projects/:id/upload/register  {url} → register a public HTTPS .singlet (no storage), index it
 *
 * Indexing reads only the zip directory and small JSON entries
 * (private-indexer.ts) and stores the result in D1 (product.ts finishIndex).
 * A file that cannot be stored or indexed is marked failed and its bytes are
 * removed.
 */
import { httpBundleSource, r2BundleSource, type BundleByteSource } from "../../../../_shared/bundle-reader";
import type { AppEnv, WaitUntil } from "../../../../_shared/env";
import { requireUser } from "../../../../_shared/identity";
import { assertPublicBundleUrl, indexPrivateBundle } from "../../../../_shared/private-indexer";
import {
  FILE_BYTES_CAP,
  MAX_PARTS,
  PART_BYTES,
  json,
  productContext,
  readBody,
  routeError,
  storageUnavailable,
} from "../../../../_shared/private-project";
import { beginFile, finishIndex, getMultipart, markFileFailed, setMultipart, type ProductCtx } from "../../../../_shared/product";

async function indexAndFinish(
  ctx: ProductCtx,
  uid: string,
  source: BundleByteSource,
  file: { id: string; filename: string; etag: string | null },
  waitUntil: WaitUntil,
) {
  const indexed = await indexPrivateBundle(ctx.db, source, file.filename.replace(/\.singlet$/i, "") || "private-study", waitUntil);
  return finishIndex(ctx, uid, { file_id: file.id, bytes: indexed.bytes, etag: file.etag, study: indexed.study, samples: indexed.samples, qc: indexed.qc });
}

/** [{partNumber: 1, etag}, {partNumber: 2, etag}, …] in order, or null. */
function uploadedParts(v: unknown): R2UploadedPart[] | null {
  if (!Array.isArray(v) || !v.length || v.length > MAX_PARTS) return null;
  const parts: R2UploadedPart[] = [];
  for (let i = 0; i < v.length; i++) {
    const p: unknown = v[i];
    if (p === null || typeof p !== "object") return null;
    const { partNumber, etag } = p as { partNumber?: unknown; etag?: unknown };
    if (partNumber !== i + 1 || typeof etag !== "string" || !etag) return null;
    parts.push({ partNumber: i + 1, etag });
  }
  return parts;
}

const uploadGone = () => json({ error: "not_found", message: "That upload does not exist or expired." }, 404);

export const onRequestPost: PagesFunction<AppEnv> = async ({ request, env, params, waitUntil }) => {
  const who = await requireUser(request, env, waitUntil);
  if (!who.ok) return who.response;
  const uid = who.identity.userId;
  const ctx = productContext(request, env);
  const action = String(params.action ?? "");
  const projectId = String(params.id ?? "");
  try {
    if (action === "init") {
      const bucket = env.USER_DATA;
      if (!bucket) return storageUnavailable();
      const body = await readBody(request);
      const filename = String(body.filename ?? "");
      const bytes = Number(body.bytes);
      if (!Number.isInteger(bytes) || bytes <= 0 || bytes > FILE_BYTES_CAP) return json({ error: "invalid_size", message: "Choose a .singlet file up to 2 GB." }, 400);
      const begun = await beginFile(ctx, uid, { project_id: projectId, filename, bytes, kind: "upload" });
      try {
        const objectKey = begun.object_key;
        if (!objectKey) throw new Error("The upload could not be reserved.");
        const upload = await bucket.createMultipartUpload(objectKey);
        await setMultipart(ctx, uid, { file_id: begun.file.id, upload_id: upload.uploadId, object_key: objectKey, expected_bytes: bytes });
        return json({ file_id: begun.file.id, part_bytes: PART_BYTES, parts: Math.ceil(bytes / PART_BYTES), expires_in: 86400 });
      } catch (e) {
        await markFileFailed(ctx, uid, { file_id: begun.file.id, error: String(e) }).catch(() => undefined);
        throw e;
      }
    }

    if (action === "complete") {
      const bucket = env.USER_DATA;
      if (!bucket) return storageUnavailable();
      const body = await readBody(request);
      const { upload: state } = await getMultipart(ctx, uid, { file_id: body.file_id });
      if (state.user_files.project_id !== projectId) return uploadGone();
      const parts = uploadedParts(body.parts);
      if (!parts) return json({ error: "invalid_parts", message: "Upload parts are missing or out of order." }, 400);
      const upload = bucket.resumeMultipartUpload(state.object_key, state.r2_upload_id);
      const object = await upload.complete(parts);
      if (object.size !== Number(state.expected_bytes)) {
        const message = "Uploaded byte count does not match the selected file.";
        await bucket.delete(state.object_key).catch(() => undefined);
        await markFileFailed(ctx, uid, { file_id: state.file_id, error: message }).catch(() => undefined);
        throw new Error(message);
      }
      try {
        const done = await indexAndFinish(ctx, uid, r2BundleSource(bucket, state.object_key), { id: state.file_id, filename: state.user_files.filename, etag: object.etag }, waitUntil);
        return json({ ok: true, file_id: state.file_id, ...done });
      } catch (e) {
        await bucket.delete(state.object_key).catch(() => undefined);
        await markFileFailed(ctx, uid, { file_id: state.file_id, error: String(e) }).catch(() => undefined);
        throw e;
      }
    }

    if (action === "register") {
      const body = await readBody(request);
      const url = assertPublicBundleUrl(String(body.url ?? ""));
      const head = await fetch(url.toString(), { method: "HEAD", redirect: "manual" });
      if (!head.ok || head.status >= 300) throw new Error("The URL must directly serve a public .singlet file.");
      const bytes = Number(head.headers.get("content-length"));
      if (!Number.isInteger(bytes) || bytes <= 0 || bytes > FILE_BYTES_CAP) throw new Error("The remote file must report a size up to 2 GB.");
      const begun = await beginFile(ctx, uid, { project_id: projectId, filename: url.pathname.split("/").pop() ?? "", bytes, kind: "url", source_url: url.toString() });
      try {
        const etag = head.headers.get("etag")?.slice(0, 500) ?? null;
        const done = await indexAndFinish(ctx, uid, httpBundleSource(url.toString()), { id: begun.file.id, filename: begun.file.filename, etag }, waitUntil);
        return json({ ok: true, file_id: begun.file.id, ...done });
      } catch (e) {
        await markFileFailed(ctx, uid, { file_id: begun.file.id, error: String(e) }).catch(() => undefined);
        throw e;
      }
    }
    return json({ error: "unknown_action", message: "Use init, complete or register." }, 404);
  } catch (e) {
    return routeError(e, "Could not complete the upload.");
  }
};

export const onRequestPut: PagesFunction<AppEnv> = async ({ request, env, params, waitUntil }) => {
  const who = await requireUser(request, env, waitUntil);
  if (!who.ok) return who.response;
  if (String(params.action ?? "") !== "part") return json({ error: "unknown_action" }, 404);
  const bucket = env.USER_DATA;
  if (!bucket) return storageUnavailable();
  try {
    const url = new URL(request.url);
    const fileId = url.searchParams.get("file_id") ?? "";
    const partNumber = Number(url.searchParams.get("n"));
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) return json({ error: "invalid_part", message: "Part number is invalid." }, 400);
    const length = Number(request.headers.get("content-length"));
    const stream = request.body;
    if (!Number.isInteger(length) || length <= 0 || length > PART_BYTES || !stream) {
      return json({ error: "invalid_part_size", message: "Each upload part must be no larger than 50 MB." }, 400);
    }
    const { upload: state } = await getMultipart(productContext(request, env), who.identity.userId, { file_id: fileId });
    if (state.user_files.project_id !== String(params.id ?? "")) return uploadGone();
    const upload = bucket.resumeMultipartUpload(state.object_key, state.r2_upload_id);
    const part = await upload.uploadPart(partNumber, stream);
    return json({ partNumber: part.partNumber, etag: part.etag });
  } catch (e) {
    return routeError(e, "Could not store that upload part.");
  }
};

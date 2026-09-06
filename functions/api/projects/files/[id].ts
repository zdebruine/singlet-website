import { hasPrivateIdentity, productCall, unauthorized, type PrivateEnv } from "../../../_shared/private-project";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const onRequestDelete: PagesFunction<PrivateEnv> = async ({ request, env, params }) => {
  if (!hasPrivateIdentity(request, env)) return unauthorized();
  try {
    const result = await productCall<{ object_key?: string }>(request, env, "delete_file", { id: String(params.id ?? "") });
    if (result.object_key) await env.USER_DATA.delete(result.object_key);
    return json({ ok: true });
  } catch (e) { return json({ error: "request_failed", message: e instanceof Error ? e.message : "Could not delete file." }, Number((e as { status?: number })?.status) || 400); }
};
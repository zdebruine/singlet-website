import { hasPrivateIdentity, productCall, unauthorized, type PrivateEnv } from "../../_shared/private-project";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const onRequestGet: PagesFunction<PrivateEnv> = async ({ request, env, params }) => {
  if (!hasPrivateIdentity(request, env)) return unauthorized();
  try { return json(await productCall(request, env, "get_project", { id: String(params.id ?? "") })); }
  catch (e) { return json({ error: "request_failed", message: e instanceof Error ? e.message : "Project not found." }, Number((e as { status?: number })?.status) || 400); }
};

export const onRequestDelete: PagesFunction<PrivateEnv> = async ({ request, env, params }) => {
  if (!hasPrivateIdentity(request, env)) return unauthorized();
  try {
    const result = await productCall<{ object_keys?: string[] }>(request, env, "delete_project", { id: String(params.id ?? "") });
    if (result.object_keys?.length) await env.USER_DATA.delete(result.object_keys);
    return json({ ok: true });
  } catch (e) { return json({ error: "request_failed", message: e instanceof Error ? e.message : "Could not delete project." }, Number((e as { status?: number })?.status) || 400); }
};
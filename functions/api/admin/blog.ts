/**
 * POST /api/admin/blog: publish or unpublish a blog post (_shared/blog.ts). Blog admins only.
 *
 * Takes the form the admin bar and the /blog/ index submit (slug, action = publish | unpublish, return = a /blog/ path)
 * and answers 303 back to that page. A JSON body with the same fields gets a JSON answer. Writes R2 only, never D1.
 */
import { isBlogAdmin, readIndex, setStatus, SLUG_RE, writeIndex, type BlogEnv } from "../../_shared/blog";
import type { AppEnv } from "../../_shared/env";
import { requireUser } from "../../_shared/identity";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const onRequest: PagesFunction<AppEnv & BlogEnv> = async ({ request, env, waitUntil }) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed", message: "POST only." }, 405);
  const who = await requireUser(request, env, waitUntil, "Sign in to publish blog posts.");
  if (!who.ok) return who.response;
  if (!isBlogAdmin(who.identity.userId, env)) return json({ error: "forbidden", message: "Publishing is for blog admins." }, 403);
  if (!env.BLOG) return json({ error: "not_configured", message: "The BLOG bucket is not bound." }, 503);

  const isJson = (request.headers.get("Content-Type") ?? "").includes("application/json");
  let fields: Record<string, unknown>;
  try {
    if (isJson) fields = (await request.json()) as Record<string, unknown>;
    else {
      const form = await request.formData();
      fields = { slug: form.get("slug"), action: form.get("action"), return: form.get("return") };
    }
  } catch {
    return json({ error: "invalid_body", message: "Send a form or JSON with slug and action." }, 400);
  }
  const slug = String(fields.slug ?? "");
  const action = String(fields.action ?? "");
  if (!SLUG_RE.test(slug) || (action !== "publish" && action !== "unpublish")) {
    return json({ error: "invalid_request", message: "slug must be a post slug and action publish or unpublish." }, 400);
  }

  const next = setStatus(await readIndex(env.BLOG), slug, action === "publish" ? "published" : "draft", new Date().toISOString());
  if (!next) return json({ error: "not_found", message: `No post ${slug}.` }, 404);
  await writeIndex(env.BLOG, next);

  if (isJson) return json({ ok: true, slug, status: next.posts.find((p) => p.slug === slug)!.status });
  const back = String(fields.return ?? "");
  const target = back.startsWith("/blog/") && !back.startsWith("//") ? back : "/blog/";
  return new Response(null, { status: 303, headers: { Location: target, "Cache-Control": "no-store" } });
};

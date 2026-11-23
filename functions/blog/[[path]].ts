/**
 * GET /blog/, /blog/<slug>/, /blog/<slug>/og.png and /blog/feed.xml (_shared/blog.ts).
 *
 * Everyone sees published posts. A signed-in blog admin also sees drafts, with a bar to publish or unpublish them.
 * A draft answers 404 to everyone else, exactly like a slug that doesn't exist.
 */
import { preparePost, isBlogAdmin, pageHeaders, readIndex, renderFeed, renderIndex, SLUG_RE, visiblePosts, type BlogEnv } from "../_shared/blog";
import type { AppEnv } from "../_shared/env";
import { resolveIdentity } from "../_shared/identity";

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export const onRequest: PagesFunction<AppEnv & BlogEnv> = async ({ request, env, waitUntil }) => {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("GET only", { status: 405, headers: { Allow: "GET, HEAD" } });
  const url = new URL(request.url);
  if (url.pathname === "/blog") return Response.redirect(`${url.origin}/blog/`, 301);
  if (!env.BLOG) return new Response("The blog is not configured.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  const who = await resolveIdentity(request, env, waitUntil);
  const admin = who.ok && who.identity.kind !== "anonymous" && isBlogAdmin(who.identity.userId, env);
  const index = await readIndex(env.BLOG);
  const parts = url.pathname.slice("/blog/".length).split("/");

  if (parts.length === 1 && parts[0] === "") {
    return new Response(renderIndex(visiblePosts(index, admin), admin), { headers: pageHeaders("text/html; charset=utf-8", admin) });
  }
  if (parts.length === 1 && parts[0] === "feed.xml") {
    return new Response(renderFeed(visiblePosts(index, false), url.origin), { headers: pageHeaders("application/atom+xml; charset=utf-8", false) });
  }

  const slug = parts[0];
  const post = SLUG_RE.test(slug) ? index.posts.find((p) => p.slug === slug) : undefined;
  if (!post || (post.status !== "published" && !admin)) return notFound();
  if (parts.length === 1) return Response.redirect(`${url.origin}/blog/${slug}/`, 301);

  if (parts.length === 2 && parts[1] === "") {
    const obj = await env.BLOG.get(`posts/${slug}/index.html`);
    if (!obj) return notFound();
    return new Response(preparePost(await obj.text(), post, admin), { headers: pageHeaders("text/html; charset=utf-8", admin) });
  }
  if (parts.length === 2 && parts[1] === "og.png") {
    const obj = await env.BLOG.get(`posts/${slug}/og.png`);
    if (!obj) return notFound();
    return new Response(obj.body, { headers: { ...pageHeaders("image/png", admin), "Cache-Control": admin ? "private, no-store" : "public, max-age=86400" } });
  }
  return notFound();
};

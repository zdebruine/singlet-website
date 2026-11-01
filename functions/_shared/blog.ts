/**
 * The singlet.bio blog (/blog/). Posts are whole HTML pages in the private R2 bucket `singlet-blog` (binding BLOG):
 *
 *   index.json               { posts: BlogPost[] }: metadata and status of every post, newest first
 *   posts/<slug>/index.html  the page, built from singlet-agents/blog (template + body)
 *   posts/<slug>/og.png      optional share card
 *
 * Drafts are uploaded by `python blog/upload.py` in singlet-agents and are visible only to blog admins (BLOG_ADMINS,
 * falling back to ANALYTICS_ADMINS). An admin publishes or unpublishes from the page itself (POST /api/admin/blog),
 * which rewrites index.json; nothing is written to D1. A published page is served without its draft box.
 */
import { isAnalyticsAdmin } from "../api/admin/analytics";

export type BlogStatus = "draft" | "published";

export interface BlogPost {
  slug: string;
  title: string;
  dek: string;
  type: string;
  date: string;
  author: string;
  status: BlogStatus;
  published_at?: string;
  updated_at?: string;
}

export interface BlogIndex {
  posts: BlogPost[];
}

export interface BlogEnv {
  BLOG?: R2Bucket;
  BLOG_ADMINS?: string;
  ANALYTICS_ADMINS?: string;
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INDEX_KEY = "index.json";

export function isBlogAdmin(userId: string | undefined, env: BlogEnv): boolean {
  return !!userId && isAnalyticsAdmin(userId, env.BLOG_ADMINS ?? env.ANALYTICS_ADMINS);
}

export async function readIndex(bucket: R2Bucket): Promise<BlogIndex> {
  const obj = await bucket.get(INDEX_KEY);
  if (!obj) return { posts: [] };
  const doc = (await obj.json()) as Partial<BlogIndex>;
  return { posts: Array.isArray(doc.posts) ? doc.posts.filter((p) => p && SLUG_RE.test(p.slug)) : [] };
}

export async function writeIndex(bucket: R2Bucket, index: BlogIndex): Promise<void> {
  await bucket.put(INDEX_KEY, JSON.stringify(index, null, 2), { httpMetadata: { contentType: "application/json" } });
}

/** Set a post's status. Publishing stamps published_at the first time; unpublishing keeps it. Null when the slug is unknown. */
export function setStatus(index: BlogIndex, slug: string, status: BlogStatus, now: string): BlogIndex | null {
  const post = index.posts.find((p) => p.slug === slug);
  if (!post) return null;
  const next = { ...post, status, updated_at: now };
  if (status === "published" && !post.published_at) next.published_at = now;
  return { posts: index.posts.map((p) => (p.slug === slug ? next : p)) };
}

/** Published posts for everyone; every post for an admin. Newest first by publication (or draft) date. */
export function visiblePosts(index: BlogIndex, admin: boolean): BlogPost[] {
  const key = (p: BlogPost) => p.published_at ?? p.date;
  return index.posts.filter((p) => admin || p.status === "published").sort((a, b) => key(b).localeCompare(key(a)));
}

/** Remove the review box drafts carry at the top of <main>. It holds no nested <div>. */
export function stripDraftBox(html: string): string {
  return html.replace(/<div class="draft">[\s\S]*?<\/div>\s*/, "");
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function displayDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function statusForm(post: BlogPost, back: string): string {
  const publish = post.status !== "published";
  return `<form method="post" action="/api/admin/blog" style="display:inline;margin:0">
<input type="hidden" name="slug" value="${esc(post.slug)}"><input type="hidden" name="action" value="${publish ? "publish" : "unpublish"}"><input type="hidden" name="return" value="${esc(back)}">
<button type="submit" style="font:inherit;font-size:13px;font-weight:600;cursor:pointer;border-radius:3px;padding:5px 11px;border:1px solid ${publish ? "#0B6F64;background:#0B6F64;color:#fff" : "#B45309;background:transparent;color:#B45309"}">${publish ? "Publish" : "Unpublish"}</button></form>`;
}

/** The bar an admin sees at the top of a post: its status and the button that changes it. */
export function adminBar(post: BlogPost): string {
  const label = post.status === "published" ? `Published ${displayDate(post.published_at ?? post.date)}` : "Draft: only blog admins can see this page";
  return `<div style="position:sticky;top:0;z-index:10;background:#FFF7E0;border-bottom:1px solid #E9CDA7;color:#0F1F1D;font:14px/1.4 'IBM Plex Sans',system-ui,sans-serif">
<div style="max-width:720px;margin:0 auto;padding:8px 16px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap">
<span><b>Admin</b> · ${esc(label)} · <a href="/blog/" style="color:#0B6F64">All posts</a></span>${statusForm(post, `/blog/${post.slug}/`)}</div></div>`;
}

/** A published page loses its draft box for everyone; an admin also gets the admin bar after <body>. */
export function preparePost(html: string, post: BlogPost, admin: boolean): string {
  const page = post.status === "published" ? stripDraftBox(html) : html;
  return admin ? page.replace(/<body([^>]*)>/, (m) => `${m}\n${adminBar(post)}`) : page;
}

export function renderIndex(posts: BlogPost[], admin: boolean): string {
  const cards = posts
    .map((p) => {
      const draft = p.status !== "published";
      const meta = `${esc(p.type)} · ${esc(displayDate(p.published_at ?? p.date))}${draft ? ' · <span class="badge">Draft</span>' : ""}`;
      const controls = admin ? `<div class="ctl">${statusForm(p, "/blog/")}</div>` : "";
      return `<article class="card${draft ? " is-draft" : ""}"><div class="meta">${meta}</div><h2><a href="/blog/${esc(p.slug)}/">${esc(p.title)}</a></h2><p>${esc(p.dek)}</p>${controls}</article>`;
    })
    .join("\n");
  const empty = `<p class="none">No posts yet.</p>`;
  const note = admin ? `<p class="admin">Admin view: drafts are shown with a badge and are visible only to blog admins.</p>` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blog · singlet.bio</title>
<meta name="description" content="News, research, guides and updates from singlet.bio, the open atlas of public single-cell RNA-seq data reprocessed from raw reads.">
<link rel="canonical" href="https://singlet.bio/blog/"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/atom+xml" title="singlet.bio blog" href="/blog/feed.xml">
<meta property="og:type" content="website"><meta property="og:title" content="singlet.bio blog"><meta property="og:url" content="https://singlet.bio/blog/"><meta property="og:image" content="https://singlet.bio/og-image.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{color-scheme:light;--paper:#fff;--ink:#0F1F1D;--ink-2:#2B3F3C;--muted:#5B6B68;--line:#D8E1DE;--teal:#0B6F64;--draft:#FFF7E0;--draft-line:#E9CDA7}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--paper:#0E1615;--ink:#E6EEEC;--ink-2:#C5D2CF;--muted:#93A5A1;--line:#263834;--teal:#73D5C9;--draft:#2E2616;--draft-line:#5C4A2A}}
*{box-sizing:border-box}html,body{margin:0;background:var(--paper);color:var(--ink)}
body{font-family:"IBM Plex Sans",system-ui,sans-serif;font-size:17px;line-height:1.6}
.site{max-width:720px;margin:0 auto;padding:18px 16px 0;display:flex;justify-content:space-between;font-size:14px}
.site a{color:var(--ink);text-decoration:none}.site .mark{font-weight:600}.site nav a{color:var(--muted);margin-left:18px}
main{max-width:720px;margin:0 auto;padding:40px 16px 96px}
.kicker{font-family:"IBM Plex Mono",monospace;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--teal)}
h1{font-size:34px;line-height:1.2;font-weight:600;margin:10px 0 8px}.lede{color:var(--ink-2);margin:0 0 32px}
.card{border-top:1px solid var(--line);padding:22px 0}.card h2{font-size:22px;line-height:1.3;font-weight:600;margin:6px 0 8px}
.card h2 a{color:var(--ink);text-decoration:none}.card h2 a:hover{color:var(--teal)}.card p{margin:0;color:var(--ink-2)}
.meta{font-family:"IBM Plex Mono",monospace;font-size:12.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.badge{background:var(--draft);border:1px solid var(--draft-line);border-radius:3px;padding:1px 6px;color:var(--ink)}
.is-draft{opacity:.92}.ctl{margin-top:12px}.admin{background:var(--draft);border:1px solid var(--draft-line);border-radius:3px;padding:10px 14px;font-size:14.5px}
.none{color:var(--muted)}a{color:var(--teal)}
@media(max-width:560px){body{font-size:16px}h1{font-size:27px}}
</style></head>
<body>
<header class="site"><a class="mark" href="/">singlet.bio</a><nav><a href="/blog/">Blog</a><a href="/docs">Docs</a></nav></header>
<main>
<div class="kicker">singlet.bio</div>
<h1>Blog</h1>
<p class="lede">What we build, what we measure, and how to use it. <a href="/blog/feed.xml">Feed</a></p>
${note}
${cards || empty}
</main>
</body></html>`;
}

/** Atom feed of published posts. */
export function renderFeed(posts: BlogPost[], origin: string): string {
  const published = posts.filter((p) => p.status === "published");
  const updated = published[0]?.published_at ?? new Date(0).toISOString();
  const entries = published
    .map((p) => {
      const url = `${origin}/blog/${p.slug}/`;
      const when = p.published_at ?? `${p.date}T12:00:00Z`;
      return `<entry><title>${esc(p.title)}</title><link href="${url}"/><id>${url}</id><published>${when}</published><updated>${p.updated_at ?? when}</updated><author><name>${esc(p.author)}</name></author><summary>${esc(p.dek)}</summary></entry>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>singlet.bio blog</title><link href="${origin}/blog/"/><link rel="self" href="${origin}/blog/feed.xml"/><id>${origin}/blog/</id><updated>${updated}</updated>
${entries}
</feed>`;
}

/** Headers for blog pages: they are HTML documents, so they get a page CSP (inline styles and Google Fonts, no script). */
export function pageHeaders(contentType: string, admin: boolean): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Cache-Control": admin ? "private, no-store" : "public, max-age=300",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  };
}

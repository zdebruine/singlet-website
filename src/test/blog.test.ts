// @vitest-environment node
/**
 * The blog (functions/_shared/blog.ts): drafts are for admins only, publishing stamps the date once, a published page
 * loses its draft box, and the admin bar carries the publish form.
 */
import { describe, expect, it } from "vitest";
import { isBlogAdmin, preparePost, renderFeed, renderIndex, setStatus, stripDraftBox, visiblePosts, type BlogIndex, type BlogPost } from "../../functions/_shared/blog";

const post = (slug: string, status: BlogPost["status"], date: string, extra: Partial<BlogPost> = {}): BlogPost => ({
  slug,
  title: `Title ${slug}`,
  dek: `Dek ${slug} & more`,
  type: "Research",
  date,
  author: "The Singlet team",
  status,
  ...extra,
});

const index: BlogIndex = {
  posts: [post("old-post", "published", "2026-10-01", { published_at: "2026-10-02T10:00:00Z" }), post("new-draft", "draft", "2026-11-01")],
};

const PAGE = `<html><body>\n<main>\n<div class="draft">\n<b>Draft</b><ol><li>confirm</li></ol>\n</div>\n<h1>Post</h1></main></body></html>`;

describe("blog", () => {
  it("names admins from BLOG_ADMINS, else ANALYTICS_ADMINS", () => {
    expect(isBlogAdmin("u1", { BLOG_ADMINS: "u0, u1" })).toBe(true);
    expect(isBlogAdmin("u1", { ANALYTICS_ADMINS: "u1" })).toBe(true);
    expect(isBlogAdmin("u1", { BLOG_ADMINS: "u2", ANALYTICS_ADMINS: "u1" })).toBe(false);
    expect(isBlogAdmin(undefined, { ANALYTICS_ADMINS: "u1" })).toBe(false);
  });

  it("shows drafts to admins only, newest first", () => {
    expect(visiblePosts(index, false).map((p) => p.slug)).toEqual(["old-post"]);
    expect(visiblePosts(index, true).map((p) => p.slug)).toEqual(["new-draft", "old-post"]);
  });

  it("stamps published_at on first publish and keeps it when unpublished", () => {
    const pub = setStatus(index, "new-draft", "published", "2026-11-03T09:00:00Z")!;
    expect(pub.posts[1]).toMatchObject({ status: "published", published_at: "2026-11-03T09:00:00Z" });
    const back = setStatus(pub, "new-draft", "draft", "2026-11-04T09:00:00Z")!;
    expect(back.posts[1]).toMatchObject({ status: "draft", published_at: "2026-11-03T09:00:00Z" });
    expect(setStatus(index, "missing", "published", "x")).toBeNull();
  });

  it("drops the draft box from published pages, for admins too, and adds the admin bar for admins", () => {
    expect(stripDraftBox(PAGE)).not.toContain("confirm");
    const draft = index.posts[1];
    expect(preparePost(PAGE, draft, true)).toContain("confirm");
    expect(preparePost(PAGE, draft, true)).toContain('value="publish"');
    const published = index.posts[0];
    expect(preparePost(PAGE, published, false)).not.toContain("confirm");
    expect(preparePost(PAGE, published, false)).not.toContain("/api/admin/blog");
    expect(preparePost(PAGE, published, true)).toContain('value="unpublish"');
    expect(preparePost(PAGE, published, true)).not.toContain("confirm");
  });

  it("renders the index with publish controls only for admins, escaped", () => {
    const pub = renderIndex(visiblePosts(index, false), false);
    expect(pub).not.toContain("new-draft");
    expect(pub).not.toContain("<form");
    expect(pub).toContain("Dek old-post &amp; more");
    const adm = renderIndex(visiblePosts(index, true), true);
    expect(adm).toContain("Draft");
    expect(adm).toContain('value="publish"');
  });

  it("lists only published posts in the feed", () => {
    const feed = renderFeed(visiblePosts(index, true), "https://singlet.bio");
    expect(feed).toContain("https://singlet.bio/blog/old-post/");
    expect(feed).not.toContain("new-draft");
  });
});

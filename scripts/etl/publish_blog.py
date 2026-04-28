#!/usr/bin/env python3
"""
Agent → Blog publish hook.

Called by development agents when a feature achieves stability.
Creates a blog post entry that appears on singlet.bio/blog.

Usage (from agent code):
    python scripts/etl/publish_blog.py \
        --slug "my-feature-name" \
        --title "Feature Title" \
        --summary "One-paragraph summary" \
        --tags "tag1,tag2" \
        --content-file /path/to/content.md

Or programmatically:
    from publish_blog import publish_post
    publish_post(slug="my-feature", title="...", summary="...", tags=["a","b"], content="...")

When Supabase is configured, posts go to the blog_posts table.
Until then, posts are appended to blog_posts.json for static rendering.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

BLOG_POSTS_FILE = Path(__file__).parent.parent.parent / "src" / "data" / "blog_posts.json"
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def publish_to_supabase(post: dict) -> bool:
    """Attempt to publish to Supabase blog_posts table."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return False
    try:
        from supabase import create_client
        client = create_client(SUPABASE_URL, SUPABASE_KEY)
        client.table("blog_posts").upsert(post, on_conflict="slug").execute()
        return True
    except Exception as e:
        print(f"  [WARN] Supabase publish failed: {e}", file=sys.stderr)
        return False


def publish_to_static(post: dict):
    """Append post to static JSON file for website rendering."""
    BLOG_POSTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    
    existing = []
    if BLOG_POSTS_FILE.exists():
        existing = json.loads(BLOG_POSTS_FILE.read_text())
    
    # Update or append
    updated = False
    for i, p in enumerate(existing):
        if p["slug"] == post["slug"]:
            existing[i] = post
            updated = True
            break
    if not updated:
        existing.insert(0, post)  # newest first
    
    BLOG_POSTS_FILE.write_text(json.dumps(existing, indent=2))
    print(f"  Published to {BLOG_POSTS_FILE}")


def publish_post(
    slug: str,
    title: str,
    summary: str,
    tags: list[str],
    content: str,
    author: str = "Singlet Agent",
) -> dict:
    """Publish a blog post. Returns the post dict."""
    post = {
        "slug": slug,
        "title": title,
        "summary": summary,
        "tags": tags,
        "content": content,
        "author": author,
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "published_at": datetime.now(timezone.utc).isoformat(),
    }

    # Try Supabase first, fall back to static
    if not publish_to_supabase(post):
        publish_to_static(post)

    return post


def main():
    parser = argparse.ArgumentParser(description="Publish a blog post from an agent")
    parser.add_argument("--slug", required=True, help="URL slug (e.g. 'my-feature')")
    parser.add_argument("--title", required=True, help="Post title")
    parser.add_argument("--summary", required=True, help="One-paragraph summary")
    parser.add_argument("--tags", required=True, help="Comma-separated tags")
    parser.add_argument("--content-file", help="Path to markdown content file")
    parser.add_argument("--content", help="Inline content (alternative to --content-file)")
    parser.add_argument("--author", default="Singlet Agent", help="Author name")
    args = parser.parse_args()

    if args.content_file:
        content = Path(args.content_file).read_text()
    elif args.content:
        content = args.content
    else:
        content = args.summary  # fallback

    tags = [t.strip() for t in args.tags.split(",")]
    
    post = publish_post(
        slug=args.slug,
        title=args.title,
        summary=args.summary,
        tags=tags,
        content=content,
        author=args.author,
    )
    
    print(f"✓ Published: {post['title']}")
    print(f"  URL: https://singlet.bio/blog/{post['slug']}")


if __name__ == "__main__":
    main()

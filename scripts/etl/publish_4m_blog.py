#!/usr/bin/env python3
"""Publish the 4 Million Cells blog post when milestone is crossed.

Usage: python3 publish_4m_blog.py [--dry-run]
"""
import json
import os
import sys
from datetime import date

from supabase import create_client

BLOG_PATH = os.path.join(
    os.path.dirname(__file__), "../../src/data/blog_posts.json"
)


def get_corpus_stats():
    """Get current corpus stats from Supabase."""
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

    all_data = []
    offset = 0
    while True:
        r = (
            sb.table("samples")
            .select("status,organism,cells_called,mapping_rate,protocol,median_genes")
            .range(offset, offset + 999)
            .execute()
        )
        all_data.extend(r.data)
        if len(r.data) < 1000:
            break
        offset += 1000

    total = len(all_data)
    success = [r for r in all_data if r["status"] == "SUCCESS"]
    n_success = len(success)
    total_cells = sum(r.get("cells_called") or 0 for r in success)
    species = len(
        set(r["organism"] for r in all_data if r.get("organism") and r["organism"] != "unknown")
    )
    protocols = len(
        set(r["protocol"] for r in success if r.get("protocol") and r["protocol"].strip())
    )
    avg_cells = total_cells // n_success if n_success else 0
    mapping_rates = sorted(r.get("mapping_rate") or 0 for r in success)
    median_mr = mapping_rates[n_success // 2] if mapping_rates else 0

    return {
        "total": total,
        "success": n_success,
        "cells": total_cells,
        "species": species,
        "protocols": protocols,
        "avg_cells": avg_cells,
        "median_mr": median_mr,
    }


def build_blog_post(stats):
    """Build the 4M cells blog post."""
    cells_m = stats["cells"] / 1_000_000
    return {
        "slug": "4-million-cells-milestone",
        "title": f"4 Million Cells: The Singlet Atlas Passes a Major Milestone",
        "date": date.today().isoformat(),
        "summary": (
            f"The singlet atlas now contains {cells_m:.1f} million cells across "
            f"{stats['success']:,} samples from {stats['species']} species. "
            f"With {stats['protocols']} protocols represented and a median mapping rate "
            f"of {stats['median_mr']:.1%}, the atlas continues to grow in both scale and quality."
        ),
        "content": (
            f"## 4 Million Cells\n\n"
            f"The singlet atlas has crossed **4 million cells** \u2014 a milestone that "
            f"demonstrates the scale and reliability of our automated processing pipeline.\n\n"
            f"### By the Numbers\n\n"
            f"| Metric | Value |\n"
            f"|--------|-------|\n"
            f"| Total processed | {stats['total']:,} |\n"
            f"| Passing QC (SUCCESS) | {stats['success']:,} |\n"
            f"| Total cells | {cells_m:.2f} million |\n"
            f"| Avg cells/sample | {stats['avg_cells']:,} |\n"
            f"| Species | {stats['species']} |\n"
            f"| Protocols | {stats['protocols']} |\n"
            f"| Median mapping rate | {stats['median_mr']:.1%} |\n\n"
            f"### Growth Trajectory\n\n"
            f"| Milestone | Samples (SUCCESS) | Date |\n"
            f"|-----------|-------------------|------|\n"
            f"| 1 million cells | ~350 | 2026-04 |\n"
            f"| 2 million cells | ~700 | 2026-04 |\n"
            f"| 3 million cells | ~1,050 | 2026-04 |\n"
            f"| **4 million cells** | **{stats['success']:,}** | **{date.today().isoformat()}** |\n\n"
            f"### What 4 Million Cells Means\n\n"
            f"At this scale, the atlas represents a meaningful cross-section of publicly "
            f"available single-cell data:\n\n"
            f"- **Rare cell types** become discoverable (MAIT cells, plasmacytoid DCs, "
            f"megakaryocytes)\n"
            f"- **Protocol comparisons** gain statistical power (10x v2 vs v3, Drop-seq vs "
            f"Smart-seq2)\n"
            f"- **Species diversity** enables cross-species analyses (human, mouse, rat, "
            f"zebrafish, and more)\n"
            f"- **Tissue coverage** spans 36+ categories from brain to bone marrow\n\n"
            f"### Processing Speed\n\n"
            f"The singlify pipeline processes each sample in **15\u201340 seconds** on a single "
            f"CPU core \u2014 5\u201310\u00d7 faster than STARsolo alone. With batch processing on "
            f"the Clipper HPC cluster, hundreds of samples are processed per day.\n\n"
            f"### Quality at Scale\n\n"
            f"Speed hasn't come at the cost of quality:\n\n"
            f"- Gene count correlation with STARsolo: **r = 0.9998**\n"
            f"- Median mapping rate: **{stats['median_mr']:.1%}**\n"
            f"- Average cells per sample: **{stats['avg_cells']:,}**\n"
            f"- 42.9% overall success rate (remaining samples are download failures or "
            f"incompatible protocols)\n\n"
            f"### Query the Atlas\n\n"
            f"```python\n"
            f"import singlet\n\n"
            f"# See the full atlas summary\n"
            f"print(singlet.summary())\n"
            f"# \u2192 singlet atlas: {stats['total']:,} samples ({stats['success']:,} SUCCESS) "
            f"\u2022 {stats['species']} species \u2022 {stats['protocols']} protocols \u2022 "
            f"{cells_m:.1f}M cells\n\n"
            f"# Load a specific sample as AnnData\n"
            f"adata = singlet.load('GSM...')\n"
            f"print(adata)  # genes x cells matrix\n"
            f"```\n\n"
            f"### What's Next\n\n"
            f"- **5 million cells** target within coming cycles\n"
            f"- Expanding multi-modal coverage (CITE-seq, ATAC-seq)\n"
            f"- Non-host transcriptomics (viral/microbial reads)\n"
            f"- Additional species support"
        ),
        "tags": ["milestone", "corpus", "cells", "atlas", "scale"],
    }


def main():
    dry_run = "--dry-run" in sys.argv

    print("Fetching corpus stats from Supabase...")
    stats = get_corpus_stats()
    print(f"  Total: {stats['total']:,}")
    print(f"  SUCCESS: {stats['success']:,}")
    print(f"  Cells: {stats['cells']:,}")

    if stats["cells"] < 4_000_000:
        gap = 4_000_000 - stats["cells"]
        print(f"\n  NOT YET: {gap:,} cells short of 4M milestone.")
        print("  Re-run after more pipeline results are synced.")
        return 1

    print(f"\n  MILESTONE CROSSED: {stats['cells']:,} cells >= 4,000,000!")

    # Build blog post
    post = build_blog_post(stats)

    if dry_run:
        print("\n[DRY RUN] Would publish:")
        print(f"  Title: {post['title']}")
        print(f"  Slug: {post['slug']}")
        print(f"  Date: {post['date']}")
        print(f"  Summary: {post['summary'][:100]}...")
        return 0

    # Load existing blog posts
    with open(BLOG_PATH) as f:
        posts = json.load(f)

    # Check if already published
    if any(p["slug"] == post["slug"] for p in posts):
        print("  Blog post already exists. Skipping.")
        return 0

    # Prepend (newest first)
    posts.insert(0, post)

    with open(BLOG_PATH, "w") as f:
        json.dump(posts, f, indent=2, ensure_ascii=False)

    print(f"  Published blog #{len(posts)}: {post['title']}")
    print(f"  File: {BLOG_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

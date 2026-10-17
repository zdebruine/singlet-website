import { describe, expect, it } from "vitest";
import { extractHeadings, slugify, splitFrontMatter, stripTitle, taskPath } from "./task-docs";

const DOC = `---
id: doublets.expression_doublet_scoring
title: Expression-based doublet scoring
depends_on: [qc.low_quality_cell_detection, ambient.count_removal]  # inline comment
feeds: []
priority: P0
---

# Expression-based doublet scoring

> Summary line.

## 1. Question

text

\`\`\`python
## not a heading
\`\`\`

### B1. Accuracy
`;

describe("task docs helpers", () => {
  it("parses flat front matter and inline lists", () => {
    const { fm, body } = splitFrontMatter(DOC);
    expect(fm.id).toBe("doublets.expression_doublet_scoring");
    expect(fm.depends_on).toEqual(["qc.low_quality_cell_detection", "ambient.count_removal"]);
    expect(fm.feeds).toEqual([]);
    expect(fm.priority).toBe("P0");
    expect(body.startsWith("\n# Expression")).toBe(true);
  });
  it("strips the leading title heading only", () => {
    const { body } = splitFrontMatter(DOC);
    expect(stripTitle(body)).not.toMatch(/^\s*# Expression/);
    expect(stripTitle(body)).toContain("## 1. Question");
  });
  it("extracts headings outside code fences", () => {
    const hs = extractHeadings(splitFrontMatter(DOC).body);
    expect(hs.map((h) => h.text)).toEqual(["1. Question", "B1. Accuracy"]);
    expect(hs[0].id).toBe("1-question");
  });
  it("slugifies and builds task paths", () => {
    expect(slugify("3. Theory and `insight`")).toBe("3-theory-and-insight");
    expect(taskPath("spatial-genes.svg_detection")).toBe("/tasks/spatial-genes/svg_detection");
  });
  it("returns the whole text when there is no front matter", () => {
    expect(splitFrontMatter("# T\n").body).toBe("# T\n");
  });
});

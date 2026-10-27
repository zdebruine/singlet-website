// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = [...readdirSync("docs").filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`), "README.md", "CHANGELOG.md", "roadmap.md"];

describe("docs hold no secrets", () => {
  it("has no token digest, key or private key in the markdown files", () => {
    const patterns: [string, RegExp][] = [
      ["64-hex digest (an INGEST_TOKEN_SHA256 value)", /\b[0-9a-f]{64}\b/],
      ["Anthropic or OpenAI-style key", /\bsk-[A-Za-z0-9_-]{20,}/],
      ["GitHub token", /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})/],
      ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY/],
      ["Google client secret", /GOCSPX-[A-Za-z0-9_-]{10,}/],
    ];
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const [name, re] of patterns) if (re.test(text)) hits.push(`${f}: ${name}`);
    }
    expect(hits).toEqual([]);
  });
});

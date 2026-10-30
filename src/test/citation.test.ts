import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RELEASE_NAME, SOFTWARE_BIBTEX, atlasBibtex, atlasCitation, atlasRis } from "../../functions/_shared/citation";
import { RELEASE_NAME as CROISSANT_RELEASE } from "../../functions/_shared/croissant";

const read = (p: string) => readFileSync(p, "utf8");

describe("citation", () => {
  it("cites the atlas with its release and the access date", () => {
    expect(atlasCitation("2026-10-30")).toBe(
      "DeBruine Z. singlet.bio: an open atlas of public single-cell RNA-seq studies reprocessed from raw reads. " +
        "Singlet Research Alpha (October 2026). https://singlet.bio (accessed 2026-10-30).",
    );
    expect(atlasCitation()).not.toMatch(/accessed/);
    expect(atlasBibtex("2026-10-30")).toMatch(/note\s+= \{Singlet Research Alpha \(October 2026\)\. Accessed 2026-10-30\}/);
    expect(atlasRis("2026-10-30")).toMatch(/^Y2  - 2026-10-30$/m);
    expect(SOFTWARE_BIBTEX).toMatch(/github\.com\/Singlet-Bio\/singlet\}/);
    expect(CROISSANT_RELEASE).toBe(RELEASE_NAME);
  });

  it("says the same in the README, CITATION.cff and llms.txt", () => {
    const line = atlasCitation("YYYY-MM-DD");
    expect(read("README.md")).toContain(line);
    expect(read("README.md")).toContain(atlasBibtex("YYYY-MM-DD"));
    expect(read("public/llms.txt")).toContain(atlasCitation("<date>"));
    const cff = read("CITATION.cff");
    expect(cff).toContain(`title: "${line.split(". ")[1]}"`);
    expect(cff).toContain(`version: "${RELEASE_NAME}"`);
  });
});

// @vitest-environment node
// Free-text matching behind the "unclassified" study lists (functions/_shared/coverage-gaps.ts).
import { describe, expect, it } from "vitest";
import { groupTextPatterns, matchText, unmappedNote } from "../../functions/_shared/coverage-gaps";
import type { VocabRule } from "../../functions/_shared/vocab";

const rules: VocabRule[] = [
  { field: "tissue", priority: 169, grp: "Liver", match_type: "contains", pattern: "liver" },
  { field: "tissue", priority: 170, grp: "Liver", match_type: "contains", pattern: "hepat" },
  { field: "tissue", priority: 171, grp: "Liver", match_type: "exact", pattern: "lv" },
  { field: "tissue", priority: 20, grp: "Lung / airway", match_type: "contains", pattern: "bronch" },
  { field: "disease", priority: 1, grp: "Liver", match_type: "contains", pattern: "cirrhosis" },
];

describe("groupTextPatterns / matchText", () => {
  it("uses the group's vocab rules of at least four letters plus the words of its name, at a word start", () => {
    const liver = groupTextPatterns(rules, "tissue_groups", "Liver");
    expect(liver.map((r) => r.source)).toEqual(["\\bliver", "\\bhepat"]);
    expect(groupTextPatterns(rules, "tissue_groups", "Lung / airway").map((r) => r.source)).toEqual(["\\bbronch", "\\blung", "\\bairway"]);
    expect(matchText(liver, [{ name: "title", text: "Deliverables of a kidney atlas" }])).toBeNull();
    expect(matchText(liver, [{ name: "title", text: "Hepatocytes in NAFLD" }])).toMatchObject({ matched_in: "title", snippet: "Hepatocytes in NAFLD" });
  });

  it("prefers the title, then the samples' text, then the abstract, and trims the snippet", () => {
    const liver = groupTextPatterns(rules, "tissue_groups", "Liver");
    const m = matchText(liver, [
      { name: "title", text: "snRNA-seq of donor tissue" },
      { name: "sample_text", text: "Homo sapiens female adult (39 years) liver tissue, preserved by flash-freezing nuclear fraction" },
      { name: "abstract", text: "liver" },
    ]);
    expect(m).toEqual({ matched_in: "sample_text", snippet: "Homo sapiens female adult (39 years) liver tissue, preserved by flash-freezing nuclear fract…" });
  });

  it("writes the unmapped sentence only when there is something to say", () => {
    expect(unmappedNote(0, "tissue_groups", "Liver", [])).toBeNull();
    expect(unmappedNote(1, "disease_groups", "Cancer", ["Mus musculus"])).toBe('1 served Mus musculus study has no disease group and could not match disease "Cancer".');
  });
});

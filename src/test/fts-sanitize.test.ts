import { describe, expect, it } from "vitest";
import { tokenizeQuery } from "../../functions/_shared/search-core";

/**
 * /api/gse, /api/gsm and /api/search bind tokenizeQuery(q).and / .or straight
 * into an FTS5 MATCH. Raw input there (`x*`, `foo"`, `"a OR"`) was an FTS5
 * syntax error and an HTTP 500 in production, so every expression must be
 * quoted FTS5 strings joined only by AND / OR and parentheses.
 */

/** Drop every FTS5 string literal ("…" with "" escapes, optional prefix *). */
function withoutStrings(expr: string): string {
  return expr.replace(/"(?:[^"]|"")*"\*?/g, " ");
}

/** True when nothing but AND / OR / parentheses sits outside the quoted strings. */
function isSafeMatch(expr: string): boolean {
  const rest = withoutStrings(expr).replace(/[()]/g, " ").trim();
  return rest === "" || rest.split(/\s+/).every((w) => w === "AND" || w === "OR");
}

const HOSTILE = [
  "x*",
  'foo"',
  '"a OR"',
  "a OR",
  "NEAR(foo bar)",
  "title:foo",
  "{title abstract}: foo",
  "^foo",
  "foo AND",
  "AND OR NOT",
  "-foo",
  "foo -bar",
  "(",
  ")",
  '"',
  "*",
  "'",
  "foo'bar",
  "a + b",
  "covid-19",
  "t cells",
  "CD4+ T-cells",
  "IL-6/STAT3",
  "10x 3' v3",
  "GSE138867",
  "café au lait",
  "constructor",
  "__proto__",
  "foo;DROP TABLE gse;--",
  "",
  "   ",
];

describe("FTS query sanitiser (tokenizeQuery)", () => {
  it("yields no MATCH expression when nothing searchable is left", () => {
    for (const q of ["x*", '"a OR"', "a OR", "*", '"', "(", ")", "'", "a + b", "", "   "]) {
      const t = tokenizeQuery(q);
      expect(t.and, q).toBeNull();
      expect(t.or, q).toBeNull();
    }
  });

  it("quotes a word and drops stray FTS syntax", () => {
    const t = tokenizeQuery('foo"');
    expect(t.terms).toEqual(["foo"]);
    expect(t.and).toBe('"foo"');
  });

  it("only ever emits quoted strings joined by AND / OR", () => {
    for (const q of HOSTILE) {
      const t = tokenizeQuery(q);
      expect(t.and === null, q).toBe(t.or === null);
      for (const expr of [t.and, t.or]) {
        if (expr === null) continue;
        expect(isSafeMatch(expr), `${q} → ${expr}`).toBe(true);
        expect((expr.match(/"/g) ?? []).length % 2, `${q} → ${expr}`).toBe(0);
      }
    }
  });

  it("treats words that are Object.prototype keys as plain words", () => {
    expect(() => tokenizeQuery("constructor")).not.toThrow();
    expect(tokenizeQuery("constructor").and).toContain('"constructor"');
  });
});

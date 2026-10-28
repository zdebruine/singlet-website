/**
 * Study-level coverage safeguards for search_datasets and find_matched_controls.
 *
 * A tissue or disease group filter matches gse_meta.tissue_groups / disease_groups. A served study whose array is empty (3,064 of 7,070 on
 * 2026-10-28: the ENCODE liver series GSE286615, GSE286728, GSE286734, GSE286744 and GSE286853 among them) can never match, and nothing in
 * an answer said so. These helpers count those studies for a filter and, when asked, list the ones whose GEO text names the group,
 * flagged "unclassified" with the text that matched, so an agent sees them as candidates to check rather than as catalog facts.
 */
import { studyServedSql } from "./alpha";
import type { VocabRule } from "./vocab";

export type GroupColumn = "tissue_groups" | "disease_groups";
const RULE_FIELD: Record<GroupColumn, "tissue" | "disease"> = { tissue_groups: "tissue", disease_groups: "disease" };
const LABEL: Record<GroupColumn, string> = { tissue_groups: "tissue", disease_groups: "disease" };

const emptySql = (col: GroupColumn) => `(m.${col} IS NULL OR m.${col} IN ('', '[]'))`;
const SERVED_BUILT = `m.has_bundle = 1 AND COALESCE(m.n_usable_samples, 1) > 0 AND ${studyServedSql("m.gse_id")}`;

/** Served studies with a file, for the organisms given (none = all), whose group array is empty. */
export async function countUnmappedStudies(db: D1Database, col: GroupColumn, organisms: string[]): Promise<number | null> {
  const orgSql = organisms.length ? ` AND m.organism_primary IN (${organisms.map(() => "?").join(", ")})` : "";
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM gse_meta m WHERE ${SERVED_BUILT} AND ${emptySql(col)}${orgSql}`)
    .bind(...organisms)
    .first<{ n: number }>()
    .catch(() => null);
  return row ? Number(row.n) : null;
}

/** One sentence for an answer: how many studies a group filter could not judge. */
export function unmappedNote(n: number | null, col: GroupColumn, value: string, organisms: string[]): string | null {
  if (!n) return null;
  const who = organisms.length ? `${organisms.join(" or ")} ` : "";
  return `${n.toLocaleString("en-US")} served ${who}stud${n === 1 ? "y has" : "ies have"} no ${LABEL[col]} group and could not match ${LABEL[col]} "${value}".`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Word-start patterns for a group, from the same vocab_rules that fill the group columns plus the group's own name ("Lung / airway" ->
 * lung, airway). Free text is prose, not a GEO field, so a pattern must start a word and be at least four letters ("liver", "hepat"),
 * and an `exact` rule must be the whole word.
 */
export function groupTextPatterns(rules: VocabRule[], col: GroupColumn, group: string): RegExp[] {
  const words = new Set<string>();
  const exact = new Set<string>();
  for (const r of rules) {
    if (r.field !== RULE_FIELD[col] || r.grp !== group) continue;
    const p = r.pattern.trim().toLowerCase();
    if (p.length < 4) continue;
    (r.match_type === "exact" ? exact : words).add(p);
  }
  for (const part of group.toLowerCase().split(/[\/&,()]| and /)) {
    const p = part.trim();
    if (p.length >= 4 && !/^(other|unspecified|site unspecified|cells|sorted)$/.test(p)) words.add(p);
  }
  return [...[...words].map((w) => new RegExp(`\\b${escapeRe(w)}`, "i")), ...[...exact].map((w) => new RegExp(`\\b${escapeRe(w)}\\b`, "i"))];
}

export interface TextMatch {
  /** where the text matched, strongest first: the study title, the samples' GEO source / title, the abstract */
  matched_in: "title" | "sample_text" | "abstract";
  snippet: string;
}

/** The first field whose text a pattern matches, with ~100 characters around the hit. */
export function matchText(patterns: RegExp[], fields: { name: TextMatch["matched_in"]; text: string | null }[]): TextMatch | null {
  for (const f of fields) {
    const t = (f.text ?? "").replace(/\s+/g, " ");
    for (const re of patterns) {
      const m = re.exec(t);
      if (!m) continue;
      const a = Math.max(0, m.index - 50);
      const b = Math.min(t.length, m.index + m[0].length + 50);
      return { matched_in: f.name, snippet: `${a > 0 ? "…" : ""}${t.slice(a, b)}${b < t.length ? "…" : ""}` };
    }
  }
  return null;
}

export interface UnclassifiedStudy {
  gse_id: string;
  title: string | null;
  organism: string | null;
  n_samples: number | null;
  classification: "unclassified";
  matched_in: TextMatch["matched_in"];
  evidence: string;
}

const RANK: Record<TextMatch["matched_in"], number> = { title: 0, sample_text: 1, abstract: 2 };

/**
 * Served studies with an empty group array whose GEO text names the group: the study title, the abstract, or the GEO source / title of up
 * to 20 of its samples. Ranked title > sample text > abstract, then by sample count. Reads at most `scan` studies.
 */
export async function unclassifiedStudies(
  db: D1Database,
  rules: VocabRule[],
  opts: { col: GroupColumn; group: string; organisms: string[]; exclude?: string[]; limit?: number; scan?: number }
): Promise<UnclassifiedStudy[]> {
  const patterns = groupTextPatterns(rules, opts.col, opts.group);
  if (!patterns.length) return [];
  const orgSql = opts.organisms.length ? ` AND m.organism_primary IN (${opts.organisms.map(() => "?").join(", ")})` : "";
  const rows = await db
    .prepare(
      `SELECT m.gse_id, g.title, substr(g.abstract, 1, 4000) AS abstract, m.organism_primary, m.n_done,
              (SELECT group_concat(t, ' | ') FROM (SELECT DISTINCT COALESCE(s.source, '') || ' ' || COALESCE(s.title, '') AS t FROM gsm s WHERE s.gse_id = m.gse_id LIMIT 20)) AS sample_text
         FROM gse_meta m JOIN gse g ON g.id = m.gse_id
        WHERE ${SERVED_BUILT} AND ${emptySql(opts.col)}${orgSql}
        ORDER BY m.n_done DESC
        LIMIT ?`
    )
    .bind(...opts.organisms, opts.scan ?? 2000)
    .all<{ gse_id: string; title: string | null; abstract: string | null; organism_primary: string | null; n_done: number | null; sample_text: string | null }>()
    .catch(() => ({ results: [] as never[] }));
  const skip = new Set(opts.exclude ?? []);
  const hits: (UnclassifiedStudy & { rank: number })[] = [];
  for (const r of rows.results ?? []) {
    if (skip.has(r.gse_id)) continue;
    const m = matchText(patterns, [
      { name: "title", text: r.title },
      { name: "sample_text", text: r.sample_text },
      { name: "abstract", text: r.abstract },
    ]);
    if (!m) continue;
    hits.push({
      gse_id: r.gse_id,
      title: r.title,
      organism: r.organism_primary,
      n_samples: r.n_done != null ? Number(r.n_done) : null,
      classification: "unclassified",
      matched_in: m.matched_in,
      evidence: m.snippet,
      rank: RANK[m.matched_in],
    });
  }
  hits.sort((a, b) => a.rank - b.rank || (b.n_samples ?? 0) - (a.n_samples ?? 0) || a.gse_id.localeCompare(b.gse_id));
  return hits.slice(0, opts.limit ?? 10).map(({ rank: _rank, ...h }) => h);
}

/**
 * Minimal OBO 1.2/1.4 reader: [Term] stanzas with id, name, synonyms, is_a, part_of, obsolete flags and the
 * numeric stage properties HsapDv and MmusDv carry (start_ypb, end_wpb, start_dpc, ...). Enough for label
 * matching and an is_a / part_of closure; everything else in the file is ignored.
 */

export interface OboSynonym {
  text: string;
  scope: "EXACT" | "NARROW" | "BROAD" | "RELATED";
}

export interface OboTerm {
  id: string;
  name: string;
  synonyms: OboSynonym[];
  isA: string[];
  partOf: string[];
  obsolete: boolean;
  replacedBy: string[];
  /** property_value pairs with a numeric value (start_ypb, end_dpf, ...). */
  props: Record<string, number>;
}

function unquote(s: string): string | null {
  const m = /^"((?:[^"\\]|\\.)*)"/.exec(s);
  return m ? m[1].replace(/\\(.)/g, "$1") : null;
}

function idOf(rest: string): string {
  return rest.trim().split(/\s+/)[0];
}

export function parseObo(text: string, prefixes?: string[]): Map<string, OboTerm> {
  const out = new Map<string, OboTerm>();
  let cur: OboTerm | null = null;
  let inTerm = false;
  const flush = () => {
    if (cur && inTerm && cur.id && (!prefixes || prefixes.some((p) => cur!.id.startsWith(p + ":")))) out.set(cur.id, cur);
    cur = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith("[")) {
      flush();
      inTerm = line === "[Term]";
      if (inTerm) cur = { id: "", name: "", synonyms: [], isA: [], partOf: [], obsolete: false, replacedBy: [], props: {} };
      continue;
    }
    if (!inTerm || !cur || !line) continue;
    const idx = line.indexOf(": ");
    if (idx < 0) continue;
    const tag = line.slice(0, idx);
    const rest = line.slice(idx + 2);
    const t: OboTerm = cur;
    switch (tag) {
      case "id":
        t.id = rest.trim();
        break;
      case "name":
        t.name = rest.trim();
        break;
      case "synonym": {
        const text = unquote(rest);
        const scope = /"\s+(EXACT|NARROW|BROAD|RELATED)\b/.exec(rest)?.[1] as OboSynonym["scope"] | undefined;
        if (text) t.synonyms.push({ text, scope: scope ?? "RELATED" });
        break;
      }
      case "is_a":
        t.isA.push(idOf(rest));
        break;
      case "relationship": {
        const [rel, target] = rest.trim().split(/\s+/);
        if (rel === "part_of" || rel === "BFO:0000050") t.partOf.push(target);
        break;
      }
      case "is_obsolete":
        t.obsolete = rest.trim() === "true";
        break;
      case "replaced_by":
        t.replacedBy.push(idOf(rest));
        break;
      case "property_value": {
        const m = /^(\S+)\s+"([-0-9.eE+]+)"/.exec(rest.trim());
        if (m && Number.isFinite(Number(m[2]))) t.props[m[1]] = Number(m[2]);
        break;
      }
    }
  }
  flush();
  return out;
}

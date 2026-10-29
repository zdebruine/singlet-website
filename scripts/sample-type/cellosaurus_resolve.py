"""Cellosaurus candidates for the cell-line values of GEO records (exact identifier or synonym of the sample's species).

  python cellosaurus_resolve.py candidates SAMPLES_JSON CANDIDATES_JSON
      the normalised names to look up: each value of a "cell line" field (and of a type field that says "cell line"), with leading and
      trailing descriptors removed ("K562 Cell line" -> K562, "H1 human embryonic stem cells" -> H1), and its single alphanumeric
      tokens ("lung epithelial A549" -> A549). Mouse strains and genotypes ("C57BL/6J", "wild type") are not cell lines and are skipped.
  python cellosaurus_index.py CANDIDATES_JSON cellosaurus.txt INDEX_JSON          (on Clipper, where the dump is)
  python cellosaurus_resolve.py resolve SAMPLES_JSON INDEX_JSON cellosaurus_resolved.json
      {"<value lower-cased>|<organism>": {"via": "name"|"token", "name": <the name matched>, "candidates": [{ac, id, category}]}};
      only candidates of the sample's species. Picking one (unique, or the stem-cell line when the record says stem cells) is
      functions/_shared/sample-type.ts's job, per sample.
SAMPLES_JSON is a wrangler --json export of gsm (gsm_id, organism_primary, source, characteristics).
"""
import json
import re
import sys
from pathlib import Path

LINE_KEYS = {"cell line", "cell line name", "cellline", "cell lines", "parental cell line", "cell line background"}
TYPE_KEYS = {"source", "tissue", "tissue type", "sample type", "cell type", "sample source", "biomaterial", "specimen", "material", "model"}
# a strain or genotype is not a cell line (sample-type.ts STRAIN keeps the same list)
STRAIN = re.compile(
    r"^(c57 ?bl[/ ]?6\w*|c57bl\w*|b6\w*|balb[/ ]?c\w*|129\S*|fvb\S*|dba\S*|cd-?1|nod\S*|nsg\S*|nu/nu|nude|c3h\S*|swiss\S*|"
    r"sprague[- ]dawley|wistar\S*|wild[- ]?type|wt|wt/wt|\+/\+|mixed background)$",
    re.I,
)
NOT_A_LINE = re.compile(r"^(human|mouse|none|n/?a|na|primary|primary cells?|tissue|not applicable|unknown|-|control|cells?|patient.*|donor.*|pbmcs?|organoids?)$", re.I)
DESCRIPTORS = re.compile(
    r"^(?:human|mouse|murine|rat|parental|wild[- ]?type|wt)\s+|"
    r"\s+(?:cell ?lines?|cancer cell ?lines?|tumou?r cell ?lines?|cells?|line|human|mouse|embryonic stem cells?|human embryonic stem cells?|"
    r"es cells?|h?escs?|h?ipscs?|ips cells?|induced pluripotent stem cells?|pluripotent stem cells?|stem cells?|derived)$",
    re.I,
)
SPECIES = {"Homo sapiens": "Homo sapiens", "Mus musculus": "Mus musculus", "Rattus norvegicus": "Rattus norvegicus",
           "Danio rerio": "Danio rerio", "Macaca mulatta": "Macaca mulatta"}


def pairs(c):
    if not c:
        return []
    parts = c.split(";;") if ";;" in c else re.split(r";\s*(?=[A-Za-z][^;:]{0,59}:\s)", c)
    out = []
    for p in parts:
        if ":" in p:
            k, v = p.split(":", 1)
            out.append((re.sub(r"[_.\-]+", " ", k.strip().lower()).strip(), v.strip()))
    return out


def key(s):
    return re.sub(r"[\s\-_.]", "", s.lower())


def strip_descriptors(v):
    v = re.sub(r"\([^)]*\)", " ", v)
    v = re.sub(r"\s+", " ", v).strip(" ,;-")
    prev = None
    while prev != v:
        prev = v
        v = DESCRIPTORS.sub("", v).strip(" ,;-")
    return v


def tokens(v):
    return [t for t in re.split(r"[\s,;/()]+", v) if 3 <= len(t) <= 12 and re.search(r"[A-Za-z]", t) and re.search(r"\d", t)]


def values(samples):
    """(value, organism, token_only) for every cell-line value worth looking up."""
    for s in samples:
        org = s.get("organism_primary") or ""
        for k, v in pairs(s.get("characteristics")):
            if not v or len(v) > 120:
                continue
            if k in LINE_KEYS:
                if STRAIN.match(v.strip()) or NOT_A_LINE.match(v.strip()):
                    continue
                yield v, org, False
            elif k in TYPE_KEYS and re.search(r"\bcell ?lines?\b", v, re.I):
                yield v, org, True


def variants(v, token_only):
    name = strip_descriptors(v)
    out = []
    if not token_only and name and len(name) <= 30 and not STRAIN.match(name) and not NOT_A_LINE.match(name):
        out.append(("name", name))
    toks = tokens(name if name else v)
    out += [("token", t) for t in toks if not STRAIN.match(t)]
    return out


def main():
    mode = sys.argv[1]
    samples = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    samples = samples[0]["results"] if isinstance(samples, list) else samples
    if mode == "candidates":
        keys = set()
        for v, org, to in values(samples):
            for _, n in variants(v, to):
                keys.add(key(n))
        Path(sys.argv[3]).write_text(json.dumps(sorted(keys)))
        print(len(keys), "candidate keys", file=sys.stderr)
        return
    index = json.loads(Path(sys.argv[3]).read_text())
    out = {}
    for v, org, to in values(samples):
        k = f"{v.strip().lower()}|{org}"
        if k in out:
            continue
        want = SPECIES.get(org)
        res = None
        vs = variants(v, to)
        named = [n for how, n in vs if how == "name"]
        toks = [n for how, n in vs if how == "token"]
        for n in named:
            c = [x for x in index.get(key(n), []) if want and any(want in sp for sp in x["species"])]
            if c:
                res = {"via": "name", "name": n, "candidates": [{"ac": x["ac"], "id": x["id"], "category": x["category"]} for x in c]}
                break
        # a value that names several line-like tokens ("H1, HUES8") is several lines: no token pass, so none is dropped silently
        many = len([t for t in re.split(r"[\s,;/()]+", v) if 2 <= len(t) <= 12 and re.search(r"[A-Za-z]", t) and re.search(r"\d", t)]) > 1
        if res is None and not many:
            # a token only when the value holds exactly one token that names any line of the species
            hit = []
            for t in toks:
                c = [x for x in index.get(key(t), []) if want and any(want in sp for sp in x["species"])]
                if c:
                    hit.append((t, c))
            if len(hit) == 1:
                t, c = hit[0]
                res = {"via": "token", "name": t, "candidates": [{"ac": x["ac"], "id": x["id"], "category": x["category"]} for x in c]}
        out[k] = res
    Path(sys.argv[4]).write_text(json.dumps(out, indent=0))
    found = [r for r in out.values() if r]
    print(len(out), "values;", len(found), "with candidates;", sum(1 for r in found if len(r["candidates"]) == 1), "unique", file=sys.stderr)


if __name__ == "__main__":
    main()

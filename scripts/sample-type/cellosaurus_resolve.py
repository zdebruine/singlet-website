"""Resolve cell-line names from GEO 'cell line' fields to Cellosaurus accessions (exact identifier or synonym, unique, same species).

argv: SAMPLES_JSON OUT_JSON [CACHE_JSON]
SAMPLES_JSON is a wrangler --json export of gsm (gsm_id, organism_primary, source, characteristics). Writes
{name_norm|organism: {"ac": "CVCL_xxxx", "id": name, "category": ..., "species": ..., "synonyms": [...]} or null}.
Only the Cellosaurus API is called (api.cellosaurus.org), with a cache, a User-Agent and <= 3 requests/s.
"""
import json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

LINE_KEYS = {"cell line", "cell line name", "cell_line", "cellline", "cell lines", "parental cell line", "cell line background"}
NOT_A_LINE = re.compile(r"^(human|mouse|none|n/?a|na|primary|primary cells?|tissue|not applicable|unknown|-|control|wt|wild ?type|"
                        r"endothelial cells?|cells?|patient.*|donor.*|pbmcs?|organoids?|.*primary.*|.*tissue.*|.*patient.*|.*derived.*)$", re.I)
SPECIES = {"Homo sapiens": "Homo sapiens (Human)", "Mus musculus": "Mus musculus (Mouse)", "Rattus norvegicus": "Rattus norvegicus (Rat)",
           "Danio rerio": "Danio rerio (Zebrafish)", "Macaca mulatta": "Macaca mulatta (Rhesus macaque)"}

def pairs(c):
    if not c:
        return []
    parts = re.split(r"\s*;;\s*|;\s*(?=[A-Za-z][\w ./()-]{0,40}:\s)", c)
    return [(p.split(":", 1)[0].strip().lower(), p.split(":", 1)[1].strip()) for p in parts if ":" in p]

def clean(v):
    v = re.sub(r"\(.*?\)", " ", v)
    v = re.sub(r"\b(cell ?lines?|cells?|human|mouse|murine|parental|wild[ -]?type|wt|line)\b", " ", v, flags=re.I)
    return re.sub(r"\s+", " ", v).strip(" ,;-")

def key(s):
    return re.sub(r"[\s\-_.]", "", s.lower())

def query(field, name):
    q = f'{field}:"{name}"'
    url = "https://api.cellosaurus.org/search/cell-line?" + urllib.parse.urlencode({"q": q, "fields": "ac,id,sy,ca,ox", "format": "json", "rows": 20})
    req = urllib.request.Request(url, headers={"User-Agent": "singlet.bio-metadata/1.0 (zacharydebruine@gmail.com)"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)["Cellosaurus"]["cell-line-list"]
        except Exception:
            time.sleep(2 ** attempt)
    return None

def entry(e):
    ac = next(a["value"] for a in e["accession-list"] if a["type"] == "primary")
    names = [n["value"] for n in e["name-list"]]
    ident = next((n["value"] for n in e["name-list"] if n["type"] == "identifier"), names[0])
    sp = [s.get("value", s.get("label", "")) for s in e.get("species-list", [])]
    return {"ac": ac, "id": ident, "category": e.get("category"), "species": sp, "synonyms": names}

def resolve(name, organism, cache):
    ck = f"{key(name)}|{organism}"
    if ck in cache:
        return cache[ck]
    res = None
    hits = {}
    for field in ("id", "sy"):
        lst = query(field, name)
        time.sleep(0.35)
        if lst is None:
            return None  # transient: do not cache
        for e in lst:
            x = entry(e)
            if any(key(n) == key(name) for n in x["synonyms"]):
                hits[x["ac"]] = x
        if field == "id" and hits:
            break
    want = SPECIES.get(organism)
    same = [x for x in hits.values() if want and any(want.split(" (")[0] in s for s in x["species"])]
    if len(same) == 1:
        res = same[0]
    cache[ck] = res
    return res

def main():
    samples = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")[0:])
    samples = samples[0]["results"] if isinstance(samples, list) else samples
    out = Path(sys.argv[2])
    cache_p = Path(sys.argv[3]) if len(sys.argv) > 3 else out.with_suffix(".cache.json")
    cache = json.loads(cache_p.read_text()) if cache_p.exists() else {}
    names = {}
    for s in samples:
        for k, v in pairs(s.get("characteristics")):
            if k in LINE_KEYS:
                c = clean(v)
                if c and len(c) <= 30 and not NOT_A_LINE.match(c) and not NOT_A_LINE.match(v.strip()):
                    names[(c, s.get("organism_primary") or "")] = names.get((c, s.get("organism_primary") or ""), 0) + 1
    print(len(names), "distinct (name, organism)", file=sys.stderr)
    resolved = {}
    for i, (n, org) in enumerate(sorted(names, key=lambda t: -names[t])):
        r = resolve(n, org, cache)
        resolved[f"{key(n)}|{org}"] = r
        if i % 50 == 0:
            cache_p.write_text(json.dumps(cache))
            print(i, n, org, r and r["ac"], file=sys.stderr)
    cache_p.write_text(json.dumps(cache))
    # Second pass: a known line inside a longer description ("lung epithelial A549"): a token with letters and digits that is, by
    # itself, exactly one line of the species. The whole value must hold a single such token, so "H1_J_PP, HUES8_J_PP" stays out.
    for (n, org) in names:
        k = f"{key(n)}|{org}"
        if resolved.get(k):
            continue
        toks = [t for t in re.split(r"[\s,;/()]+", n) if 3 <= len(t) <= 12 and re.search(r"[A-Za-z]", t) and re.search(r"\d", t)]
        hits = [r for r in (resolve(t, org, cache) for t in toks) if r]
        if len(toks) == 1 and len(hits) == 1:
            resolved[k] = {**hits[0], "via_token": toks[0]}
    cache_p.write_text(json.dumps(cache))
    out.write_text(json.dumps(resolved, indent=0))
    print(sum(1 for v in resolved.values() if v), "resolved of", len(resolved), file=sys.stderr)

if __name__ == "__main__":
    main()

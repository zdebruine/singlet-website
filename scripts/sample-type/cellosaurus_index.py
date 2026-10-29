"""Cellosaurus entries for a set of candidate names, from the full text dump (exact identifier or synonym match, normalised).

argv: CANDIDATES_JSON CELLOSAURUS_TXT OUT_JSON
CANDIDATES_JSON is a list of normalised keys (key(): lower case, spaces, '-', '_' and '.' removed). Writes
{key: [{"ac", "id", "category", "species": [...], "via": "id"|"synonym"}]} for every key with at least one entry.
Run where the dump is (a Clipper job; the dump is https://ftp.expasy.org/databases/cellosaurus/cellosaurus.txt).
"""
import json
import re
import sys
from pathlib import Path


def key(s: str) -> str:
    return re.sub(r"[\s\-_.]", "", s.lower())


def main() -> None:
    want = set(json.loads(Path(sys.argv[1]).read_text()))
    out: dict[str, list[dict]] = {}
    cur: dict = {}

    def flush() -> None:
        if not cur.get("ac"):
            return
        names = [("id", cur["id"])] + [("synonym", s) for s in cur.get("sy", [])]
        for via, n in names:
            k = key(n)
            if k in want:
                lst = out.setdefault(k, [])
                if not any(x["ac"] == cur["ac"] for x in lst):
                    lst.append({"ac": cur["ac"], "id": cur["id"], "category": cur.get("ca"), "species": cur.get("ox", []), "via": via, "synonyms": cur.get("sy", [])[:40]})

    with open(sys.argv[2], encoding="utf-8", errors="replace") as fh:
        for line in fh:
            tag, val = line[:2], line[5:].rstrip("\n")
            if tag == "ID":
                cur = {"id": val.strip(), "sy": [], "ox": []}
            elif tag == "AC":
                cur["ac"] = val.strip()
            elif tag == "SY":
                cur["sy"] += [s.strip() for s in val.split(";") if s.strip()]
            elif tag == "OX":
                m = re.search(r"! (.+)$", val)
                if m:
                    cur["ox"].append(m.group(1).strip())
            elif tag == "CA":
                cur["ca"] = val.strip()
            elif tag == "//":
                flush()
                cur = {}
    Path(sys.argv[3]).write_text(json.dumps(out))
    print(len(want), "keys asked,", len(out), "found", file=sys.stderr)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""SQL and a review CSV for the ontology terms map_unmapped.ts found for served samples' unmapped sample_attr values.

argv: MAPPED_JSONL UNMAPPED_VALUES_JSON GSM_GSE_JSON OUT_DIR
Writes OUT_DIR/terms.sql and OUT_DIR/terms-review.csv. Files only; nothing touches D1.

terms.sql, every statement idempotent:
  - ontology_value_map: INSERT OR IGNORE one row per (attr, organism, value_norm, term_id); future extractor runs then map the value.
  - sample_term: INSERT OR IGNORE one row per sample carrying the value (attr tissue / disease / development_stage).
  - sample_attr.ontology_id: set where it is NULL, for the row carrying the value (source 'geo').
Apply AFTER scripts/metadata-gaps/out/backfill.sql: some values are rows that file adds (their UPDATE matches nothing before it).
"""
import csv
import json
import sys
from pathlib import Path

TERM_ATTR = {"tissue": "tissue", "disease": "disease", "age": "development_stage", "life_stage": "development_stage"}


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def main():
    mapped_p, values_p, gse_p, out = sys.argv[1:5]
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    mapped = [json.loads(ln) for ln in open(mapped_p, encoding="utf-8") if ln.strip()]
    values = json.load(open(values_p, encoding="utf-8"))
    raw = open(gse_p, encoding="utf-8").read()
    gse = {r["gsm_id"]: r["gse_id"] for r in json.loads(raw[raw.index("["):])[0]["results"]}
    sql = [
        "-- Ontology terms for served samples' sample_attr values that had none (scripts/metadata-gaps/map_unmapped.ts + emit_terms_sql.py).",
        "-- NOT APPLIED. Review terms-review.csv first. Apply AFTER out/backfill.sql. Every statement is idempotent.",
        "",
    ]
    rows = []
    n_ovm = n_term = n_attr = 0
    for m in mapped:
        sql.append(
            "INSERT OR IGNORE INTO ontology_value_map (attr, organism, value_norm, term_id, method, source, confidence, evidence, mapper_version) VALUES ("
            + ", ".join(q(x) for x in [m["attr"], m["organism"], m["value_norm"], m["term_id"], m["method"],
                                         "model" if m["method"] == "model" else "geo", m["confidence"], m["evidence"], m["mapper_version"]])
            + ");"
        )
        n_ovm += 1
        tattr = TERM_ATTR[m["attr"]]
        for v in values:
            if v["attr"] != m["attr"] or v["value"] != m["value_norm"] or (m["organism"] and v["organism"] != m["organism"]):
                continue
            for g in v["gsm_ids"]:
                if g not in gse:
                    continue
                sql.append(
                    "INSERT OR IGNORE INTO sample_term (gsm_id, gse_id, attr, term_id, source, confidence, from_attr) VALUES ("
                    + ", ".join(q(x) for x in [g, gse[g], tattr, m["term_id"], "model" if m["method"] == "model" else "geo", m["confidence"], m["attr"]])
                    + ");"
                )
                sql.append(
                    f"UPDATE sample_attr SET ontology_id = {q(m['term_id'])} WHERE gsm_id = {q(g)} AND attr = {q(m['attr'])} AND source = 'geo' "
                    f"AND TRIM(value_norm) = {q(m['value_norm'])} AND ontology_id IS NULL;"
                )
                n_term += 1
                n_attr += 1
                rows.append([g, gse[g], v["organism"], m["attr"], m["value_norm"], m["term_id"], m["label"], m["method"], m["confidence"], m["evidence"]])
    (out / "terms.sql").write_text("\n".join(sql) + "\n", encoding="utf-8", newline="\n")
    with open(out / "terms-review.csv", "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["gsm_id", "gse_id", "organism", "attr", "value_norm", "term_id", "term_label", "method", "confidence", "evidence"])
        w.writerows(rows)
    print(json.dumps({"ontology_value_map": n_ovm, "sample_term": n_term, "sample_attr_updates": n_attr, "samples": len({r[0] for r in rows})}))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Check a packed .singlet study file for every layer and the GEO metadata/provenance.
usage: verify_bundle_v3.py BUNDLE.singlet [--expect-vdj]   exit 1 if a required layer is missing.
Layers (member under samples/<GSM>/): size > 0 is required for REQUIRED, reported for OPTIONAL.
"""
import json, sys, zipfile

LAYERS = {  # layer -> (members any-of, required)
    "counts:exon": (["exon_counts.1pz"], True),
    "counts:intron": (["intron_counts.1pz"], True),
    "counts:junction": (["sj_counts.1pz"], True),
    "splicing": (["splice_psi.1pz", "splice_events.tsv"], True),
    "snp_genotypes": (["donor/snp_ad.1pz", "donor/snp_dp.1pz"], True),
    "donor_assignments": (["donor/donor_assignments.tsv"], True),
    "ancestry": (["ancestry_call.json"], True),
    "sex": (["sex_call.json"], True),
    "doublets": (["doublet_scores.tsv"], True),
    "mt_variants": (["mt_variants.tsv", "mt.1pz", "mt_heteroplasmy.1pz"], True),
    "vdj": (["vdj_gene_usage.1pz"], False),
    "provenance": (["provenance.json"], True),
    "summary": (["summary.json"], True),
}
SERIES_KEYS = ["series_title", "series_summary", "series_overall_design", "gsm_meta"]  # publications: only when GEO lists a PubMed id
GSM_KEYS = ["organism", "sample_source", "sample_characteristics", "reference_build", "n_cells"]


def main():
    path = sys.argv[1]
    z = zipfile.ZipFile(path)
    size = {i.filename: i.file_size for i in z.infolist()}
    man = json.loads(z.read("manifest.json")); sm = json.loads(z.read("study_meta.json"))
    bad = 0
    print(f"bundle {path}: {len(size)} members, gse={man['gse_id']} gsms={man['gsm_ids']} "
          f"singlet_version={man.get('singlet_version')} excluded={man.get('excluded_samples')}")
    for gsm in man["gsm_ids"]:
        print(f"--- {gsm}")
        for layer, (names, req) in LAYERS.items():
            hit = [(n, size[f"samples/{gsm}/{n}"]) for n in names if size.get(f"samples/{gsm}/{n}", 0) > 0]
            tag = "OK " if hit else ("MISSING" if req else "absent(optional)")
            if not hit and req:
                bad += 1
            print(f"  {layer:18s} {tag:16s} {hit}")
        pv = json.loads(z.read(f"samples/{gsm}/provenance.json"))
        print("  provenance keys:", sorted(pv)[:25])
        sj = json.loads(z.read(f"samples/{gsm}/summary.json"))
        gate = bool(pv.get("parameters", {}).get("pipeline")) and bool(pv.get("references", {}).get("snp_vcf", {}).get("name"))
        print(f"  publisher gate (pipeline=true, snp_vcf set): {gate} | version {pv.get('singlet_version')} | summary git_sha {sj.get('git_sha')} "
              f"| genome {pv.get('references', {}).get('genome', {}).get('build')} | provenance.singlet_git_sha {pv.get('singlet_git_sha')} (engine default; commit is in summary.json)")
        if not gate:
            bad += 1
        gm = sm["gsm_meta"].get(gsm, {})
        miss = [k for k in GSM_KEYS if not gm.get(k)]
        print(f"  gsm_meta missing/empty: {miss}  chars={str(gm.get('sample_characteristics'))[:90]!r}")
        if miss and "n_cells" not in miss:
            bad += 1
    miss = [k for k in SERIES_KEYS if not sm.get(k)]
    print("study_meta empty keys:", miss, "| title:", sm.get("series_title", "")[:80])
    print("other members:", sorted({n.split("/")[2] if n.startswith("samples/") else n for n in size})[:60])
    sys.exit(1 if bad or miss else 0)


main()

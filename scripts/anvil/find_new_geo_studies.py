# Usage: SCGEO_DISCOVERY_PY=<singlet-agents>/geo-reprocess/scgeo/catalog/discovery.py python find_new_geo_studies.py
# Writes geo_new.tsv: human/mouse GSEs released since 2026-09-01 (default droplet query = tier A, broad single-cell query = tier B). Filter against D1 gse.id afterwards.
import json, re, time, urllib.request, urllib.parse, sys
import os
src=open(os.environ['SCGEO_DISCOVERY_PY'],encoding='utf8').read()
m=re.search(r'DEFAULT_SINGLE_CELL_QUERY = \((.*?)\n\)\n',src,re.S)
q_default=eval('('+m.group(1)+')')
E="https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
def get(ep,p):
    time.sleep(0.4)
    u=E+ep+"?"+urllib.parse.urlencode(p)
    for i in range(4):
        try: return json.load(urllib.request.urlopen(u,timeout=60))
        except Exception as e: time.sleep(2)
    raise
org='("Homo sapiens"[Organism] OR "Mus musculus"[Organism])'
broad='("single cell"[All Fields] OR scRNA-seq[All Fields] OR snRNA-seq[All Fields] OR "single nucleus"[All Fields] OR "single-cell"[All Fields]) AND "expression profiling by high throughput sequencing"[DataSet Type] AND gse[Entry Type]'
out={}
for name,q in (("default",q_default),("broad",broad)):
    for rng in ("2026/09/01:2026/10/20[PDAT]","2026/09/03:2026/10/20[PDAT]"):
        t=f"({q}) AND {org} AND {rng}"
        r=get("esearch.fcgi",dict(db="gds",term=t,retmax=2000,retmode="json"))["esearchresult"]
        print(name,rng,r["count"])
        if rng.startswith("2026/09/01"): out[name]=r["idlist"]
ids=sorted(set(out["default"])|set(out["broad"]))
rows={}
for i in range(0,len(ids),100):
    r=get("esummary.fcgi",dict(db="gds",id=",".join(ids[i:i+100]),retmode="json"))["result"]
    for u in r.get("uids",[]):
        d=r[u]; rows[d["accession"]]=d
with open("geo_new.tsv","w",encoding="utf8") as f:
    f.write("gse\torganism\tn_samples\tpdat\tin_default\tin_broad\ttitle\n")
    for acc,d in sorted(rows.items(),key=lambda x:int(x[0][3:])):
        if not acc.startswith("GSE"): continue
        u=d["uid"]
        f.write("\t".join([acc,d.get("taxon",""),str(d.get("n_samples","")),d.get("pdat",""),str(u in out["default"]),str(u in out["broad"]),d.get("title","").replace("\t"," ")[:110]])+"\n")
print(len(rows))

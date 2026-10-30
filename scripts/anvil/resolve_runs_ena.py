# Resolves tier A GSEs to SRR runs and read counts via esummary (BioProject) + ENA filereport. Writes ena_tierA.tsv. Run from the repo root.
import csv,json,time,urllib.request,urllib.parse,collections,sys
E="https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
def j(u):
    for i in range(4):
        try: return urllib.request.urlopen(u,timeout=60).read().decode()
        except Exception as e: time.sleep(2)
    return ""
rows=[r for r in csv.DictReader(open('scripts/anvil/new_studies.tsv',encoding='utf8'),delimiter='\t') if r['tier'].startswith('A') and r['organism'] in('Homo sapiens','Mus musculus')]
ids=[r['gse'] for r in rows]
bp={}
d=json.loads(j(E+"esummary.fcgi?"+urllib.parse.urlencode(dict(db="gds",term="",id="")))) if False else None
# map accession->uid via esearch
for i in range(0,len(ids),50):
    chunk=ids[i:i+50]
    t=" OR ".join(f"{g}[ACCN]" for g in chunk)
    time.sleep(.4)
    r=json.loads(j(E+"esearch.fcgi?"+urllib.parse.urlencode(dict(db="gds",term=t,retmax=100,retmode="json"))))["esearchresult"]["idlist"]
    time.sleep(.4)
    s=json.loads(j(E+"esummary.fcgi?"+urllib.parse.urlencode(dict(db="gds",id=",".join(r),retmode="json"))))["result"]
    for u in s.get("uids",[]):
        bp[s[u]["accession"]]=s[u].get("bioproject","")
print(len(bp), sum(1 for v in bp.values() if v))
out=open('ena_tierA.tsv','w')
out.write("gse\tbioproject\trun\tgsm\tstrategy\tsource\tplatform\tread_count\n")
nofound=0
for g in ids:
    p=bp.get(g)
    if not p: nofound+=1; continue
    time.sleep(.15)
    txt=j("https://www.ebi.ac.uk/ena/portal/api/filereport?"+urllib.parse.urlencode(dict(accession=p,result="read_run",fields="run_accession,sample_alias,library_strategy,library_source,instrument_platform,read_count",format="tsv")))
    lines=txt.strip().split("\n")[1:]
    for l in lines:
        f=l.split("\t")
        if len(f)>=6: out.write("\t".join([g,p,f[0],f[1],f[2],f[3],f[4],f[5]])+"\n")
print("no bioproject",nofound)

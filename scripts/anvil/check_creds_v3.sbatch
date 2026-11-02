#!/bin/bash
#SBATCH -A bio260157
#SBATCH -p shared
#SBATCH -N 1 -n 1 -c 1
#SBATCH --mem=2G
#SBATCH -t 00:10:00
#SBATCH -o /anvil/projects/x-bio260157/singlet_campaign/logs/v3/creds_%j.out
# Read-only test that ~/.singlet/cloudflare.env still authenticates to D1 and R2 (and that mybalance works on compute).
set -uo pipefail
set -a; source ~/.singlet/cloudflare.env; set +a
[ -f ~/.singlet/ingest.env ] && echo "ingest.env present" || echo "ingest.env ABSENT (refresh-next/index-next left to catalog-crank)"
mybalance | tail -2
/apps/anvil/external/apps/conda/2024.02/bin/python3 - <<'PY'
import os, json, urllib.request
import boto3
acct, db, tok = os.environ["CLOUDFLARE_ACCOUNT_ID"], os.environ["D1_DATABASE_ID"], os.environ["CF_D1_API_TOKEN"]
rq = urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{acct}/d1/database/{db}/query",
    data=json.dumps({"sql": "SELECT COUNT(*) AS n FROM gse"}).encode(),
    headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
r = json.load(urllib.request.urlopen(rq, timeout=60))
print("D1 read ok:", r["success"], r["result"][0]["results"])
s3 = boto3.client("s3", endpoint_url=os.environ["R2_ENDPOINT"], aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
                  aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"], region_name="auto")
h = s3.head_object(Bucket=os.environ["R2_BUCKET"], Key="data/GSE138867/GSE138867.singlet")
print("R2 head ok: bytes", h["ContentLength"])
print("site:", json.load(urllib.request.urlopen(urllib.request.Request("https://singlet.bio/api/stats", headers={"User-Agent": "singlet-anvil-campaign/1.0"}), timeout=60)).get("studies_with_files"))
PY
echo "exit=$?"

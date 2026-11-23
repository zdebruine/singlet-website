"""Ground truth for the TS pz2 decoder: decode every .1pz member of the given sample objects with singlet._pz2 (canonical mode)
and write <gsm>.<member>.{indptr,indices,data}.bin plus a sha256 summary JSON."""
import hashlib, json, subprocess, sys, os
import numpy as np
import singlet._pz2 as p

out = sys.argv[1]
gses = sys.argv[2:]
summary = []
for spec in gses:
    gse, nsamp = spec.split(":") if ":" in spec else (spec, "1")
    m = json.loads(subprocess.run(["curl", "-sf", f"https://data.singlet.bio/s1/m/{gse}.json"], capture_output=True, check=True).stdout)
    for s in m["samples"][: int(nsamp)]:
        path = os.path.join(out, s["key"].replace("/", "_"))
        if not os.path.exists(path):
            subprocess.run(["curl", "-sf", "-o", path, "https://data.singlet.bio/" + s["key"]], check=True)
        buf = open(path, "rb").read()
        for name, mem in s["members"].items():
            if not name.endswith(".1pz"):
                continue
            b = buf[mem["off"] : mem["off"] + mem["len"]]
            h = p.read_header(b[:256])
            r = p.decode(b, mode="canonical")
            ip = np.asarray(r["indptr"], dtype=np.int64)
            ix = np.asarray(r["indices"], dtype=np.uint32)
            dv = np.asarray(r["data"], dtype=np.uint32)
            summary.append({
                "gse": gse, "gsm": s["gsm"], "key": s["key"], "member": name, "off": mem["off"], "len": mem["len"],
                "codec": h.get("codec"), "m": int(r["n_rows"]), "n": int(r["n_cols"]), "nnz": int(r["nnz"]),
                "sha_indptr": hashlib.sha256(ip.astype("<i8").tobytes()).hexdigest(),
                "sha_indices": hashlib.sha256(ix.astype("<u4").tobytes()).hexdigest(),
                "sha_data": hashlib.sha256(dv.astype("<u4").tobytes()).hexdigest(),
            })
            print(s["gsm"], name, h.get("codec"), r["n_rows"], r["n_cols"], r["nnz"], flush=True)
json.dump(summary, open(os.path.join(out, "truth.json"), "w"), indent=1)

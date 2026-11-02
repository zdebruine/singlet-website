#!/bin/bash
# Reconcile the packer: the Anvil fork (pylib/cf_pack.py) is retired for v3. Use Singlet-Bio/singlet python/singlet/bundle.py
# from the SAME checkout as the binary, verbatim except for _singlet_version(), which cannot import the package here
# (no compiled _pz module on Anvil) and so reads the pipeline version from the binary's directory instead.
# Usage: cf_pack_v3_prepare.sh <bin_v3_dir>   -> writes <root>/pylib_v3/cf_pack_v3.py
set -euo pipefail
D=${1:?bin_v3_dir}; R=/anvil/projects/x-bio260157/singlet_campaign
SRC=$R/src_v3/python/singlet/bundle.py
SHA=$(cat "$D/GIT_SHA")
git -C "$R/src_v3" cat-file -e "$SHA:python/singlet/bundle.py"
mkdir -p "$R/pylib_v3"
git -C "$R/src_v3" show "$SHA:python/singlet/bundle.py" > "$R/pylib_v3/cf_pack_v3.py"
/apps/anvil/external/apps/conda/2024.02/bin/python3 - "$R/pylib_v3/cf_pack_v3.py" "$D" <<'PY'
import re, sys
p, d = sys.argv[1], sys.argv[2]
s = open(p).read()
new = ('def _singlet_version() -> str:\n'
       '    """Pipeline version: the binary this checkout was built into (Anvil v3), else the package version."""\n'
       '    import re as _re\n'
       f'    try:\n        return open("{d}/VERSION").read().strip()\n    except OSError:\n        pass\n'
       '    return "unknown"\n\n\n')
s2, n = re.subn(r'def _singlet_version\(\) -> str:.*?\n(?=# -{20,})', new, s, count=1, flags=re.S)
assert n == 1, "could not patch _singlet_version"
open(p, "w").write(s2)
print("patched _singlet_version ->", d + "/VERSION")
PY
echo "pack source: $SHA bundle.py"

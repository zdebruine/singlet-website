#!/bin/bash
#SBATCH --partition=shared
#SBATCH --account=bio260157
#SBATCH --cpus-per-task=12
#SBATCH --mem=22G
#SBATCH --time=00:45:00
#SBATCH --job-name=singlet_build_v3
#SBATCH --output=/anvil/projects/x-bio260157/singlet_campaign/logs/build_v3_%j.out
# Build Singlet-Bio/singlet main into a NEW versioned directory; the v2 binary in bin/ is never touched.
# Usage: sbatch build_v3.sbatch [git-ref]   (default origin/main)
set -uo pipefail
REF=${1:-origin/main}
R=/anvil/projects/x-bio260157/singlet_campaign
ENV="${HOME}/.conda/envs/singlet_build"
echo "=== build_v3 $(date -Is) host=$(hostname) ==="
echo "--- outbound internet from compute ---"
curl -sS -m 20 -o /dev/null -w "github http=%{http_code}\n" https://github.com || echo "github BLOCKED"
curl -sS -m 20 -o /dev/null -w "ena http=%{http_code}\n" "https://www.ebi.ac.uk/ena/portal/api/filereport?accession=SRR1&result=read_run&fields=run_accession" || echo "ena BLOCKED"
curl -sS -m 20 -o /dev/null -w "ncbi http=%{http_code}\n" https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi || echo "ncbi BLOCKED"
curl -sS -m 20 -o /dev/null -w "r2/cloudflare http=%{http_code}\n" https://singlet.bio/api/stats || echo "singlet.bio BLOCKED"

SRC=$R/src_v3
[ -d "$SRC/.git" ] || git clone https://github.com/Singlet-Bio/singlet.git "$SRC" || exit 1
cd "$SRC" && git fetch -q origin && git checkout -q --detach "$REF" || exit 1
# Singlet-Bio/singlet .gitignore lists src/star/htslib/htslib/ (the vendored htslib headers), so a clean clone cannot
# compile bam_cat.c. Seed that git-ignored dir from the v2 source tree, which has the same vendored headers.
if [ ! -f src/star/htslib/htslib/sam.h ]; then
  cp -r "$R/src/src/star/htslib/htslib" src/star/htslib/htslib && echo "seeded vendored htslib headers from v2 src"
fi
SHA=$(git rev-parse HEAD); SHORT=$(git rev-parse --short=7 HEAD)
OUT=$R/bin_v3_$SHORT
[ -e "$OUT" ] && { echo "$OUT exists, refusing to overwrite"; exit 2; }
echo "building $SHA -> $OUT"
module purge 2>/dev/null || true
module load gcc/11.2.0 2>/dev/null || true
export CC="$(command -v gcc)"; export CXX="$(command -v g++)"
export PKG_CONFIG_PATH="${ENV}/lib/pkgconfig:/usr/lib64/pkgconfig:/usr/share/pkgconfig:${PKG_CONFIG_PATH:-}"
BUILD=$R/build_v3_$SHORT; rm -rf "$BUILD"; mkdir -p "$BUILD"
cmake -S "$SRC" -B "$BUILD" -DSINGLET_BUILD_PIPELINE=ON -DSINGLET_BUILD_GPU=OFF -DSINGLET_BUILD_PYTHON=OFF \
  -DSINGLET_BUILD_TESTS=OFF -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH="${ENV}" \
  -DCMAKE_INCLUDE_PATH="${ENV}/include" -DCMAKE_LIBRARY_PATH="${ENV}/lib" \
  -DZSTD_LIBRARY="${ENV}/lib/libzstd.so" -DZSTD_INCLUDE_DIR="${ENV}/include"
echo "=== configure exit=$? ==="
cmake --build "$BUILD" -j "${SLURM_CPUS_PER_TASK:-12}"
echo "=== build exit=$? ==="
BIN="$(find "$BUILD" -type f -executable -name singlet | head -1)"
[ -n "$BIN" ] || { echo "NO BINARY"; exit 3; }
mkdir -p "$OUT/bin" "$OUT/whitelists"
cp "$BIN" "$OUT/bin/singlet.bin"
cp "$R"/bin/whitelists/* "$OUT/whitelists/"                       # incl. visium-v1 (local addition)
cp -n "$SRC"/python/singlet/data/whitelists/*.txt "$OUT/whitelists/" 2>/dev/null
ln -s "$R/bin/lib" "$OUT/bin/lib"
cat > "$OUT/bin/singlet" <<W
#!/bin/bash
export LD_LIBRARY_PATH=${ENV}/lib:\${LD_LIBRARY_PATH:-}
exec $OUT/bin/singlet.bin "\$@"
W
chmod +x "$OUT/bin/singlet"
echo "$SHA" > "$OUT/GIT_SHA"
grep -oE 'SINGLET_VERSION_STRING "[^"]+"' "$SRC/include/singlet/version.h" | head -1 | cut -d'"' -f2 > "$OUT/VERSION"
cat "$OUT/VERSION"
LD_LIBRARY_PATH="${ENV}/lib:${LD_LIBRARY_PATH:-}" ldd "$OUT/bin/singlet.bin" 2>&1 | grep -i 'not found' || echo "all libs resolve"
"$OUT/bin/singlet" --version 2>&1 | head -3; "$OUT/bin/singlet" --help 2>&1 | head -3
echo "=== done $(date -Is) sha=$SHA out=$OUT ==="

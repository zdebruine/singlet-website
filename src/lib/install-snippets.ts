/**
 * The install commands, in one place.
 *
 * Python installs from PyPI (`singlet` 1.2.0 and later: wheels with the compiled codec for Linux, macOS and Windows).
 * R installs from GitHub until a CRAN release and compiles a small C++17 extension (Zstandard is bundled).
 */
export const PY_INSTALL = "pip install singlet";
export const R_INSTALL = 'remotes::install_github("Singlet-Bio/singlet", subdir = "r")';

/** What the R source build needs: a C++17 compiler. Zstandard is bundled in the package. */
export const BUILD_DEPS = "# Linux: sudo apt install build-essential\n# macOS: xcode-select --install\n# Windows: install Rtools";

/** Python install with an extra, e.g. `pyInstallExtra("torch")`. */
export function pyInstallExtra(extra: string): string {
  return `pip install "singlet[${extra}]"`;
}

/** Bioconductor packages behind the default SingleCellExperiment return type. */
export const R_BIOC_DEPS = 'BiocManager::install(c("SingleCellExperiment", "SummarizedExperiment", "S4Vectors"))';

/** Standalone R snippets need `remotes` and the Bioconductor deps first; inline mentions do not. */
export const R_INSTALL_STANDALONE = `install.packages(c("remotes", "BiocManager"))\n${R_BIOC_DEPS}\n${R_INSTALL}`;

export const GITHUB_REPO = "https://github.com/Singlet-Bio/singlet";
export const GITHUB_ISSUES = "https://github.com/Singlet-Bio/singlet/issues";
export const DATA_BASE = "https://data.singlet.bio";

/** The flagship example study used across the site (8/8 usable samples, ~193 MB). */
export const EXAMPLE_GSE = "GSE138867";

/** Python: load one study (install is a separate bash block — never mix pip into Python). */
export function pySnippet(gse = EXAMPLE_GSE): string {
  return `import singlet\nadata = singlet.load("${gse}")   # AnnData`;
}

/** R: install + load one study. */
export function rSnippet(gse = EXAMPLE_GSE): string {
  return `${R_INSTALL_STANDALONE}\n\nlibrary(singlet)\nsce <- singlet::load("${gse}")   # SingleCellExperiment`;
}

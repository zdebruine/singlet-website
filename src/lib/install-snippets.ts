/**
 * The install commands, in one place.
 *
 * Both packages install from GitHub until wheels / a CRAN release are
 * published under a name we control. Never print a bare PyPI install line:
 * the `singlet` name on PyPI currently belongs to an unrelated package.
 * Both builds compile a small C++17 extension against libzstd.
 */
export const PY_INSTALL = 'pip install "singlet @ git+https://github.com/Singlet-Bio/singlet"';
export const R_INSTALL = 'remotes::install_github("Singlet-Bio/singlet", subdir = "r")';

/** System packages the source build needs (a C++17 compiler and the zstd headers). */
export const BUILD_DEPS = "# Linux: sudo apt install build-essential libzstd-dev\n# macOS: brew install zstd";

/** Python install with an extra, e.g. `pyInstallExtra("torch")`. */
export function pyInstallExtra(extra: string): string {
  return `pip install "singlet[${extra}] @ git+https://github.com/Singlet-Bio/singlet"`;
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

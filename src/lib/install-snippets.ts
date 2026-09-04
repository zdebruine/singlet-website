/**
 * The install commands, in one place.
 *
 * The packages install from GitHub for now. When the PyPI / CRAN releases are
 * accepted, switch these two lines to `pip install singlet` and
 * `install.packages("singlet")` — nothing else on the site needs to change.
 */
export const PY_INSTALL = "pip install git+https://github.com/Singlet-Bio/singlet";
export const R_INSTALL = 'remotes::install_github("Singlet-Bio/singlet", subdir = "r")';

/** Standalone R snippets need `remotes` first; inline mentions do not. */
export const R_INSTALL_STANDALONE = `install.packages("remotes")\n${R_INSTALL}`;

export const GITHUB_REPO = "https://github.com/Singlet-Bio/singlet";
export const GITHUB_ISSUES = "https://github.com/Singlet-Bio/singlet/issues";
export const DATA_BASE = "https://data.singlet.bio";

/** Python: install + load one study. */
export function pySnippet(gse = "GSE178957"): string {
  return `${PY_INSTALL}\n\nimport singlet\nadata = singlet.load("${gse}")   # AnnData`;
}

/** R: install + load one study. */
export function rSnippet(gse = "GSE178957"): string {
  return `${R_INSTALL_STANDALONE}\n\nlibrary(singlet)\nsce <- load("${gse}")   # SingleCellExperiment`;
}

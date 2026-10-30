/**
 * How to cite singlet.bio, in one place. The About page, the license page, the docs, the study Cite dialog, the
 * Croissant metadata and the MCP instructions read these; CITATION.cff here and in Singlet-Bio/singlet say the same.
 */

export const RELEASE_NAME = "Singlet Research Alpha (October 2026)";
export const CITE_URL = "https://singlet.bio";
/** The page that explains what to cite. */
export const CITE_PAGE = "https://singlet.bio/about#cite";
const PACKAGE_REPO = "https://github.com/Singlet-Bio/singlet";
const AUTHOR = "DeBruine Z";
const AUTHOR_BIB = "DeBruine, Zachary";
const YEAR = 2026;
const ATLAS_TITLE = "singlet.bio: an open atlas of public single-cell RNA-seq studies reprocessed from raw reads";
const SOFTWARE_TITLE = "singlet: Python and R packages for the singlet.bio atlas";

/** Today as YYYY-MM-DD, for the access date. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The atlas, as one line. Without `accessed` it has no access date (for machine-readable metadata). */
export function atlasCitation(accessed?: string): string {
  return `${AUTHOR}. ${ATLAS_TITLE}. ${RELEASE_NAME}. ${CITE_URL}${accessed ? ` (accessed ${accessed})` : ""}.`;
}

export function atlasBibtex(accessed = today()): string {
  return [
    `@misc{debruine${YEAR}singletbio,`,
    `  author       = {${AUTHOR_BIB}},`,
    `  title        = {{singlet.bio}: an open atlas of public single-cell {RNA-seq} studies reprocessed from raw reads},`,
    `  year         = {${YEAR}},`,
    `  howpublished = {\\url{${CITE_URL}}},`,
    `  url          = {${CITE_URL}},`,
    `  note         = {${RELEASE_NAME}. Accessed ${accessed}}`,
    `}`,
  ].join("\n");
}

export function atlasRis(accessed = today()): string {
  return [
    `TY  - DATA`,
    `AU  - ${AUTHOR_BIB}`,
    `TI  - ${ATLAS_TITLE}`,
    `PY  - ${YEAR}`,
    `ET  - ${RELEASE_NAME}`,
    `UR  - ${CITE_URL}`,
    `Y2  - ${accessed}`,
    `ER  - `,
  ].join("\n");
}

/** The Python and R packages. Add the version you used: `singlet.__version__` or `packageVersion("singlet")`. */
export const SOFTWARE_CITATION = `${AUTHOR}. ${SOFTWARE_TITLE}. ${YEAR}. ${PACKAGE_REPO}`;

export const SOFTWARE_BIBTEX = [
  `@misc{debruine${YEAR}singlet,`,
  `  author       = {${AUTHOR_BIB}},`,
  `  title        = {singlet: {Python} and {R} packages for the {singlet.bio} atlas},`,
  `  year         = {${YEAR}},`,
  `  howpublished = {\\url{${PACKAGE_REPO}}},`,
  `  url          = {${PACKAGE_REPO}}`,
  `}`,
].join("\n");

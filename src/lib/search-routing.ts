/**
 * Where a search submission goes.
 *  - "GSE123"  → the study page
 *  - "GSM123"  → the sample redirect (lands on /study/<gse>#GSM123)
 *  - anything else → /browse?q=<text>
 */
export function searchDestination(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const acc = text.toUpperCase();
  if (/^GSE\d{3,}$/.test(acc)) return `/study/${acc}`;
  if (/^GSM\d{3,}$/.test(acc)) return `/sample/${acc}`;
  return `/browse?q=${encodeURIComponent(text)}`;
}

export const EXAMPLE_QUERIES = [
  "microglia in the aging mouse brain",
  "human PBMC, COVID-19, 10x 5'",
  "tumor-infiltrating T cells in melanoma",
  "zebrafish development",
] as const;

/**
 * /cells — search cells across the atlas (GET /api/cells; docs/CELL-SEARCH.md).
 *
 * One box: a plain-English question, read into filters that come back as chips (the vocabulary first, the catalog interpreter for
 * leftovers), or a JSON filter (AND / OR / NOT, ontology terms match descendants). The answer: cells, studies and samples, the terms
 * each filter matched, a breakdown by every facet, and how to fetch the cells (/api/cells/slice, singlet.s1.atlas.gather).
 */
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { usePageMeta } from "@/hooks/usePageMeta";
import { fmtCompact, fmtInt } from "@/lib/catalog-display";

interface FacetValue {
  id?: string | null;
  value: string;
  label?: string;
  cells: number;
  samples?: number;
}
interface Reading {
  text: string;
  field: string;
  level: string;
  labels: string[];
  values: string[];
  negated: boolean;
}
interface CellAnswer {
  totals: { cells: number; samples: number; studies: number };
  question?: { readings: Reading[]; unparsed: string[]; source: string; note?: string };
  studies: { gse_id: string; cells: number; samples: number }[];
  samples: { gsm_id: string; gse_id: string; cells: number }[];
  filters: { field: string; level: string; values: { value: string; labels: string[] }[]; terms_covered: number; contributing: FacetValue[] }[];
  facets: Record<string, FacetValue[]>;
  cell_type_lineage: FacetValue[];
  relaxations?: { filter: string; alone: number; without: number }[];
  row_scan?: { cells?: number; complete?: boolean; error?: string };
  slice: { url: string; python: string; filtered: string };
  basis: { index_version: string; release_policy: string | null };
  caveats: string[];
  timing: { total_ms: number; eval_ms: number };
}
interface SlicePage {
  page: { samples: number; studies: number; cells: number };
  progress: { samples_done: number; samples_total: number; cells_total: number };
  bytes: number;
  requests: number;
  objects: { gsm_id: string; url: string; n_cells: number; ranges: { range: string; bytes: number }[] }[];
  next_cursor: string | null;
}

const EXAMPLES = [
  "female CD8 T cells from lung cancer",
  "microglia from aged mouse brain",
  "B cells or plasma cells in human bone marrow, not leukemia",
  "hepatocytes from liver organoids",
  "T cells of African ancestry",
];

const FACETS: [string, string][] = [
  ["cell_type", "Cell type (call)"],
  ["sex", "Chromosomal sex"],
  ["ancestry", "Genetic ancestry"],
  ["tissue", "Tissue"],
  ["disease", "Disease"],
  ["development_stage", "Developmental stage"],
  ["organism", "Organism"],
  ["assay", "Assay"],
  ["donor_status", "Donor status"],
  ["perturbation", "Perturbation"],
  ["sample_kind", "Sample kind"],
  ["donor_sex", "Recorded sex"],
];

const fmtBytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} kB`);

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
  return body;
}

function Bars({ title, values, total }: { title: string; values: FacetValue[]; total: number }) {
  if (!values?.length) return null;
  const max = Math.max(...values.map((v) => v.cells));
  return (
    <div className="surface p-4">
      <h3 className="mb-2 text-[13px] font-semibold text-foreground">{title}</h3>
      <ul className="space-y-1">
        {values.slice(0, 8).map((v) => (
          <li key={v.value} className="text-[12px]">
            <div className="flex justify-between gap-2">
              <span className="truncate" title={v.id ?? v.value}>
                {v.label ?? v.value}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {fmtCompact(v.cells)} · {total ? Math.round((100 * v.cells) / total) : 0}%
              </span>
            </div>
            <div className="h-1 rounded bg-muted">
              <div className="h-1 rounded bg-primary" style={{ width: `${(100 * v.cells) / max}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const CellSearch = () => {
  usePageMeta({ title: "Search cells", description: "Find cells across the atlas by cell type, sex, ancestry, tissue, disease, stage and study, and fetch just those cells.", path: "/cells" });
  const [sp, setSp] = useSearchParams();
  const q = sp.get("q") ?? "";
  const where = sp.get("where") ?? "";
  const [text, setText] = useState(q || where);
  const [page, setPage] = useState<SlicePage | null>(null);
  const [pageErr, setPageErr] = useState<string | null>(null);
  const [pageBusy, setPageBusy] = useState(false);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (where) params.set("where", where);
  const ask = q || where;
  const answer = useQuery({
    queryKey: ["cells", q, where],
    queryFn: () => getJson<CellAnswer>(`/api/cells?${params}`),
    enabled: !!ask,
    staleTime: 300_000,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    setPage(null);
    setPageErr(null);
    setSp(t.startsWith("{") ? { where: t } : t ? { q: t } : {});
  };

  const firstPage = async () => {
    if (!answer.data) return;
    setPageBusy(true);
    setPageErr(null);
    try {
      setPage(await getJson<SlicePage>(answer.data.slice.url.replace("https://singlet.bio", "") + "&page_cells=5000"));
    } catch (e) {
      setPageErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPageBusy(false);
    }
  };

  const a = answer.data;
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />
      <main className="container-site flex-1 py-6 pb-32">
        <h1 className="mb-1 text-[22px] font-semibold tracking-tight text-foreground">Search cells</h1>
        <p className="mb-4 max-w-3xl text-[14px] text-muted-foreground">
          Every called cell of the atlas, by its cell type, chromosomal sex and genetic ancestry, and by its sample's tissue, disease,
          stage and study. Ontology terms match their descendants. <Link to="/browse" className="text-primary underline underline-offset-2">Search studies</Link> ·{" "}
          <a href="/api/cells/fields" className="text-primary underline underline-offset-2">All fields</a>
        </p>
        <form onSubmit={submit} className="mb-3 flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='e.g. female CD8 T cells from lung cancer, or {"cell_type": "T cell", "not": {"sex": "male"}}'
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-[14px]"
            aria-label="Cell question or JSON filter"
          />
          <button type="submit" className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[14px] text-primary-foreground">
            <Search size={15} /> Search
          </button>
        </form>
        {!ask && (
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((x) => (
              <button key={x} type="button" onClick={() => (setText(x), setSp({ q: x }))} className="rounded-full border border-border px-3 py-1 text-[12px] hover:border-primary">
                {x}
              </button>
            ))}
          </div>
        )}
        {answer.isLoading && (
          <div className="surface mt-4 flex items-center gap-2 p-4 text-muted-foreground">
            <Loader2 size={15} className="animate-spin" /> Counting cells…
          </div>
        )}
        {answer.error && <div className="surface mt-4 p-4 text-[14px] text-destructive">{(answer.error as Error).message}</div>}
        {a && (
          <div className="mt-4 space-y-5">
            {a.question && (
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="text-muted-foreground">Read as</span>
                {a.question.readings.map((r) => (
                  <span key={r.field + r.text} className="rounded-full border border-border px-2.5 py-0.5" title={r.values.join(", ")}>
                    {r.negated ? "not " : ""}
                    <span className="text-muted-foreground">{r.field.replace(/_/g, " ")}:</span> {[...new Set(r.labels)].join(" or ")}
                  </span>
                ))}
                {a.question.unparsed.length > 0 && <span className="text-muted-foreground">not used: {a.question.unparsed.join(", ")}</span>}
                <span className="text-muted-foreground">({a.question.source})</span>
              </div>
            )}
            <div className="surface flex flex-wrap items-baseline gap-x-6 gap-y-1 p-4">
              <span className="text-[26px] font-semibold tabular-nums">{fmtInt(a.totals.cells)}</span>
              <span className="text-muted-foreground">cells in {fmtInt(a.totals.samples)} samples of {fmtInt(a.totals.studies)} studies</span>
              {a.row_scan?.cells !== undefined && <span className="text-muted-foreground">{fmtInt(a.row_scan.cells)} pass the per-cell ranges</span>}
              <span className="ml-auto text-[12px] text-muted-foreground">
                {a.timing.total_ms} ms · index {a.basis.index_version}
              </span>
            </div>
            {a.relaxations && (
              <div className="surface p-4 text-[13px]">
                <h2 className="mb-2 font-semibold">Nothing matches all of these. Each filter:</h2>
                <table className="w-full text-[12px]">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1">Filter</th>
                      <th>Cells alone</th>
                      <th>Cells without it</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.relaxations.map((r) => (
                      <tr key={r.filter} className="border-t border-border">
                        <td className="py-1 font-mono">{r.filter}</td>
                        <td className="tabular-nums">{fmtInt(r.alone)}</td>
                        <td className="tabular-nums">{fmtInt(r.without)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {a.filters.some((f) => f.contributing.length) && (
              <section>
                <h2 className="mb-2 text-[15px] font-semibold">Terms each filter matched</h2>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {a.filters
                    .filter((f) => f.contributing.length)
                    .map((f) => (
                      <Bars key={f.field + f.values.map((v) => v.value).join()} title={`${f.field.replace(/_/g, " ")}: ${f.values.map((v) => v.labels.join("/") || v.value).join(" or ")} (${f.terms_covered} terms)`} values={f.contributing} total={a.totals.cells} />
                    ))}
                </div>
              </section>
            )}
            {a.totals.cells > 0 && (
              <section>
                <h2 className="mb-2 text-[15px] font-semibold">Breakdown</h2>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  <Bars title="Cell type, every ontology level" values={a.cell_type_lineage} total={a.totals.cells} />
                  {FACETS.map(([k, t]) => (
                    <Bars key={k} title={t} values={a.facets[k] ?? []} total={a.totals.cells} />
                  ))}
                </div>
              </section>
            )}
            {a.studies.length > 0 && (
              <section className="grid gap-4 lg:grid-cols-2">
                <div className="surface p-4">
                  <h2 className="mb-2 text-[15px] font-semibold">Studies</h2>
                  <table className="w-full text-[12px]">
                    <tbody>
                      {a.studies.map((s) => (
                        <tr key={s.gse_id} className="border-t border-border">
                          <td className="py-1">
                            <Link to={`/study/${s.gse_id}`} className="font-mono text-primary">
                              {s.gse_id}
                            </Link>
                          </td>
                          <td className="tabular-nums">{fmtInt(s.cells)} cells</td>
                          <td className="tabular-nums text-muted-foreground">{s.samples} samples</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="surface p-4">
                  <h2 className="mb-2 text-[15px] font-semibold">Get the cells</h2>
                  <p className="mb-2 text-[12px] text-muted-foreground">
                    Pages of up to 10,000 cells: the cells and the byte ranges of their matrix chunks in each sample object (filtered {a.slice.filtered}).
                  </p>
                  <pre className="mb-2 max-h-56 overflow-auto rounded bg-muted p-2 text-[11px]">{a.slice.python}</pre>
                  <button type="button" onClick={firstPage} disabled={pageBusy} className="rounded-md border border-border px-3 py-1 text-[12px] hover:border-primary">
                    {pageBusy ? "Planning…" : "Plan the first page"}
                  </button>
                  {pageErr && <p className="mt-2 text-[12px] text-destructive">{pageErr}</p>}
                  {page && (
                    <div className="mt-2 text-[12px]">
                      {fmtInt(page.page.cells)} cells from {page.page.samples} samples: {fmtBytes(page.bytes)} in {page.requests} ranged reads
                      {page.next_cursor ? ` (samples ${page.progress.samples_done} of ${page.progress.samples_total} done)` : ""}.
                      <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                        {page.objects.slice(0, 4).map((o) => (
                          <li key={o.gsm_id} className="truncate">
                            {o.gsm_id}: {o.n_cells} cells, {o.ranges.length} ranges, {fmtBytes(o.ranges.reduce((n, r) => n + r.bytes, 0))}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </section>
            )}
            <section className="surface p-4 text-[12px] text-muted-foreground">
              <h2 className="mb-1 text-[13px] font-semibold text-foreground">About these labels</h2>
              <ul className="list-disc space-y-1 pl-4">
                {a.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default CellSearch;

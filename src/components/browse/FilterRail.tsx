import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtInt, organismLabel } from "@/lib/catalog-display";
import type { AppliedFilters, FacetOption, FacetsResponse, Level } from "@/integrations/api/types";
import type { MultiField } from "./browse-state";

const TOP_N = 8;

export const MIN_CELL_STEPS: { value: number | null; label: string }[] = [
  { value: null, label: "Any" },
  { value: 10_000, label: "≥ 10K" },
  { value: 50_000, label: "≥ 50K" },
  { value: 100_000, label: "≥ 100K" },
  { value: 500_000, label: "≥ 500K" },
  { value: 1_000_000, label: "≥ 1M" },
];

interface Props {
  facets: FacetsResponse | undefined;
  loading: boolean;
  level: Level;
  /** Filters currently in force (explicit, or as the interpreter applied them). */
  current: AppliedFilters;
  onToggle: (field: MultiField, value: string) => void;
  onMode: (field: MultiField, mode: "any" | "all") => void;
  onAddCellType: (value: string) => void;
  onMinCells: (n: number | null) => void;
  onYear: (min: number | null, max: number | null) => void;
  onBundle: (only: boolean) => void;
  onFileSamples: (n: number | null) => void;
  onFileCells: (n: number | null) => void;
  onFileSize: (n: number | null) => void;
  onBoolean: (field: "has_pubmed" | "has_conditions", value: boolean | null) => void;
  className?: string;
}

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="py-4 border-b border-border last:border-b-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-2.5 flex items-baseline justify-between">
        <span>{title}</span>
        {hint && <span className="normal-case tracking-normal font-normal text-[11px]">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

/** Ordered option list: selected first (even at 0), then by count. */
function orderOptions(options: FacetOption[], selected: string[]): FacetOption[] {
  const byValue = new Map(options.map((o) => [o.value, o]));
  const out: FacetOption[] = [];
  for (const v of selected) out.push(byValue.get(v) ?? { value: v, count: 0 });
  for (const o of options) if (!selected.includes(o.value) && o.count > 0) out.push(o);
  return out;
}

function CheckList({
  field,
  options,
  selected,
  onToggle,
  labelFn,
  searchPlaceholder,
  loading,
}: {
  field: MultiField;
  options: FacetOption[];
  selected: string[];
  onToggle: (field: MultiField, value: string) => void;
  labelFn?: (o: FacetOption) => string;
  searchPlaceholder: string;
  loading: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState("");
  const ordered = useMemo(() => orderOptions(options, selected), [options, selected]);
  const needle = filter.trim().toLowerCase();
  const filtered = needle
    ? ordered.filter((o) => (labelFn ? labelFn(o) : o.value).toLowerCase().includes(needle) || o.value.toLowerCase().includes(needle))
    : ordered;
  const visible = showAll || needle ? filtered : filtered.slice(0, TOP_N);
  const hidden = filtered.length - visible.length;

  if (!options.length && loading) {
    return (
      <ul className="space-y-2" aria-busy="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="h-4 rounded bg-secondary animate-pulse" style={{ width: `${70 - i * 8}%` }} />
        ))}
      </ul>
    );
  }
  if (!ordered.length) return <p className="text-xs text-muted-foreground">No values under the current filters.</p>;

  return (
    <div>
      {(showAll || ordered.length > TOP_N) && (
        <input
          type="text"
          autoComplete="off"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="input h-7 px-2 text-xs mb-2"
        />
      )}
      <ul className={cn("space-y-1", showAll && "max-h-[280px] overflow-y-auto pr-1")}>
        {visible.map((o) => {
          const checked = selected.includes(o.value);
          const id = `${field}-${o.value}`;
          return (
            <li key={o.value}>
              <label htmlFor={id} className="flex items-center gap-2 cursor-pointer group min-h-[22px]">
                <input
                  id={id}
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(field, o.value)}
                  className="h-3.5 w-3.5 shrink-0 rounded-[2px]"
                />
                <span
                  className={cn(
                    "text-[13px] flex-1 truncate transition-colors",
                    checked ? "text-foreground font-medium" : "text-foreground/80 group-hover:text-foreground"
                  )}
                  title={o.value}
                >
                  {labelFn ? labelFn(o) : o.value}
                </span>
                <span className={cn("font-mono text-[11px] tabular shrink-0", o.count ? "text-muted-foreground" : "text-muted-foreground/50")}>
                  {fmtInt(o.count)}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {!needle && (hidden > 0 || showAll) && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
        >
          {showAll ? "Show fewer" : `Show all ${fmtInt(filtered.length)}`}
          <ChevronRight size={12} className={cn("transition-transform", showAll && "rotate-90")} />
        </button>
      )}
      {needle && !filtered.length && <p className="text-xs text-muted-foreground mt-1">No matches.</p>}
    </div>
  );
}

function CellTypeSection({
  options,
  selected,
  onAdd,
  onToggle,
}: {
  options: FacetOption[];
  selected: string[];
  onAdd: (v: string) => void;
  onToggle: (field: MultiField, value: string) => void;
}) {
  const [text, setText] = useState("");
  const needle = text.trim().toLowerCase();
  const suggestions = useMemo(() => {
    const pool = options.filter((o) => !selected.includes(o.value) && o.count > 0);
    const hits = needle ? pool.filter((o) => o.value.includes(needle)) : pool;
    return hits.slice(0, needle ? 8 : 6);
  }, [options, selected, needle]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim().toLowerCase();
    if (!v) return;
    onAdd(v);
    setText("");
  };

  return (
    <div>
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((v) => (
            <li key={v}>
              <button type="button" onClick={() => onToggle("cell_type", v)} className="chip-active h-7 text-[12px]" aria-label={`Remove cell type ${v}`}>
                {v}
                <X size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit}>
        <input
          type="text"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. microglia, cd8 t cells"
          aria-label="Add a cell type filter"
          className="input h-8 px-2 text-[13px]"
        />
      </form>
      {suggestions.length > 0 && (
        <ul className="mt-2 space-y-1">
          {suggestions.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                onClick={() => onAdd(o.value)}
                className="w-full flex items-center gap-2 text-left min-h-[22px] group"
              >
                <span className="text-[13px] flex-1 truncate text-foreground/80 group-hover:text-foreground">{o.value}</span>
                <span className="font-mono text-[11px] tabular text-muted-foreground">{fmtInt(o.count)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground leading-snug">
        Matches the sample's cell-type or source field, or its GEO characteristics. Press Enter to add free text.
      </p>
    </div>
  );
}

export function FilterRail({
  facets,
  loading,
  level,
  current,
  onToggle,
  onMode,
  onAddCellType,
  onMinCells,
  onYear,
  onBundle,
  onFileSamples,
  onFileCells,
  onFileSize,
  onBoolean,
  className,
}: Props) {
  const years = useMemo(() => {
    const ys = (facets?.year ?? []).map((y) => Number(y.value)).filter((n) => Number.isFinite(n));
    ys.sort((a, b) => a - b);
    return ys;
  }, [facets]);
  const yearMin = years[0];
  const yearMax = years[years.length - 1];
  const yearRange = useMemo(() => {
    if (yearMin == null || yearMax == null) return [] as number[];
    const lo = Math.min(yearMin, current.year_min ?? yearMin);
    const hi = Math.max(yearMax, current.year_max ?? yearMax);
    const out: number[] = [];
    for (let y = lo; y <= hi; y++) out.push(y);
    return out;
  }, [yearMin, yearMax, current.year_min, current.year_max]);
  const modeControl = (field: MultiField, selected: string[]) => selected.length > 1 ? (
    <div className="mb-2 inline-flex rounded border border-border p-0.5" role="group" aria-label={`${field} match mode`}>
      {(["any", "all"] as const).map((mode) => (
        <button key={mode} type="button" onClick={() => onMode(field, mode)} aria-pressed={(current.match_mode[field] ?? "any") === mode}
          className={cn("rounded-[2px] px-2 py-0.5 text-[11px] font-medium", (current.match_mode[field] ?? "any") === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{mode === "any" ? "Any" : "All"}</button>
      ))}
    </div>
  ) : null;

  return (
    <aside className={cn("text-foreground", className)} aria-label="Filters" aria-busy={loading || undefined}>
      <Section title="Organism">
        {modeControl("organism", current.organism)}
        <CheckList
          field="organism"
          options={facets?.organism ?? []}
          selected={current.organism}
          onToggle={onToggle}
          labelFn={(o) => o.label ?? organismLabel(o.value)}
          searchPlaceholder="Search organisms…"
          loading={loading}
        />
      </Section>
      <Section title="Tissue">
        {modeControl("tissue_group", current.tissue_group)}
        <CheckList
          field="tissue_group"
          options={facets?.tissue_group ?? []}
          selected={current.tissue_group}
          onToggle={onToggle}
          searchPlaceholder="Search tissues…"
          loading={loading}
        />
      </Section>
      <Section title="Disease">
        {modeControl("disease_group", current.disease_group)}
        <CheckList
          field="disease_group"
          options={facets?.disease_group ?? []}
          selected={current.disease_group}
          onToggle={onToggle}
          searchPlaceholder="Search diseases…"
          loading={loading}
        />
      </Section>
      <Section title="Assay">
        {modeControl("assay_family", current.assay_family)}
        <CheckList
          field="assay_family"
          options={facets?.assay_family ?? []}
          selected={current.assay_family}
          onToggle={onToggle}
          searchPlaceholder="Search assays…"
          loading={loading}
        />
      </Section>
      <Section title="Cell type">
        {modeControl("cell_type", current.cell_type)}
        <CellTypeSection options={facets?.cell_type ?? []} selected={current.cell_type} onAdd={onAddCellType} onToggle={onToggle} />
      </Section>
      <Section title="Year" hint={years.length ? undefined : "few studies dated"}>
        {years.length > 0 && (
          <div className="mb-2 flex h-8 items-end gap-px" aria-label="Studies by year">
            {(facets?.year ?? []).slice().reverse().map((y) => {
              const max = Math.max(1, ...(facets?.year ?? []).map((x) => x.count));
              return <span key={y.value} title={`${y.value}: ${fmtInt(y.count)}`} className="min-w-px flex-1 bg-primary/35" style={{ height: `${Math.max(8, y.count / max * 100)}%` }} />;
            })}
          </div>
        )}
        {yearRange.length ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted-foreground">
              From
              <select
                value={current.year_min ?? ""}
                onChange={(e) => onYear(e.target.value ? Number(e.target.value) : null, current.year_max)}
                className="input h-8 px-2 mt-1 text-[13px] font-mono"
              >
                <option value="">Any</option>
                {yearRange.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              To
              <select
                value={current.year_max ?? ""}
                onChange={(e) => onYear(current.year_min, e.target.value ? Number(e.target.value) : null)}
                className="input h-8 px-2 mt-1 text-[13px] font-mono"
              >
                <option value="">Any</option>
                {yearRange.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {loading && !facets ? "Loading…" : "Submission year is only known for a small share of studies, so there is nothing to filter on here yet."}
          </p>
        )}
      </Section>
      <Section title={level === "gse" ? "Cells per study" : "Cells per sample"}>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Minimum cells">
          {MIN_CELL_STEPS.map((s) => {
            const active = (current.min_cells ?? null) === s.value;
            return (
              <button
                key={s.label}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onMinCells(s.value)}
                className={cn("chip h-7 px-2 text-[12px] font-mono", active && "border-primary text-primary bg-primary/5")}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Download">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={current.has_bundle ?? true}
            onChange={(e) => onBundle(e.target.checked)}
            className="h-3.5 w-3.5 mt-0.5 shrink-0 rounded-[2px]"
          />
          <span className="text-[13px] text-foreground/90 leading-snug">
            {level === "gse" ? "Only studies with a downloadable file" : "Only samples from studies with a downloadable file"}
          </span>
        </label>
        <p className="mt-1.5 text-[11px] text-muted-foreground leading-snug">
          Off also shows {level === "gse" ? "studies" : "samples"} that were catalogued but whose <span className="font-mono">.singlet</span> file has not been built yet.
        </p>
      </Section>
      {level === "gse" && (
        <>
          <Section title="Samples in file">
            <select value={current.min_file_samples ?? ""} onChange={(e) => onFileSamples(e.target.value ? Number(e.target.value) : null)} className="input h-8 px-2 text-[13px] font-mono">
              <option value="">Any</option><option value="10">≥ 10</option><option value="25">≥ 25</option><option value="50">≥ 50</option><option value="100">≥ 100</option>
            </select>
          </Section>
          <Section title="Cells called in file">
            <select value={current.min_file_cells ?? ""} onChange={(e) => onFileCells(e.target.value ? Number(e.target.value) : null)} className="input h-8 px-2 text-[13px] font-mono">
              <option value="">Any</option><option value="10000">≥ 10K</option><option value="100000">≥ 100K</option><option value="1000000">≥ 1M</option>
            </select>
          </Section>
          <Section title="Reference build">
            {modeControl("reference_build", current.reference_build)}
            <CheckList field="reference_build" options={facets?.reference_build ?? []} selected={current.reference_build} onToggle={onToggle} searchPlaceholder="Search references…" loading={loading} />
          </Section>
          <Section title="Protocol">
            {modeControl("protocol", current.protocol)}
            <CheckList field="protocol" options={facets?.protocol ?? []} selected={current.protocol} onToggle={onToggle} searchPlaceholder="Search protocols…" loading={loading} />
          </Section>
          <Section title="File size">
            <select value={current.max_file_bytes ?? ""} onChange={(e) => onFileSize(e.target.value ? Number(e.target.value) : null)} className="input h-8 px-2 text-[13px] font-mono">
              <option value="">Any</option><option value="1073741824">≤ 1 GB</option><option value="5368709120">≤ 5 GB</option><option value="10737418240">≤ 10 GB</option>
            </select>
          </Section>
          <Section title="Metadata">
            <label className="mb-2 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={current.has_pubmed === true} onChange={(e) => onBoolean("has_pubmed", e.target.checked ? true : null)} />Has PubMed</label>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={current.has_conditions === true} onChange={(e) => onBoolean("has_conditions", e.target.checked ? true : null)} />Has conditions</label>
          </Section>
        </>
      )}
    </aside>
  );
}

export default FilterRail;

import { Link } from "react-router-dom";
import { AlertTriangle, ArrowDown, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtBytes, fmtCompact, fmtInt } from "@/lib/catalog-display";
import { bundleUrl } from "@/integrations/api/client";
import type { Sort, StudyRow } from "@/integrations/api/types";

interface Props {
  rows: StudyRow[];
  selectedIds: Set<string>;
  onToggle: (row: StudyRow) => void;
  onTogglePage: (rows: StudyRow[], select: boolean) => void;
  sort: Sort;
  onSort: (s: Sort) => void;
  ai: boolean;
  why?: Record<string, string>;
  /** Studies whose `why` was written by the model (signed-in explanations). */
  aiWhyIds?: Record<string, unknown>;
}

function SortTh({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey?: Sort;
  sort: Sort;
  onSort: (s: Sort) => void;
  className?: string;
}) {
  if (!sortKey) return <th className={className}>{label}</th>;
  const active = sort === sortKey;
  return (
    <th className={className} aria-sort={active ? "descending" : "none"}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn("inline-flex items-center gap-1 hover:text-foreground transition-colors", active && "text-foreground")}
      >
        {label}
        <ArrowDown size={11} className={cn("transition-opacity", active ? "opacity-100" : "opacity-0")} />
      </button>
    </th>
  );
}

export function StudyTable({ rows, selectedIds, onToggle, onTogglePage, sort, onSort, ai, why, aiWhyIds }: Props) {
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.gse_id));
  const someSelected = rows.some((r) => selectedIds.has(r.gse_id));

  return (
    <div className="surface overflow-x-auto !rounded-none">
      <table className="data-table w-full table-fixed min-w-[860px]">
        <colgroup>
          <col className="w-9" />
          <col className="w-[108px]" />
          <col />
          <col className="w-[78px]" />
          <col className="w-[13%]" />
          <col className="w-[12%]" />
          <col className="w-[84px]" />
          <col className="w-[66px]" />
          <col className="w-[88px]" />
        </colgroup>
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = !allSelected && someSelected;
                }}
                onChange={(e) => onTogglePage(rows, e.target.checked)}
                aria-label="Select all studies on this page"
                className="h-3.5 w-3.5 rounded-[2px]"
              />
            </th>
            <SortTh label="Accession" sortKey="accession" sort={sort} onSort={onSort} />
            <th>Study</th>
            <th>Organism</th>
            <th>Tissue</th>
            <th>Assay</th>
            <SortTh label="Samples" sortKey="samples" sort={sort} onSort={onSort} className="text-right" />
            <SortTh label="Cells" sortKey="cells" sort={sort} onSort={onSort} className="text-right" />
            <th className="text-right">File</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const selected = selectedIds.has(r.gse_id);
            const explanation = why?.[r.gse_id] ?? r.why;
            const modelWritten = !!aiWhyIds?.[r.gse_id];
            return (
              <tr key={r.gse_id} className={cn(selected && "bg-primary/[0.03]")}>
                <td className="align-top">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggle(r)}
                    aria-label={`Select ${r.gse_id}`}
                    className="h-3.5 w-3.5 rounded-[2px]"
                  />
                </td>
                <td className="whitespace-nowrap align-top">
                  <Link to={`/study/${r.gse_id}`} className="font-mono text-primary hover:underline">
                    {r.gse_id}
                  </Link>
                  <div className="font-mono text-[11px] text-muted-foreground">{r.year ?? "—"}</div>
                </td>
                <td className="align-top">
                  <Link to={`/study/${r.gse_id}`} className="font-medium text-foreground hover:text-primary line-clamp-2">
                    {r.title ?? "Untitled study"}
                  </Link>
                  {r.conditions_label && <div className="mt-0.5 text-[12px] text-warning truncate">{r.conditions_label}</div>}
                  {explanation && (
                    <div className="mt-0.5 text-[12px] text-muted-foreground line-clamp-1" title={explanation}>
                      {modelWritten && <span className="ai-badge mr-1 align-[1px]">AI</span>}
                      <span className={cn("font-medium", ai || modelWritten ? "text-ai" : "")}>{ai || modelWritten ? "Why: " : ""}</span>
                      {explanation}
                    </div>
                  )}
                </td>
                <td className="align-top truncate">{r.organism_label}</td>
                <td className="align-top truncate" title={r.tissue_groups.join(", ")}>
                  {r.tissue_groups.join(", ") || "—"}
                </td>
                <td className="align-top truncate" title={r.assay_families.join(", ")}>
                  {r.assay_families.join(", ") || "—"}
                </td>
                <td className="num whitespace-nowrap align-top">
                  {r.bundle_n_samples != null ? <>{fmtInt(r.bundle_n_samples)} <span className="text-muted-foreground">file</span></> : <>{fmtInt(r.n_done)} <span className="text-muted-foreground">(catalog)</span></>}
                </td>
                <td className="num whitespace-nowrap align-top">
                  {r.suspect_cells && <AlertTriangle size={11} className="inline mr-1 text-warning" aria-label="Some counts flagged" />}
                  {fmtCompact(r.file_cells ?? r.n_cells)}
                  <span className="text-muted-foreground"> {r.file_cells != null ? "file" : "(catalog)"}</span>
                </td>
                <td className="text-right whitespace-nowrap align-top">
                  {r.has_bundle ? (
                    <a href={bundleUrl(r.gse_id)} download className="inline-flex items-center gap-1 text-primary hover:underline" title="Download .singlet">
                      <Download size={12} />
                      <span className="font-mono text-[12px]">{fmtBytes(r.bundle_bytes)}</span>
                    </a>
                  ) : (
                    <span className="text-muted-foreground text-[12px]">not built</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default StudyTable;

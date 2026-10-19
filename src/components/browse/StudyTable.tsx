import { Link } from "react-router-dom";
import { AlertTriangle, ArrowDown, BookOpen, Download, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtCompact, fmtInt } from "@/lib/catalog-display";
import { bundleUrl } from "@/integrations/api/client";
import type { Sort, StudyRow } from "@/integrations/api/types";
import type { ColumnDef } from "./columns";

/** Plain-words state of a study's file, for the optional Status column. */
export function studyStatus(r: StudyRow): string {
  if (!r.has_bundle) return r.n_done > 0 ? "File pending" : "Not processed";
  const inFile = r.bundle_n_samples ?? r.n_done;
  if (r.n_total > inFile) return `${fmtInt(inFile)} of ${fmtInt(r.n_total)} samples`;
  return "Complete";
}

/** Samples that count for the study: passed QC in the file, else what the file or catalog holds. */
function sampleCount(r: StudyRow): { n: number; title: string } {
  if (r.has_bundle && r.usable_samples != null) {
    return { n: r.usable_samples, title: `Passed QC${r.low_qc_samples ? `; ${fmtInt(r.low_qc_samples)} more flagged low QC` : ""}` };
  }
  if (r.bundle_n_samples != null) return { n: r.bundle_n_samples, title: "Samples in the file" };
  return { n: r.n_done, title: "Samples processed (catalog)" };
}

export const STUDY_COLUMNS: ColumnDef<StudyRow>[] = [
  {
    key: "accession",
    label: "Accession",
    default: true,
    required: true,
    width: "w-[108px]",
    render: (r) => (
      <Link to={`/study/${r.gse_id}`} className="font-mono text-primary hover:underline">
        {r.gse_id}
      </Link>
    ),
  },
  { key: "study", label: "Study", default: true, required: true, render: () => null },
  { key: "organism", label: "Organism", default: true, width: "w-[84px]", render: (r) => r.organism_label },
  {
    key: "tissue",
    label: "Tissue",
    default: true,
    width: "w-[12%]",
    render: (r) => <span title={r.tissue_groups.join(", ")}>{r.tissue_groups.join(", ") || "—"}</span>,
  },
  {
    key: "disease",
    label: "Disease",
    default: false,
    width: "w-[12%]",
    render: (r) => <span title={r.disease_groups.join(", ")}>{r.disease_groups.join(", ") || "—"}</span>,
  },
  {
    key: "assay",
    label: "Assay",
    default: true,
    width: "w-[11%]",
    render: (r) => <span title={r.assay_families.join(", ")}>{r.assay_families.join(", ") || "—"}</span>,
  },
  {
    key: "cell_types",
    label: "Cell types",
    default: false,
    width: "w-[12%]",
    render: (r) => <span title={r.cell_types_raw.join(", ")}>{r.cell_types_raw.slice(0, 3).join(", ") || "—"}</span>,
  },
  { key: "year", label: "Year", default: true, width: "w-[60px]", render: (r) => <span className="font-mono text-[12px]">{r.year ?? "—"}</span> },
  {
    key: "samples",
    label: "Samples",
    default: true,
    align: "right",
    width: "w-[84px]",
    render: (r) => {
      const { n, title } = sampleCount(r);
      return <span title={title}>{fmtInt(n)}</span>;
    },
  },
  {
    key: "cells",
    label: "Cells",
    default: true,
    align: "right",
    width: "w-[72px]",
    render: (r) => (
      <span title={r.file_cells != null ? "Cells called in the file" : "Cells recorded in the catalog"}>
        {r.suspect_cells && <AlertTriangle size={11} className="inline mr-1 text-warning" aria-label="Some counts flagged" />}
        {fmtCompact(r.file_cells ?? r.n_cells)}
      </span>
    ),
  },
  { key: "reference", label: "Reference", default: false, width: "w-[130px]", render: (r) => <span className="font-mono text-[12px]">{r.reference_build ?? "—"}</span> },
  { key: "status", label: "Status", default: false, width: "w-[120px]", render: (r) => studyStatus(r) },
  {
    key: "pubmed",
    label: "PubMed",
    default: false,
    width: "w-[72px]",
    render: (r) =>
      r.pubmed_ids.length ? (
        <span className="inline-flex gap-1.5">
          {r.pubmed_ids.slice(0, 3).map((id) => (
            <a
              key={id}
              href={`https://pubmed.ncbi.nlm.nih.gov/${id}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-foreground"
              title={`PubMed ${id}`}
              aria-label={`PubMed ${id}`}
            >
              <BookOpen size={13} />
            </a>
          ))}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "geo",
    label: "GEO",
    default: false,
    width: "w-[52px]",
    render: (r) => (
      <a
        href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${r.gse_id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:text-foreground"
        title="View on GEO"
        aria-label={`View ${r.gse_id} on GEO`}
      >
        <ExternalLink size={13} />
      </a>
    ),
  },
  {
    key: "file",
    label: "Download",
    default: true,
    required: true,
    align: "right",
    width: "w-[52px]",
    render: (r) =>
      r.has_bundle ? (
        <a href={bundleUrl(r.gse_id)} download className="inline-flex text-primary hover:text-foreground" title="Download .singlet" aria-label={`Download ${r.gse_id}`}>
          <Download size={14} />
        </a>
      ) : (
        <span className="text-muted-foreground" title="File pending">
          <Download size={14} className="inline opacity-40" />
        </span>
      ),
  },
];

interface Props {
  rows: StudyRow[];
  columns: ColumnDef<StudyRow>[];
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

const SORT_KEY: Record<string, Sort> = { accession: "accession", year: "year", samples: "samples", cells: "cells" };

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

export function StudyTable({ rows, columns, selectedIds, onToggle, onTogglePage, sort, onSort, ai, why, aiWhyIds }: Props) {
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.gse_id));
  const someSelected = rows.some((r) => selectedIds.has(r.gse_id));

  return (
    <div className="surface overflow-x-auto !rounded-none">
      <table className="data-table w-full table-fixed min-w-[760px]">
        <colgroup>
          <col className="w-9" />
          {columns.map((c) => (
            <col key={c.key} className={c.width} />
          ))}
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
            {columns.map((c) => (
              <SortTh
                key={c.key}
                label={c.key === "file" ? "" : c.label}
                sortKey={SORT_KEY[c.key]}
                sort={sort}
                onSort={onSort}
                className={c.align === "right" ? "text-right" : undefined}
              />
            ))}
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
                {columns.map((c) =>
                  c.key === "study" ? (
                    <td key={c.key} className="align-top">
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
                  ) : (
                    <td
                      key={c.key}
                      className={cn("align-top", c.align === "right" ? "num whitespace-nowrap text-right" : "truncate", c.key === "accession" && "whitespace-nowrap")}
                    >
                      {c.render(r)}
                    </td>
                  )
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default StudyTable;

import { Link } from "react-router-dom";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtInt } from "@/lib/catalog-display";
import type { SampleRow } from "@/integrations/api/types";
import type { ColumnDef } from "./columns";

/** Keys that identify a sample rather than describe a condition. */
const ID_KEY_RE = /(^|\s)(id|identifier|donor|subject|patient|replicate|rep|barcode|library|sample name|sample|name|index|run|lane|batch|well)($|\s)/i;

/** Up to `max` descriptive "key: value" pairs from a sample's characteristics. */
export function conditionPairs(ch: Record<string, string> | null | undefined, max = 3): string[] {
  if (!ch) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(ch)) {
    if (!v || ID_KEY_RE.test(k)) continue;
    if (/^(tissue|cell type|organism|species|strain)$/i.test(k)) continue;
    out.push(`${k}: ${v}`);
    if (out.length >= max) break;
  }
  return out;
}

function StatusCell({ s }: { s: SampleRow }) {
  if (s.status_code === "DONE") return <span className="status-ok">processed</span>;
  if (s.status_code === "DONE_QC_WARN") return <span className="flag">QC warning</span>;
  return (
    <span className="status-fail" title={s.status}>
      {s.status.replace(/^failed:\s*/i, "failed · ")}
    </span>
  );
}

const text = (v: string | null | undefined) => <span title={v ?? undefined}>{v || "—"}</span>;

export const SAMPLE_COLUMNS: ColumnDef<SampleRow>[] = [
  {
    key: "sample",
    label: "Sample",
    default: true,
    required: true,
    width: "w-[118px]",
    render: (r) => (
      <Link to={`/study/${r.gse_id}#${r.gsm_id}`} className="font-mono text-primary hover:underline">
        {r.gsm_id}
      </Link>
    ),
  },
  { key: "organism", label: "Organism", default: true, width: "w-[84px]", render: (r) => r.organism_label || "—" },
  {
    key: "study",
    label: "Study",
    default: true,
    width: "w-[22%]",
    render: (r) => (
      <>
        <Link to={`/study/${r.gse_id}`} className="font-mono text-[12px] text-primary hover:underline">
          {r.gse_id}
        </Link>
        <div className="text-[12px] text-muted-foreground truncate" title={r.study_title ?? undefined}>
          {r.study_title ?? "—"}
        </div>
      </>
    ),
  },
  { key: "tissue", label: "Tissue", default: true, width: "w-[13%]", render: (r) => text(r.tissue ?? r.tissue_group) },
  { key: "cell_type", label: "Cell type", default: true, width: "w-[12%]", render: (r) => text(r.cell_type) },
  {
    key: "conditions",
    label: "Conditions",
    default: true,
    render: (r) => {
      const pairs = conditionPairs(r.characteristics);
      return pairs.length ? (
        <ul className="space-y-0.5">
          {pairs.map((p) => (
            <li key={p} className="text-[12px] text-foreground/80 truncate" title={p}>
              {p}
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
  },
  { key: "disease", label: "Disease", default: false, width: "w-[12%]", render: (r) => text(r.disease ?? r.disease_group) },
  { key: "sex", label: "Sex", default: false, width: "w-[64px]", render: (r) => text(r.sex) },
  { key: "assay", label: "Assay", default: true, width: "w-[11%]", render: (r) => text(r.assay_family ?? r.protocol) },
  {
    key: "cells",
    label: "Cells",
    default: true,
    align: "right",
    width: "w-[84px]",
    render: (r) => (
      <span className={cn(r.suspect_cells && "text-warning")}>
        {r.suspect_cells && <AlertTriangle size={11} className="inline mr-1" aria-label="Implausible cell count — under review" />}
        {r.n_cells == null ? "—" : fmtInt(r.n_cells)}
      </span>
    ),
  },
  { key: "status", label: "Status", default: false, width: "w-[110px]", render: (r) => <StatusCell s={r} /> },
  {
    key: "geo",
    label: "GEO",
    default: false,
    width: "w-[52px]",
    render: (r) => (
      <a
        href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${r.gsm_id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:text-foreground"
        title="View on GEO"
        aria-label={`View ${r.gsm_id} on GEO`}
      >
        <ExternalLink size={13} />
      </a>
    ),
  },
];

export function SampleTable({ rows, columns }: { rows: SampleRow[]; columns: ColumnDef<SampleRow>[] }) {
  return (
    <div className="surface overflow-x-auto !rounded-none">
      <table className="data-table w-full table-fixed min-w-[760px]">
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} className={c.width} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === "right" ? "text-right" : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.gsm_id}>
              {columns.map((c) => (
                <td key={c.key} className={cn("align-top", c.align === "right" ? "num whitespace-nowrap text-right" : "truncate", c.key === "sample" && "whitespace-nowrap")}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default SampleTable;

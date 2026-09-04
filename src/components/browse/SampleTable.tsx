import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtInt } from "@/lib/catalog-display";
import type { SampleRow } from "@/integrations/api/types";

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

export function SampleTable({ rows }: { rows: SampleRow[] }) {
  return (
    <div className="surface overflow-x-auto !rounded-none">
      <table className="data-table w-full table-fixed min-w-[820px]">
        <colgroup>
          <col className="w-[118px]" />
          <col className="w-[22%]" />
          <col className="w-[14%]" />
          <col className="w-[13%]" />
          <col />
          <col className="w-[96px]" />
          <col className="w-[92px]" />
        </colgroup>
        <thead>
          <tr>
            <th>Sample</th>
            <th>Study</th>
            <th>Tissue</th>
            <th>Cell type</th>
            <th>Conditions</th>
            <th className="text-right">Cells</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pairs = conditionPairs(r.characteristics);
            return (
              <tr key={r.gsm_id}>
                <td className="whitespace-nowrap align-top">
                  <Link to={`/study/${r.gse_id}#${r.gsm_id}`} className="font-mono text-primary hover:underline">
                    {r.gsm_id}
                  </Link>
                  <div className="text-[11px] text-muted-foreground">{r.organism_label}</div>
                </td>
                <td className="align-top">
                  <Link to={`/study/${r.gse_id}`} className="font-mono text-[12px] text-primary hover:underline">
                    {r.gse_id}
                  </Link>
                  <div className="text-[12px] text-muted-foreground truncate" title={r.study_title ?? undefined}>
                    {r.study_title ?? "—"}
                  </div>
                </td>
                <td className="align-top">
                  <div className="truncate" title={r.tissue ?? undefined}>
                    {r.tissue ?? "—"}
                  </div>
                  {r.tissue_group && r.tissue_group !== r.tissue && (
                    <div className="text-[11px] text-muted-foreground truncate">{r.tissue_group}</div>
                  )}
                </td>
                <td className="align-top">
                  <div className="truncate" title={r.cell_type ?? undefined}>
                    {r.cell_type ?? "—"}
                  </div>
                </td>
                <td className="align-top">
                  {pairs.length ? (
                    <ul className="space-y-0.5">
                      {pairs.map((p) => (
                        <li key={p} className="text-[12px] text-foreground/80 truncate" title={p}>
                          {p}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className={cn("num whitespace-nowrap align-top", r.suspect_cells && "text-warning")}>
                  {r.suspect_cells && (
                    <AlertTriangle
                      size={11}
                      className="inline mr-1"
                      aria-label="Implausible cell count — under review"
                    />
                  )}
                  {r.n_cells == null ? "—" : fmtInt(r.n_cells)}
                  <div
                    className="font-sans text-[11px] text-muted-foreground font-normal truncate"
                    title={r.assay_family ?? r.protocol ?? undefined}
                  >
                    {r.assay_family ?? r.protocol ?? "—"}
                  </div>
                </td>
                <td className="align-top">
                  <StatusCell s={r} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default SampleTable;

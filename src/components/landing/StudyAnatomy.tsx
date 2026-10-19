import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/integrations/api/client";
import { fmtInt } from "@/lib/catalog-display";
import { EXAMPLE_GSE } from "@/lib/install-snippets";


/** A real study (GSE138867, read live) laid out the way the site shows it. */
export function StudyAnatomy() {
  const { data } = useQuery({ queryKey: ["gse", EXAMPLE_GSE], queryFn: () => apiClient.gse(EXAMPLE_GSE), staleTime: 300_000 });
  const { data: index } = useQuery({ queryKey: ["bundle-index", EXAMPLE_GSE], queryFn: () => apiClient.bundleIndex(EXAMPLE_GSE), staleTime: 300_000 });

  const samples = (data?.samples ?? []).filter((s) => s.n_cells != null);
  const cells = samples.reduce((n, s) => n + (s.n_cells ?? 0), 0);
  const max = Math.max(1, ...samples.map((s) => s.n_cells ?? 0));
  const condKey = data?.conditions[0]?.key;
  const files = (index?.samples[0]?.files ?? []).map((f) => f.path.split("/").pop() ?? f.path);

  return (
    <Link
        to={`/study/${EXAMPLE_GSE}`}
        className="surface block p-5 text-left hover:border-primary/40 transition-colors"
        aria-label={`Open ${EXAMPLE_GSE}`}
      >
        <p className="font-mono text-[13px] text-primary">{EXAMPLE_GSE}</p>
        <p className="mt-1 text-[16px] font-semibold leading-snug">{data?.series.title ?? "Loading the study…"}</p>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          {data
            ? [data.meta?.organism_label ?? data.series.organism_label, data.meta?.tissue_groups[0], data.meta?.assay_families[0], `${fmtInt(samples.length)} samples`, `${fmtInt(cells)} cells`]
                .filter(Boolean)
                .join(" · ")
            : " "}
        </p>
        {data?.conditions[0] && (
          <p className="mt-3 flex flex-wrap gap-1.5">
            {data.conditions[0].values.map((v, i) => (
              <span key={v} className="flag h-6 font-normal">
                {condKey}: {v} ({data.conditions[0].counts[i]})
              </span>
            ))}
          </p>
        )}
        <div className="mt-4">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Cells per sample</p>
          <ul className="space-y-1">
            {samples.map((s) => (
              <li key={s.gsm_id} className="flex items-center gap-2 text-[11.5px]">
                <span className="font-mono text-muted-foreground w-[86px] shrink-0">{s.gsm_id}</span>
                <span className="block h-2 shrink-0 rounded-sm bg-primary" style={{ width: `${((s.n_cells ?? 0) / max) * 60}%` }} />
                <span className="tabular text-muted-foreground">{fmtInt(s.n_cells ?? 0)}</span>
              </li>
            ))}
          </ul>
        </div>
        {files.length > 0 && (
          <p className="mt-4 flex flex-wrap gap-1.5">
            {files.map((f) => (
              <span key={f} className="font-mono text-[11px] rounded border border-border px-1.5 py-0.5 text-muted-foreground">
                {f}
              </span>
            ))}
          </p>
        )}
        {index?.reference_build && (
          <p className="mt-3 text-[12px] text-muted-foreground">
            Aligned to <span className="font-mono">{index.reference_build}</span>
            {index.singlet_version ? <> · pipeline {index.singlet_version}</> : null}
          </p>
        )}
      </Link>
  );
}

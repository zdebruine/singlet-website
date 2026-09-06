import { Link } from "react-router-dom";
import { fmtCompact, fmtInt, organismLabel } from "@/lib/catalog-display";
import type { RelatedStudy } from "@/integrations/api/types";

interface RelatedStudiesProps {
  related: RelatedStudy[];
}

/** Up to 8 related studies with a one-line reason each. Hidden entirely when empty. */
export function RelatedStudies({ related }: RelatedStudiesProps) {
  if (!related.length) return null;
  const items = related.slice(0, 8);

  return (
    <section className="mt-8" aria-labelledby="related-h">
      <h2 id="related-h" className="text-[18px] mb-3">Related studies</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((r) => (
          <Link
            key={r.gse_id}
            to={`/study/${r.gse_id}`}
            className="surface px-3.5 py-3 min-w-0 hover:border-primary/50 transition-colors block"
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="font-mono text-[12.5px] text-primary font-medium">{r.gse_id}</span>
              {r.reason && (
                <span className="text-[11px] text-muted-foreground bg-secondary/70 rounded-sm px-1.5 py-0.5 shrink-0">{r.reason}</span>
              )}
            </div>
            <p className="text-[13.5px] text-foreground leading-snug line-clamp-2">{r.title ?? "Untitled study"}</p>
            <p className="mt-1 text-[12px] text-muted-foreground tabular">
              {[
                organismLabel(r.organism_label) || null,
                r.tissue_groups.length ? r.tissue_groups.slice(0, 2).join(", ") : null,
                r.n_cells > 0 ? `${fmtCompact(r.n_cells)} cells` : null,
                r.n_done > 0 ? `${fmtInt(r.n_done)} samples` : null,
                r.year ? String(r.year) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

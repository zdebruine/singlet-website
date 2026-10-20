import { fmtCompact } from "@/lib/catalog-display";
import { cn } from "@/lib/utils";
import { useInView } from "./charts";

export interface FunnelStep {
  label: string;
  value: number;
  /** The stage a sample passes to reach this step, shown above it. */
  stage?: string;
}

/**
 * Centered funnel: each step is narrower than the last, with the stage between them. Shows what passed, never
 * what did not.
 */
export function QcFunnel({ steps }: { steps: FunnelStep[] }) {
  const [ref, inView] = useInView<HTMLOListElement>();
  const top = Math.max(1, steps[0]?.value ?? 1);
  return (
    <ol ref={ref} className="space-y-1.5">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const pct = Math.max(14, (s.value / top) * 100);
        return (
          <li key={s.label}>
            {s.stage && (
              <p className="py-1 text-center text-[11.5px] uppercase tracking-wider text-muted-foreground">
                <span aria-hidden="true">▾ </span>
                {s.stage}
              </p>
            )}
            <div className="flex justify-center">
              <div
                className={cn(
                  "flex items-center justify-between gap-3 rounded-[4px] px-3 h-10 transition-[width] duration-1000 ease-out motion-reduce:transition-none",
                  last ? "bg-primary text-primary-foreground" : "bg-[var(--teal-100)] text-foreground"
                )}
                style={{ width: inView ? `${pct}%` : "14%", transitionDelay: `${i * 120}ms` }}
              >
                <span className="truncate text-[13px] font-medium">{s.label}</span>
                <span className="shrink-0 font-mono text-[13px] tabular">{fmtCompact(s.value)}</span>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** The site-wide sample funnel from GEO to a downloadable, QC-approved sample (/api/stats accounting). */
export function sampleFunnel(acc: Record<string, number>): FunnelStep[] {
  return [
    { label: "Samples listed on GEO", value: acc.samples_advertised ?? 0 },
    { label: "Raw reads processed", value: acc.samples_done ?? 0, stage: "aligned and counted" },
    { label: "Packed into a study file", value: acc.done_in_files ?? 0, stage: "study file built" },
    { label: "High quality, downloadable", value: acc.in_files_usable_downloadable ?? 0, stage: "quality control" },
  ];
}

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtInt } from "@/lib/catalog-display";
import type { Condition } from "@/integrations/api/types";

export interface ConditionFilter {
  key: string;
  value: string;
}

interface Props {
  conditions: Condition[];
  /** Samples that carried any GEO characteristics at all. */
  nWithCharacteristics: number;
  nSamples: number;
  active: ConditionFilter | null;
  onToggle: (f: ConditionFilter) => void;
  onClear: () => void;
}

/**
 * The study's experimental design as read from GEO sample characteristics:
 * one row per condition key, one clickable cell per value (with its sample
 * count). Clicking a value filters the samples table below.
 */
export function ConditionsPanel({ conditions, nWithCharacteristics, nSamples, active, onToggle, onClear }: Props) {
  if (!conditions.length) {
    return (
      <div className="surface px-4 py-3 text-[13px] text-muted-foreground">
        {nWithCharacteristics === 0
          ? "GEO lists no sample characteristics for this study, so no conditions could be read."
          : "No characteristic splits the samples into groups — every sample shares the same annotations, or each value is unique to one sample."}
      </div>
    );
  }

  return (
    <div className="surface overflow-hidden">
      <table className="data-table w-full">
        <colgroup>
          <col className="w-[160px] md:w-[200px]" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th>Condition</th>
            <th>
              <span className="flex items-center justify-between gap-3">
                <span>Values (samples)</span>
                {active && (
                  <button type="button" onClick={onClear} className="inline-flex items-center gap-1 text-primary hover:underline font-normal normal-case">
                    <X size={11} /> clear filter
                  </button>
                )}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {conditions.map((c) => {
            const total = c.counts.reduce((a, b) => a + b, 0);
            return (
              <tr key={c.key}>
                <td className="font-medium text-foreground align-top">
                  <div className="truncate" title={c.key}>{c.key}</div>
                  {total < nSamples && (
                    <div className="text-[11px] text-muted-foreground font-normal">on {fmtInt(total)} of {fmtInt(nSamples)} samples</div>
                  )}
                </td>
                <td>
                  <ul className="flex flex-wrap gap-1.5" aria-label={`Values for ${c.key}`}>
                    {c.values.map((v, i) => {
                      const on = active?.key === c.key && active.value === v;
                      return (
                        <li key={v}>
                          <button
                            type="button"
                            onClick={() => onToggle({ key: c.key, value: v })}
                            aria-pressed={on}
                            title={on ? "Show all samples" : `Show only samples where ${c.key} = ${v}`}
                            className={cn(
                              "chip h-7 max-w-[360px] font-normal",
                              on && "border-primary/60 bg-primary/[0.06] text-primary"
                            )}
                          >
                            <span className="truncate">{v}</span>
                            <span className={cn("font-mono text-[11px] tabular", on ? "text-primary/80" : "text-muted-foreground")}>{c.counts[i]}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default ConditionsPanel;

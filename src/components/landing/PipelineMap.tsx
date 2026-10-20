import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Stop {
  key: string;
  label: string;
  /** One short fact shown under the stop's name. */
  fact: ReactNode;
  /** One or two sentences, shown when the stop is selected. */
  detail: ReactNode;
}

/**
 * A subway map: stations on one line, from raw data to the reader's tool. Clicking a station shows its detail
 * card; the first is selected to start. Horizontal from md up, vertical on phones.
 */
export function PipelineMap({ stops }: { stops: Stop[] }) {
  const [active, setActive] = useState(0);
  const cur = stops[active];

  return (
    <div>
      {/* Desktop: one horizontal line */}
      <div className="hidden md:block">
        <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${stops.length}, minmax(0, 1fr))` }}>
          <span aria-hidden="true" className="absolute top-[11px] h-[3px] rounded bg-[var(--teal-200)]" style={{ left: `${50 / stops.length}%`, right: `${50 / stops.length}%` }} />
          <span
            aria-hidden="true"
            className="absolute top-[11px] h-[3px] rounded bg-primary transition-[width] duration-500 motion-reduce:transition-none"
            style={{ left: `${50 / stops.length}%`, width: `${(active * 100) / stops.length}%` }}
          />
          {stops.map((s, i) => (
            <li key={s.key} className="relative flex flex-col items-center text-center px-1">
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-pressed={i === active}
                aria-label={`Step ${i + 1}: ${s.label}`}
                className={cn(
                  "relative z-10 grid place-items-center h-[25px] w-[25px] rounded-full border-[3px] transition-colors",
                  i <= active ? "border-primary bg-primary" : "border-[var(--teal-200)] bg-card hover:border-primary"
                )}
              >
                {i === active && <span className="h-2 w-2 rounded-full bg-card" />}
              </button>
              <button type="button" onClick={() => setActive(i)} className="mt-3 text-[13.5px] font-semibold leading-tight hover:text-primary">
                {s.label}
              </button>
              <span className="mt-1 text-[11.5px] leading-snug text-muted-foreground">{s.fact}</span>
            </li>
          ))}
        </ol>
        <div className="mt-8 surface p-5 md:p-6 min-h-[96px]" aria-live="polite">
          <p className="type-mono text-primary">
            {String(active + 1).padStart(2, "0")} · {cur.label}
          </p>
          <div className="mt-2 text-[15px] leading-relaxed max-w-[760px]">{cur.detail}</div>
        </div>
      </div>

      {/* Phone: a vertical line, each stop opens in place */}
      <ol className="md:hidden relative pl-8">
        <span aria-hidden="true" className="absolute left-[11px] top-2 bottom-2 w-[3px] rounded bg-[var(--teal-200)]" />
        {stops.map((s, i) => (
          <li key={s.key} className="relative pb-5">
            <span className={cn("absolute -left-8 top-0.5 h-[25px] w-[25px] rounded-full border-[3px]", i === active ? "border-primary bg-primary" : "border-[var(--teal-200)] bg-card")} />
            <button type="button" onClick={() => setActive(i)} aria-expanded={i === active} className="text-left">
              <span className="block text-[15px] font-semibold">{s.label}</span>
              <span className="block text-[12.5px] text-muted-foreground">{s.fact}</span>
            </button>
            {i === active && <div className="mt-2 text-[14px] leading-relaxed">{s.detail}</div>}
          </li>
        ))}
      </ol>
    </div>
  );
}

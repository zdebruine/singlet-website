/**
 * Small, plain charts for the home page. Every value is passed in from a live endpoint, except
 * FormatSizeChart, which shows a published benchmark and says so.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { fmtInt } from "@/lib/catalog-display";

/** True once the element has scrolled into view (immediately without IntersectionObserver or with reduced motion). */
export function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!el || reduce || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) {
        setInView(true);
        io.disconnect();
      }
    }, { rootMargin: "0px 0px -15% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, inView] as const;
}

export interface BarDatum {
  label: string;
  value: number;
  /** Text at the end of the bar; defaults to the value. */
  display?: string;
  href?: string;
  highlight?: boolean;
}

/** Horizontal bars, scaled to `max` (default: the largest value). */
export function HBars({ data, max, labelWidth = "w-[180px]", className }: { data: BarDatum[]; max?: number; labelWidth?: string; className?: string }) {
  const [ref, inView] = useInView<HTMLUListElement>();
  const top = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <ul ref={ref} className={cn("space-y-2", className)}>
      {data.map((d, i) => {
        const pct = Math.max(0.5, (d.value / top) * 100);
        const row = (
          <>
            <span className={cn("shrink-0 truncate text-[13px] text-right", labelWidth, d.highlight ? "font-semibold text-foreground" : "text-muted-foreground")}>{d.label}</span>
            <span className="relative flex-1 h-5 min-w-0">
              <span
                className={cn("absolute inset-y-0 left-0 rounded-[3px] transition-[width] duration-1000 ease-out motion-reduce:transition-none", d.highlight ? "bg-primary" : "bg-[var(--teal-200)]")}
                style={{ width: inView ? `${pct}%` : "0%", transitionDelay: `${i * 60}ms` }}
              />
            </span>
            <span className={cn("shrink-0 w-[64px] text-[12.5px] tabular", d.highlight ? "font-semibold text-foreground" : "text-muted-foreground")}>{d.display ?? fmtInt(d.value)}</span>
          </>
        );
        return (
          <li key={d.label}>
            {d.href ? (
              <Link to={d.href} className="flex items-center gap-3 rounded hover:bg-secondary/60 transition-colors" title={`Browse ${d.label}`}>
                {row}
              </Link>
            ) : (
              <div className="flex items-center gap-3">{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Vertical columns (one per year, oldest first). The last column can be marked partial. */
export function Columns({ data, partialLast, className }: { data: { label: string; value: number }[]; partialLast?: boolean; className?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const top = Math.max(1, ...data.map((d) => d.value));
  return (
    <div ref={ref} className={cn("flex items-end gap-1.5 h-[180px]", className)}>
      {data.map((d, i) => {
        const partial = partialLast && i === data.length - 1;
        return (
          <div key={d.label} className="flex-1 min-w-0 h-full flex flex-col justify-end items-center gap-1" title={`${d.label}: ${fmtInt(d.value)} studies${partial ? " so far" : ""}`}>
            <span className="text-[11px] tabular text-muted-foreground">{fmtInt(d.value)}</span>
            <span
              className={cn("w-full rounded-t-[3px] transition-[height] duration-1000 ease-out motion-reduce:transition-none", partial ? "bg-[var(--teal-100)] border border-dashed border-primary" : "bg-primary")}
              style={{ height: inView ? `${(d.value / top) * 82}%` : "0%", transitionDelay: `${i * 50}ms` }}
            />
            <span className="text-[11px] text-muted-foreground">{partial ? `${d.label.slice(2)}*` : `’${d.label.slice(2)}`}</span>
          </div>
        );
      })}
    </div>
  );
}

/** One bar split into parts that add up to the whole, with a legend. */
export function StackedBar({ parts }: { parts: { label: string; value: number; className: string }[] }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const total = Math.max(1, parts.reduce((n, p) => n + p.value, 0));
  return (
    <div ref={ref}>
      <div className="flex h-9 w-full overflow-hidden rounded-[4px] bg-secondary">
        {parts.map((p, i) => (
          <span
            key={p.label}
            className={cn("h-full transition-[width] duration-1000 ease-out motion-reduce:transition-none", p.className)}
            style={{ width: inView ? `${(p.value / total) * 100}%` : "0%", transitionDelay: `${i * 150}ms` }}
            title={`${p.label}: ${fmtInt(p.value)}`}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2 text-[13px]">
            <span className={cn("h-3 w-3 rounded-sm", p.className)} aria-hidden="true" />
            <span className="font-mono tabular font-medium">{((p.value / total) * 100).toFixed(1)}%</span>
            <span className="text-muted-foreground">{p.label} ({fmtInt(p.value)})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Size of the same count matrix in common formats, relative to an uncompressed int32 CSC matrix.
 * Medians from the SinglePress (.1pz) benchmark: 3,198 datasets for .1pz, 89 for H5AD, 10x HDF5 and
 * scipy npz, 20 for RDS and BPCells (singlet-bio, papers/manuscripts/singlepress-format, Table 1).
 */
const FORMAT_COMPRESSION: [string, number][] = [
  ["H5AD (AnnData, gzip)", 2.7],
  ["10x HDF5 (gzip)", 3.0],
  ["scipy npz", 3.2],
  ["RDS dgCMatrix", 3.3],
  ["BPCells", 3.8],
  [".singlet (.1pz)", 9.5],
];

export function FormatSizeChart() {
  const data: BarDatum[] = FORMAT_COMPRESSION.map(([label, ratio]) => ({
    label,
    value: 100 / ratio,
    display: `${(100 / ratio).toFixed(0)}%`,
    highlight: label.startsWith(".singlet"),
  }));
  return <HBars data={data} max={40} labelWidth="w-[150px] sm:w-[170px]" />;
}

export const H5AD_RATIO = 9.5 / 2.7;

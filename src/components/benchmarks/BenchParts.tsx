import { Link } from "react-router-dom";
import { Check, X, Clock } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import {
  capabilityState, metricState, type BenchMetric, type BenchPanel, type BenchResult, type CapabilityState,
} from "@/lib/benchmarks";

const OTHER_COLORS = ["#7aa6ad", "#b8a37a", "#9a8fb8", "#c08a8a", "#8aa87a"];

export function StateBadge({ state }: { state: CapabilityState | "pass" | "fail" | "pending" }) {
  const map = {
    passing: ["Passing", "text-primary border-primary/30 bg-primary/10", Check],
    pass: ["Pass", "text-primary border-primary/30 bg-primary/10", Check],
    failing: ["Not yet passing", "text-destructive border-destructive/30 bg-destructive/10", X],
    fail: ["Fail", "text-destructive border-destructive/30 bg-destructive/10", X],
    in_progress: ["Benchmark in progress", "text-muted-foreground border-border bg-secondary", Clock],
    pending: ["Pending", "text-muted-foreground border-border bg-secondary", Clock],
  } as const;
  const [label, cls, Icon] = map[state];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[12px] font-medium", cls)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}

export function CapabilityState_({ result }: { result: BenchResult | null }) {
  return <StateBadge state={capabilityState(result)} />;
}

/** Grouped bars or lines, one series per tool. Singlet is the brand colour. */
export function PanelChart({ panel }: { panel: BenchPanel }) {
  const labels = Array.from(new Set(panel.series.flatMap((s) => s.points.map((p) => p.label))));
  const rows = labels.map((label) => {
    const row: Record<string, string | number> = { label };
    for (const s of panel.series) {
      const p = s.points.find((x) => x.label === label);
      if (p) row[s.tool] = p.value;
    }
    return row;
  });
  let other = 0;
  const colors = panel.series.map((s) => (s.singlet ? "var(--primary)" : OTHER_COLORS[other++ % OTHER_COLORS.length]));
  const axis = { fontSize: 12, fill: "var(--muted-text, #6b7280)" };
  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
      <XAxis dataKey="label" tick={axis} interval={0} />
      <YAxis tick={axis} width={52} label={{ value: panel.unit, angle: -90, position: "insideLeft", style: { ...axis, textAnchor: "middle" } }} />
      <Tooltip />
      <Legend wrapperStyle={{ fontSize: 12 }} />
    </>
  );
  return (
    <figure className="surface rounded-lg border border-border p-4">
      <figcaption className="mb-1 text-[14px] font-semibold text-foreground">{panel.title}</figcaption>
      <p className="mb-3 text-[12px] text-muted-foreground">{panel.direction === "higher" ? "Higher is better" : "Lower is better"} · {panel.unit}</p>
      <div className="h-64" role="img" aria-label={`${panel.title}: ${panel.series.map((s) => s.tool).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          {panel.kind === "line" ? (
            <LineChart data={rows}>
              {common}
              {panel.series.map((s, i) => (
                <Line key={s.tool} dataKey={s.tool} stroke={colors[i]} strokeWidth={s.singlet ? 2.5 : 1.5} dot={{ r: 3 }} isAnimationActive={false} />
              ))}
            </LineChart>
          ) : (
            <BarChart data={rows}>
              {common}
              {panel.series.map((s, i) => (
                <Bar key={s.tool} dataKey={s.tool} fill={colors[i]} isAnimationActive={false} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {panel.note && <p className="mt-2 text-[12px] text-muted-foreground">{panel.note}</p>}
    </figure>
  );
}

export function MetricTable({ metrics }: { metrics: BenchMetric[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="border-b border-border text-left text-[12px] uppercase tracking-wider text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Metric</th>
            <th className="py-2 pr-4 font-medium">Value</th>
            <th className="py-2 pr-4 font-medium">Requirement</th>
            <th className="py-2 font-medium">State</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.name} className="border-b border-border/60">
              <td className="py-2 pr-4 text-foreground">{m.name}</td>
              <td className="py-2 pr-4 tabular">{m.value == null ? "n/a" : `${m.value}${m.unit ? ` ${m.unit}` : ""}`}</td>
              <td className="py-2 pr-4 tabular text-muted-foreground">
                {m.comparator} {m.threshold}{m.unit ? ` ${m.unit}` : ""}{m.baseline ? ` (${m.baseline})` : ""}
              </td>
              <td className="py-2"><StateBadge state={metricState(m)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InProgress({ name }: { name: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center">
      <StateBadge state="in_progress" />
      <p className="mx-auto mt-3 max-w-md text-[14px] text-muted-foreground">
        Results for {name.toLowerCase()} are not published yet. Charts and pass/fail states appear here when the benchmark has run.
      </p>
    </div>
  );
}

export function BackLink() {
  return (
    <Link to="/benchmarking" className="text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
      All benchmarks
    </Link>
  );
}

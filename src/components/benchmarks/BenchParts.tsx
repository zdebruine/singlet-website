import { Link } from "react-router-dom";
import { Check, Clock, Minus, X } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { isGating, type BenchFigure, type BenchMetric, type BenchReach, type BenchResource, type CapabilityStatus, type Pareto } from "@/lib/benchmarks";

const OTHER_COLORS = ["#7aa6ad", "#b8a37a", "#9a8fb8", "#c08a8a", "#8aa87a"];
const AXIS = { fontSize: 12, fill: "var(--muted-text, #6b7280)" };
const isSinglet = (name: string) => name.toLowerCase() === "singlet";

/** Singlet is always the brand colour; other tools take a stable colour by position in `names`. */
function colorFor(name: string, names: string[]): string {
  if (isSinglet(name)) return "var(--primary)";
  return OTHER_COLORS[names.filter((n) => !isSinglet(n)).indexOf(name) % OTHER_COLORS.length];
}

const STATUS = {
  pass: ["Passing", "text-primary border-primary/30 bg-primary/10", Check],
  fail: ["Not yet passing", "text-destructive border-destructive/30 bg-destructive/10", X],
  incomplete: ["Benchmark in progress", "text-muted-foreground border-border bg-secondary", Clock],
  missing: ["Benchmark in progress", "text-muted-foreground border-border bg-secondary", Clock],
  invalid: ["Benchmark in progress", "text-muted-foreground border-border bg-secondary", Clock],
  na: ["Informational", "text-muted-foreground border-border bg-secondary", Minus],
} as const;

export function StateBadge({ state }: { state: CapabilityStatus | "na" }) {
  const [label, cls, Icon] = STATUS[state];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[12px] font-medium", cls)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}

export function metricVerdictLabel(m: BenchMetric): "pass" | "fail" | "na" {
  if (!isGating(m)) return "na";
  return m.pass === "pass" ? "pass" : m.pass === "fail" ? "fail" : "na";
}

function Card({ title, sub, children, note }: { title: string; sub?: string; children: React.ReactNode; note?: string }) {
  return (
    <figure className="surface rounded-lg border border-border p-4">
      <figcaption className="mb-1 text-[14px] font-semibold text-foreground">{title}</figcaption>
      {sub && <p className="mb-3 text-[12px] text-muted-foreground">{sub}</p>}
      {children}
      {note && <p className="mt-2 text-[12px] text-muted-foreground">{note}</p>}
    </figure>
  );
}

const yAxis = (label?: string) => (
  <YAxis tick={AXIS} width={56} label={label ? { value: label, angle: -90, position: "insideLeft", style: { ...AXIS, textAnchor: "middle" } } : undefined} />
);

export function figureSupported(f: BenchFigure): boolean {
  if (f.data_file && !(f.series?.length || f.rows?.length)) return false;
  if (f.kind === "box") return false;
  if (f.kind === "heatmap") return !!f.z && !!f.rows && !!f.cols;
  if (f.kind === "table") return !!f.columns && !!f.rows;
  return !!f.series?.length;
}

/** One figure from the contract: bars, lines, scatter, histogram, heatmap or table, drawn from its own numbers. */
export function FigureChart({ figure: f }: { figure: BenchFigure }) {
  const unit = f.y?.unit ?? f.y?.label ?? "";
  const log = f.y?.scale === "log";
  const domain: [number | string, number | string] = [f.y?.min ?? (log ? "auto" : 0), f.y?.max ?? "auto"];

  let body: React.ReactNode;
  if (f.kind === "heatmap") {
    const max = Math.max(1, ...(f.z ?? []).flat());
    body = (
      <table className="text-[12.5px] tabular">
        <thead><tr><th />{f.cols!.map((c) => <th key={c} className="px-2 py-1 text-muted-foreground font-medium">{c}</th>)}</tr></thead>
        <tbody>
          {(f.rows as (string | number)[]).map((r, i) => (
            <tr key={String(r)}>
              <th className="pr-2 text-right text-muted-foreground font-medium">{r}</th>
              {f.z![i].map((v, j) => (
                <td key={j} className="px-3 py-2 text-center" style={{ background: `color-mix(in srgb, var(--primary) ${Math.round((v / max) * 60)}%, transparent)` }}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else if (f.kind === "table") {
    body = (
      <table className="w-full text-[12.5px]">
        <thead><tr>{f.columns!.map((c) => <th key={c} className="py-1 pr-3 text-left font-medium text-muted-foreground">{c}</th>)}</tr></thead>
        <tbody>{(f.rows as (string | number)[][]).map((r, i) => <tr key={i} className="border-t border-border/60">{r.map((v, j) => <td key={j} className="py-1 pr-3 tabular">{v}</td>)}</tr>)}</tbody>
      </table>
    );
  } else {
    const series = f.series ?? [];
    const names = series.map((s) => s.name);
    const cats = (f.x?.categories ?? Array.from(new Set(series.flatMap((s) => s.x ?? [])))).map(String);
    const rows = cats.map((c, i) => {
      const row: Record<string, string | number> = { x: c };
      for (const s of series) {
        const k = s.x ? s.x.map(String).indexOf(c) : i;
        if (k >= 0 && s.y[k] != null) row[s.name] = s.y[k];
      }
      return row;
    });
    const bars = f.kind === "bar" || f.kind === "grouped_bar" || f.kind === "histogram";
    // A single bar series over tool names (x = tool): colour each bar by its tool.
    const byTool = f.kind === "bar" && series.length === 1;
    const grid = <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />;
    const xAxis = <XAxis dataKey="x" tick={AXIS} interval={0} label={f.x?.label ? { value: f.x.label, position: "insideBottom", offset: -2, style: AXIS } : undefined} />;
    const common = <>{grid}{xAxis}{yAxis(unit)}<Tooltip />{series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}</>;
    body = (
      <div className="h-64" role="img" aria-label={f.title}>
        <ResponsiveContainer width="100%" height="100%">
          {bars ? (
            <BarChart data={rows}>
              {common}
              {series.map((s) => (
                <Bar key={s.name} dataKey={s.name} fill={colorFor(s.tool ?? s.name, names)} isAnimationActive={false}>
                  {byTool && rows.map((r) => <Cell key={String(r.x)} fill={colorFor(String(r.x), cats)} />)}
                </Bar>
              ))}
            </BarChart>
          ) : f.kind === "scatter" ? (
            <ScatterChart>
              {grid}
              <XAxis type="number" dataKey="x" tick={AXIS} scale={f.x?.scale === "log" ? "log" : "auto"} domain={["auto", "auto"]} name={f.x?.label} />
              <YAxis type="number" dataKey="y" tick={AXIS} width={56} scale={log ? "log" : "auto"} domain={domain} name={f.y?.label} />
              <Tooltip />
              {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {series.map((s) => (
                <Scatter key={s.name} name={s.name} data={s.y.map((y, i) => ({ x: Number(s.x?.[i] ?? i), y }))} fill={colorFor(s.tool ?? s.name, names)} isAnimationActive={false} />
              ))}
            </ScatterChart>
          ) : (
            <LineChart data={rows}>
              {common}
              {series.map((s) => <Line key={s.name} dataKey={s.name} stroke={colorFor(s.tool ?? s.name, names)} strokeWidth={isSinglet(s.tool ?? s.name) ? 2.5 : 1.5} dot={{ r: 3 }} isAnimationActive={false} />)}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    );
  }
  return <Card title={f.title} sub={unit ? `Unit: ${unit}` : undefined} note={f.caption}>{body}</Card>;
}

function fmtSeconds(s: number): string {
  return s >= 3600 ? `${(s / 3600).toFixed(1)} h` : s >= 60 ? `${(s / 60).toFixed(1)} min` : `${s.toFixed(0)} s`;
}

/** Quality against runtime, one point per tool, with the Pareto frontier drawn. Runtime is context, not a verdict. */
export function ParetoChart({ pareto }: { pareto: Pareto }) {
  const names = pareto.points.map((p) => p.tool);
  const q = pareto.metric;
  return (
    <Card
      title="Quality against runtime"
      sub={`${q.name} (${q.direction} is better) vs mean wall time. The line joins the tools nothing else beats on both.`}
      note="Speed alone is not the goal. Exact genome-wide alignment can place reads that a pseudoaligner such as alevin-fry misses, so Singlet is judged on where it sits on this frontier, not on runtime by itself."
    >
      <div className="h-64" role="img" aria-label="Quality against runtime">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ left: 4, right: 12, top: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis type="number" dataKey="seconds" tick={AXIS} scale="log" domain={["auto", "auto"]} tickFormatter={fmtSeconds} name="Runtime" />
            <YAxis type="number" dataKey="quality" tick={AXIS} width={56} domain={["auto", "auto"]} name={q.name} />
            <Tooltip formatter={(v: number, n: string) => (n === "Runtime" ? fmtSeconds(v) : v)} />
            <Scatter data={pareto.frontier} line={{ stroke: "var(--muted-text, #6b7280)", strokeDasharray: "4 3" }} shape={() => <g />} legendType="none" isAnimationActive={false} />
            {pareto.points.map((p) => (
              <Scatter key={p.tool} name={p.tool} data={[p]} fill={colorFor(p.tool, names)} isAnimationActive={false} />
            ))}
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

const REACH_MARK = { yes: ["Yes", "text-primary"], partial: ["Partial", "text-foreground"], no: ["No", "text-muted-foreground"] } as const;

/** Which outputs each tool can produce at all. */
export function ReachPanel({ reach }: { reach: BenchReach[] }) {
  const tools = Array.from(new Set(reach.map((r) => r.tool)));
  const outputs = Array.from(new Set(reach.map((r) => r.output)));
  return (
    <Card title="Reach" sub="Which outputs each tool can produce at all." >
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-muted-foreground"><th className="py-1 pr-3 font-medium">Output</th>{tools.map((t) => <th key={t} className="py-1 pr-3 font-medium">{t}</th>)}</tr>
          </thead>
          <tbody>
            {outputs.map((o) => (
              <tr key={o} className="border-t border-border/60">
                <td className="py-1.5 pr-3 text-foreground">{o}</td>
                {tools.map((t) => {
                  const e = reach.find((r) => r.tool === t && r.output === o);
                  const [label, cls] = e ? REACH_MARK[e.supported] : ["n/a", "text-muted-foreground"];
                  return <td key={t} className={cn("py-1.5 pr-3", cls)} title={e?.note}>{label}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const fmtVal = (v: number | null | undefined, unit: string) => (v == null ? "n/a" : `${+v.toPrecision(4)}${unit && unit !== "fraction" ? ` ${unit}` : ""}`);

function ruleText(m: BenchMetric): string {
  const r = m.rule;
  if (r.type === "threshold") return `${m.direction === "lower" ? "<=" : ">="} ${r.value}`;
  if (r.type === "match_or_beat") return `match or beat ${r.against && r.against !== "best" ? r.against.join(", ") : "the best competitor"}`;
  if (r.type === "equivalence") return `within tolerance of ${r.target ?? "target"}`;
  return "informational";
}

export function MetricTable({ metrics }: { metrics: BenchMetric[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="border-b border-border text-left text-[12px] uppercase tracking-wider text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Metric</th>
            <th className="py-2 pr-4 font-medium">Singlet</th>
            <th className="py-2 pr-4 font-medium">Competitors</th>
            <th className="py-2 pr-4 font-medium">Rule</th>
            <th className="py-2 font-medium">State</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.id} className="border-b border-border/60 align-top">
              <td className="py-2 pr-4 text-foreground">{m.name}<span className="block text-[12px] text-muted-foreground">{m.dataset}</span></td>
              <td className="py-2 pr-4 tabular">{fmtVal(m.singlet.value, m.unit)}</td>
              <td className="py-2 pr-4 tabular text-muted-foreground">
                {(m.competitors ?? []).length ? m.competitors!.map((c) => <span key={c.tool} className="block">{c.tool} {fmtVal(c.value, m.unit)}</span>) : "none"}
              </td>
              <td className="py-2 pr-4 text-muted-foreground">{ruleText(m)}</td>
              <td className="py-2"><StateBadge state={metricVerdictLabel(m) === "na" ? "na" : metricVerdictLabel(m) === "pass" ? "pass" : "fail"} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResourcesTable({ resources }: { resources: BenchResource[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[12px] uppercase tracking-wider text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Tool</th><th className="py-2 pr-4 font-medium">Dataset</th>
            <th className="py-2 pr-4 font-medium">Wall time</th><th className="py-2 pr-4 font-medium">Peak memory</th><th className="py-2 font-medium">Threads</th>
          </tr>
        </thead>
        <tbody>
          {resources.map((r, i) => (
            <tr key={i} className="border-b border-border/60">
              <td className="py-1.5 pr-4 text-foreground">{r.tool}</td>
              <td className="py-1.5 pr-4 text-muted-foreground">{r.dataset ?? "pooled"}</td>
              <td className="py-1.5 pr-4 tabular">{fmtSeconds(r.wall_s)}</td>
              <td className="py-1.5 pr-4 tabular">{r.max_rss_gb} GB</td>
              <td className="py-1.5 tabular">{r.threads}</td>
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
      <StateBadge state="missing" />
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

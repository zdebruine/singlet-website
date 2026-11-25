import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReadyPoint } from "@/lib/beta-progress";

// Work queued ahead of the H100s: the hours of GPU work already downloaded and staged, with the download rate and the H100s' 60-minute
// utilization beneath it on the same time axis. Three single-measure panels share one hover, never two scales on one chart.

type Range = "24h" | "7d";
const RANGE_MS: Record<Range, number> = { "24h": 86_400_000, "7d": 7 * 86_400_000 };

interface Row { ms: number; ready: number | null; dl: number | null; util: number | null; staged: number | null }

const fmtTime = (ms: number, range: Range) =>
  new Date(ms).toLocaleString("en-US", range === "24h" ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" });
const fmtFull = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const n1 = (v: number | null | undefined, unit = "") => (v == null ? "–" : `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}${unit}`);

function HoverCard({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  const r = active && payload?.[0]?.payload;
  if (!r) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-[12.5px] shadow-sm">
      <p className="text-muted-foreground">{fmtFull(r.ms)}</p>
      <p className="mt-1 text-foreground">
        <span className="tabular-nums font-medium">{n1(r.ready, " h")}</span> of H100 work ready
        {r.staged != null && <span className="text-muted-foreground"> ({n1(r.staged)} samples)</span>}
      </p>
      <p className="text-foreground"><span className="tabular-nums">{n1(r.dl, " Gbit/s")}</span> downloading</p>
      <p className="text-foreground"><span className="tabular-nums">{n1(r.util, "%")}</span> H100 use, last 60 min</p>
    </div>
  );
}

function Panel({ rows, dataKey, label, unit, range, domain, height, stroke, width, showX, card = false }: {
  rows: Row[]; dataKey: keyof Row; label: string; unit: string; range: Range; domain?: [number, number | "auto"]; height: number;
  stroke: string; width: number; showX: boolean; card?: boolean;
}) {
  const [x0, x1] = [rows[0]?.ms ?? 0, rows[rows.length - 1]?.ms ?? 0];
  return (
    <div>
      <p className="text-[12.5px] text-muted-foreground">{label}</p>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} syncId="ready-queue" margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="ms" type="number" scale="time" domain={[x0, x1]} hide={!showX} tickFormatter={(v) => fmtTime(v, range)}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="var(--border)" minTickGap={48} />
            <YAxis width={width} domain={domain ?? [0, "auto"]} tickCount={3} interval="preserveStartEnd" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              stroke="var(--border)" tickFormatter={(v) => `${Number(v).toLocaleString("en-US", { maximumFractionDigits: 1 })}${unit}`} />
            <Tooltip content={card ? <HoverCard /> : () => null} cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }} />
            <Line dataKey={dataKey} stroke={stroke} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false}
              activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function ReadyQueue({ points, nowMs }: { points: ReadyPoint[]; nowMs: number }) {
  const [range, setRange] = useState<Range>("24h");
  const rows = useMemo(() => {
    const from = nowMs - RANGE_MS[range];
    return points
      .map((p) => ({ ms: Date.parse(p.t), ready: p.ready_hours_h100, dl: p.dl_gbps, util: p.h100_avg60_pct, staged: p.staged_samples_h100 }))
      .filter((r) => Number.isFinite(r.ms) && r.ms >= from)
      .sort((a, b) => a.ms - b.ms);
  }, [points, range, nowMs]);
  const latest = rows[rows.length - 1];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-foreground">
          {latest ? <>Now <span className="tabular-nums font-medium">{n1(latest.ready, " hours")}</span> of work is staged for the H100s.</> : "No points in this range yet."}
        </p>
        <div className="inline-flex rounded-md border border-border p-0.5 text-[12.5px]" role="group" aria-label="Time range">
          {(["24h", "7d"] as Range[]).map((r) => (
            <button key={r} type="button" onClick={() => setRange(r)} aria-pressed={range === r}
              className={`rounded px-2.5 py-1 ${range === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {r === "24h" ? "24 hours" : "7 days"}
            </button>
          ))}
        </div>
      </div>
      {rows.length > 1 && (
        <div className="mt-3 space-y-3" role="img" aria-label={`Hours of H100 work staged over the last ${range === "24h" ? "24 hours" : "7 days"}, with download rate and H100 use`}>
          <Panel rows={rows} dataKey="ready" label="Hours of H100 work ready" unit=" h" range={range} height={150} stroke="var(--primary)" width={44} showX={false} card />
          <Panel rows={rows} dataKey="dl" label="Download rate, Gbit/s" unit="" range={range} height={70} stroke="var(--muted-foreground)" width={44} showX={false} />
          <Panel rows={rows} dataKey="util" label="H100 use, 60-minute average" unit="%" range={range} height={70} domain={[0, 100]} stroke="var(--muted-foreground)" width={44} showX />
        </div>
      )}
      <p className="mt-2 text-[12.5px] text-muted-foreground">
        Downloaded samples waiting for an H100, in hours of GPU work, with the download rate and H100 use on the same time axis.
        A steady buffer keeps the GPUs busy; a falling one means downloads are not keeping up.
      </p>
    </div>
  );
}

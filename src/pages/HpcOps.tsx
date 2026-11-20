import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useAuth } from "@/components/auth/AuthProvider";
import { usePageMeta } from "@/hooks/usePageMeta";
import { cn } from "@/lib/utils";

// Owner-only HPC dashboard at /HPC-dashboard. Data: GET /api/admin/hpc (functions/api/admin/hpc.ts), posted every 30 minutes by the
// Clipper collector (singlet-agents hpc/clipper/dashboard). The snapshot format is functions/_shared/hpc-ops.ts.

type Pt = { t: string } & Record<string, number | string | null>;
interface Node { n: string; k: string; s: string; c: [number, number]; m: [number, number]; l: number; g: [number, number] | null }
interface Kind { nodes: number; up: number; ca: number; ct: number; ma: number; mt: number; ga: number; gt: number }
interface Head {
  pairs_per_s?: number; download_gbps?: number; download_target_gbps?: number; samples_done?: number; samples_queued?: number;
  samples_running?: number; samples_failed?: number; samples_total?: number; samples_per_hour?: number; bottleneck?: string; phase?: string;
  eta_iso?: string; uploads?: number; uploaded_bytes?: number; cf_cost_usd?: number; staging_used_gb?: number; staging_total_gb?: number;
}
interface Snap {
  generated_at: string;
  interval_s: number;
  nodes: Node[];
  kinds: Record<string, Kind>;
  queue: { ours: { running: number; pending: number; cores: number; gpus: number; by_kind: Record<string, { r: number; p: number }> }; all: { running: number; pending: number } };
  storage: { used_tb?: number; total_tb?: number; pct?: number };
  campaign: { present: boolean; age_s?: number | null; headline?: Head; beta?: Beta };
}
type N = number | null | undefined;
interface Beta {
  samples: Record<string, number>;
  queue: Record<string, number>;
  scope: { current_class?: string | null; total?: N; unfinished?: N; classes: Record<string, number> };
  download: { mbit_s_15m?: N; mbit_s_1h?: N; mbit_s_24h?: N; saturation_mbit_s?: N; target_mbit_s?: N; share?: N; paused_backlog?: boolean | null; paused_disk_floor?: boolean | null; paused_staging_cap?: boolean | null };
  throughput: { pairs_per_s_1h?: N; pairs_per_s_24h?: N; samples_1h?: N; samples_24h?: N };
  lanes: Record<string, { running?: N; pending?: N; limit?: N; idle_units?: N }>;
  disk: { free_gb?: N; floor_gb?: N; cap_gb?: N; inflight_gb?: N; parts_gb: Record<string, number> };
  uploads: { bytes_public_total?: N; bytes_private_total?: N; objects_total?: N; objects_24h?: N; samples_24h?: N; stored_gb?: N; est_cost_usd_per_day?: N; est_storage_usd_per_month?: N };
  shipper_backlog?: N;
  errors?: number;
}
type Range = "24h" | "7d" | "all";
type State =
  | { kind: "loading" }
  | { kind: "error"; status: number; message: string }
  | { kind: "ok"; latest: Snap | null; points: Pt[]; now: number };

const RANGES: { id: Range; label: string }[] = [
  { id: "24h", label: "24 h" },
  { id: "7d", label: "7 d" },
  { id: "all", label: "All" },
];
const STALE_MIN = 75;
const KIND_LABEL: Record<string, string> = {
  cpu: "CPU nodes", bigmem: "Big-memory", gpu_h100: "H100 GPUs", gpu_v100s: "V100S GPUs", gpu_rtx8000: "RTX 8000 GPUs", other: "Other (login, service)",
};
const KIND_ORDER = ["cpu", "bigmem", "gpu_h100", "gpu_v100s", "gpu_rtx8000", "other"];
// Series colors come from the site tokens, so they follow light and dark; a dash pattern repeats the distinction without color.
const SERIES = [
  { color: "var(--primary)", dash: undefined },
  { color: "var(--chart-violet)", dash: "6 3" },
  { color: "var(--chart-warning)", dash: "2 3" },
  { color: "var(--chart-danger)", dash: "10 3 2 3" },
  { color: "var(--chart-muted)", dash: "1 3" },
];

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const fmt = (v: number | null | undefined, d = 0) => (v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
function ago(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 90) return `${m} min ago`;
  const h = m / 60;
  return h < 48 ? `${h.toFixed(1)} h ago` : `${Math.round(h / 24)} d ago`;
}
function bytes(v: number | undefined): string {
  if (v == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0, x = v;
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(x < 10 && i ? 1 : 0)} ${u[i]}`;
}

function Tile({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "warn" | "bad" }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums text-foreground", tone === "warn" && "text-[var(--warning)]", tone === "bad" && "text-destructive")}>{value}</div>
      {note && <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{note}</div>}
    </div>
  );
}

function Bar({ pct, tone }: { pct: number; tone?: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-muted" role="presentation">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: tone ?? "var(--primary)" }} />
    </div>
  );
}

const stateTone = (s: string) =>
  s.includes("down") || s.includes("drain") || s.includes("fail") ? "var(--destructive)" : s === "idle" ? "var(--chart-muted)" : s === "allocated" ? "var(--primary)" : "var(--chart-info)";

function NodeTile({ n }: { n: Node }) {
  const cpu = n.c[1] ? (100 * n.c[0]) / n.c[1] : 0;
  const mem = n.m[1] ? (100 * n.m[0]) / n.m[1] : 0;
  return (
    <div className="rounded-md border border-border p-2" title={`${n.n}: ${n.s}, ${n.c[0]}/${n.c[1]} cores, ${n.m[0]}/${n.m[1]} GB, load ${n.l}`}>
      <div className="flex items-center justify-between gap-1 text-[12px]">
        <span className="font-mono font-medium text-foreground">{n.n}</span>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: stateTone(n.s) }} aria-label={n.s} />
      </div>
      <div className="mt-1.5"><Bar pct={cpu} /></div>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{n.c[0]}/{n.c[1]}</span>
        <span>{Math.round(mem)}% mem</span>
      </div>
      {n.g && (
        <div className="mt-1 flex gap-1" aria-label={`${n.g[0]} of ${n.g[1]} GPUs in use`}>
          {Array.from({ length: n.g[1] }, (_, i) => (
            <span key={i} className="h-1.5 flex-1 rounded-sm" style={{ background: i < n.g![0] ? "var(--chart-violet)" : "var(--border)" }} />
          ))}
        </div>
      )}
      <div className="mt-1 text-[10.5px] uppercase tracking-wide text-muted-foreground">{n.s}</div>
    </div>
  );
}

function Chart({ title, unit, data, lines, domainMax, empty }: {
  title: string; unit?: string; data: { x: number; [k: string]: number | null }[]; lines: { key: string; name: string }[]; domainMax?: number; empty: string;
}) {
  const has = lines.some((l) => data.some((d) => d[l.key] != null));
  return (
    <section className="rounded-lg border border-border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {unit && <span className="text-[11px] text-muted-foreground">{unit}</span>}
      </div>
      {has ? (
        <>
          <div className="mt-2 h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="x" type="number" scale="time" domain={["dataMin", "dataMax"]} tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickCount={4}
                  tickFormatter={(x: number) => { const d = new Date(x); return data.length && data[data.length - 1].x - data[0].x > 2 * 86400000 ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }} />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" domain={[0, domainMax ?? "auto"]} width={44} allowDecimals />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }} labelFormatter={(x: number) => new Date(x).toLocaleString()} formatter={(v: number) => fmt(v, 1)} />
                {lines.map((l, i) => (
                  <Line key={l.key} dataKey={l.key} name={l.name} stroke={SERIES[i % SERIES.length].color} strokeDasharray={SERIES[i % SERIES.length].dash} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            {lines.map((l, i) => (
              <span key={l.key} className="inline-flex items-center gap-1">
                <svg width="16" height="6" aria-hidden><line x1="0" x2="16" y1="3" y2="3" stroke={SERIES[i % SERIES.length].color} strokeWidth="2" strokeDasharray={SERIES[i % SERIES.length].dash} /></svg>
                {l.name}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-3 text-[13px] text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

const LANE_LABEL: Record<string, string> = { cpu: "CPU nodes", bigmem: "Big-memory", h100: "H100", v100s: "V100S", rtx8000: "RTX 8000" };

function CampaignSection({ b }: { b: Beta }) {
  const s = b.samples, d = b.download, u = b.uploads, dk = b.disk;
  const mb = (v: N) => (v == null ? "—" : `${fmt(v / 1000, 2)} Gbps`);
  const paused = [d.paused_backlog && "backlog", d.paused_disk_floor && "disk floor", d.paused_staging_cap && "staging cap"].filter(Boolean).join(", ");
  const classes = Object.entries(b.scope.classes);
  const parts = Object.entries(dk.parts_gb).filter(([, v]) => v > 0);
  return (
    <section aria-label="Campaign" className="space-y-3">
      <h2 className="text-base font-semibold text-foreground">Beta campaign</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Tile label="Shipped" value={fmt(s.shipped)} note={`${fmt(s.awaiting_ship)} awaiting ship, ${fmt(s.done)} done`} />
        <Tile label="In review" value={fmt(s.review)} note={`${fmt(s.review_auto)} auto, ${fmt(s.held_mux)} held (multiplexed)`} />
        <Tile label="Excluded" value={fmt(s.excluded)} note={`${fmt(s.failed_final)} failed for good`} tone={(s.failed_final ?? 0) > 0 ? "warn" : undefined} />
        <Tile label="Bytes shipped" value={bytes((u.bytes_public_total ?? 0) + (u.bytes_private_total ?? 0))} note={`${fmt(u.objects_total)} objects, ${fmt(u.samples_24h)} samples in 24 h; about $${fmt(u.est_cost_usd_per_day, 3)} a day`} />
        <Tile label="Download, last 15 min" value={mb(d.mbit_s_15m)} note={`1 h ${mb(d.mbit_s_1h)}, 24 h ${mb(d.mbit_s_24h)}; target ${mb(d.target_mbit_s)} of ${mb(d.saturation_mbit_s)} measured`}
          tone={d.mbit_s_15m != null && d.target_mbit_s && d.mbit_s_15m < 0.5 * d.target_mbit_s ? "warn" : undefined} />
        <Tile label="Downloads" value={paused ? "Paused" : "Running"} note={paused ? `Paused for: ${paused}` : `${fmt((d.share ?? 0) * 100, 0)}% of the measured link allowed`} tone={paused ? "warn" : undefined} />
        <Tile label="Clipper disk free" value={dk.free_gb != null ? `${fmt(dk.free_gb / 1000, 1)} TB` : "—"} note={`floor ${fmt((dk.floor_gb ?? 0) / 1000, 1)} TB; in flight ${fmt(dk.inflight_gb, 0)} GB`} tone={dk.free_gb != null && dk.floor_gb != null && dk.free_gb < dk.floor_gb * 1.2 ? "warn" : undefined} />
        <Tile label="Queue remaining" value={fmt(b.scope.unfinished)} note={`class ${b.scope.current_class ?? "—"}, ${fmt(b.scope.total)} in the corpus; ${fmt(b.queue.running)} batches running, ${fmt(b.queue.pending)} pending`} />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-border">
          <h3 className="border-b border-border p-3 text-sm font-semibold text-foreground">Active pilots per lane</h3>
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground"><th className="p-2 font-medium">Lane</th><th className="p-2 text-right font-medium">Running</th><th className="p-2 text-right font-medium">Pending</th><th className="p-2 text-right font-medium">Cap</th><th className="p-2 text-right font-medium">Idle</th></tr></thead>
            <tbody>{Object.entries(b.lanes).map(([k, v]) => (
              <tr key={k} className="border-t border-border"><td className="p-2">{LANE_LABEL[k] ?? k}</td><td className="p-2 text-right tabular-nums">{fmt(v.running)}</td><td className="p-2 text-right tabular-nums">{fmt(v.pending)}</td><td className="p-2 text-right tabular-nums">{fmt(v.limit)}</td><td className="p-2 text-right tabular-nums">{fmt(v.idle_units)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="rounded-lg border border-border p-3 text-[13px]">
          <h3 className="text-sm font-semibold text-foreground">Queue per class and staging</h3>
          <p className="mt-2 text-muted-foreground">{classes.length ? classes.map(([k, v]) => `class ${k}: ${fmt(v)} samples in the window`).join("; ") : "No classes in the window."}</p>
          <p className="mt-2 text-muted-foreground">{parts.length ? "Staging by part: " + parts.map(([k, v]) => `${k} ${fmt(v, 1)} GB`).join(", ") : "Nothing staged."}</p>
          <p className="mt-2 text-muted-foreground">Shipping backlog {fmt(b.shipper_backlog)}. Stored in the Beta bucket: {fmt(u.stored_gb, 2)} GB. {b.errors ? `${b.errors} coordinator errors.` : "No coordinator errors."}</p>
        </div>
      </div>
    </section>
  );
}

function Dashboard({ snap, points, now, range }: { snap: Snap; points: Pt[]; now: number; range: Range }) {
  const h: Head = snap.campaign.present ? snap.campaign.headline ?? {} : {};
  const camp = snap.campaign.present;
  const ageMs = now - Date.parse(snap.generated_at);
  const stale = ageMs > STALE_MIN * 60000;
  const data = useMemo(() => points.map((p) => ({ x: Date.parse(p.t), ...Object.fromEntries(Object.entries(p).filter(([k]) => k !== "t").map(([k, v]) => [k, num(v)])) })) as { x: number; [k: string]: number | null }[], [points]);
  const kinds = KIND_ORDER.filter((k) => snap.kinds[k]).concat(Object.keys(snap.kinds).filter((k) => !KIND_ORDER.includes(k)));
  const target = h.download_target_gbps, dl = h.download_gbps;
  const dlPct = target && dl != null ? (100 * dl) / target : null;
  const bn = h.bottleneck?.toLowerCase();
  const sph = h.samples_per_hour;
  const etaMs = h.eta_iso ? Date.parse(h.eta_iso) : sph && h.samples_queued != null ? now + (h.samples_queued / sph) * 3600000 : null;
  const etaText = etaMs && Number.isFinite(etaMs) ? new Date(etaMs).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" }) : "—";
  const cores = Object.entries(snap.kinds).filter(([k]) => !k.startsWith("gpu") && k !== "other").reduce((a, [, t]) => [a[0] + t.ca, a[1] + t.ct], [0, 0]);
  const gpus = Object.entries(snap.kinds).filter(([k]) => k.startsWith("gpu")).reduce((a, [, t]) => [a[0] + t.ga, a[1] + t.gt], [0, 0]);
  const waiting = "Waiting for the campaign runner's telemetry.";
  const q = snap.queue.ours;
  const jobs = Object.entries(q.by_kind);

  return (
    <div className="space-y-6">
      <div className={cn("rounded-lg border p-3 text-[13px]", stale ? "border-[var(--warning-border)] bg-[var(--warning-tint)] text-[var(--warning)]" : "border-border text-muted-foreground")} role={stale ? "alert" : undefined}>
        {stale ? `Stale data: the last snapshot is ${ago(ageMs)}, over ${STALE_MIN} minutes old. The collector job may be stopped. ` : ""}
        Snapshot {new Date(snap.generated_at).toLocaleString()} ({ago(ageMs)}); refreshed every 30 minutes.
        {camp ? ` Campaign telemetry ${snap.campaign.age_s != null ? `${Math.round(snap.campaign.age_s / 60)} min old` : "present"}.` : " No campaign telemetry yet."}
      </div>

      <section aria-label="Now" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Tile label="Bottleneck" value={bn ? (bn.includes("down") ? "Download" : bn.includes("comp") || bn.includes("gpu") || bn.includes("cpu") ? "Compute" : h.bottleneck!) : "—"} note={bn ? undefined : waiting} />
        <Tile label="Pairs per second" value={h.pairs_per_s != null ? fmt(h.pairs_per_s, h.pairs_per_s < 100 ? 1 : 0) : "—"} note={h.pairs_per_s != null ? "read pairs aligned, campaign-wide" : waiting} />
        <Tile label="Download vs target" value={dl != null ? `${fmt(dl, 1)} Gbps` : "—"} note={dl != null && target ? `${fmt(dlPct, 0)}% of the ${fmt(target, 1)} Gbps target (80% of the link)` : waiting}
          tone={dlPct != null && dlPct < 50 ? "warn" : undefined} />
        <Tile label="Samples per hour" value={sph != null ? fmt(sph, 1) : "—"} note={h.samples_done != null ? `${fmt(h.samples_done)} done, ${fmt(h.samples_queued)} queued, ${fmt(h.samples_failed)} failed` : waiting} />
        <Tile label={`ETA${h.phase ? ` (${h.phase})` : ""}`} value={etaText} note={etaMs ? "from queued samples and the current rate" : waiting} />
        <Tile label="Cluster cores in use" value={`${fmt(cores[0])} / ${fmt(cores[1])}`} note={`${fmt(q.cores)} are ours; ${fmt(gpus[0])} of ${fmt(gpus[1])} GPUs busy (${fmt(q.gpus)} ours)`} />
        <Tile label="Project space" value={snap.storage.pct != null ? `${fmt(snap.storage.pct, 0)}% full` : "—"} note={snap.storage.used_tb != null ? `${fmt(snap.storage.used_tb, 1)} of ${fmt(snap.storage.total_tb, 0)} TB` + (h.staging_used_gb != null ? `; staging ${fmt(h.staging_used_gb, 0)} GB` : "") : undefined}
          tone={(snap.storage.pct ?? 0) > 95 ? "bad" : (snap.storage.pct ?? 0) > 90 ? "warn" : undefined} />
        <Tile label="Uploads and cost" value={h.uploads != null ? `${fmt(h.uploads)} samples` : "—"} note={h.uploads != null ? `${bytes(h.uploaded_bytes)} to the Beta bucket${h.cf_cost_usd != null ? `; about $${fmt(h.cf_cost_usd, 2)} Cloudflare` : ""}` : waiting} />
      </section>

      {snap.campaign.beta && <CampaignSection b={snap.campaign.beta} />}

      <section aria-label="Nodes">
        <h2 className="mb-2 text-base font-semibold text-foreground">Nodes</h2>
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {kinds.map((k) => {
            const t = snap.kinds[k];
            const g = k.startsWith("gpu");
            const pct = g ? (t.gt ? (100 * t.ga) / t.gt : 0) : t.ct ? (100 * t.ca) / t.ct : 0;
            return (
              <div key={k} className="rounded-lg border border-border p-3">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium text-foreground">{KIND_LABEL[k] ?? k}</span>
                  <span className="tabular-nums text-muted-foreground">{fmt(pct, 0)}% {g ? "of GPUs" : "of cores"}</span>
                </div>
                <div className="mt-2"><Bar pct={pct} /></div>
                <div className="mt-1 text-[12px] text-muted-foreground">{t.up}/{t.nodes} nodes up{g ? `, ${t.ga}/${t.gt} GPUs` : `, ${fmt(t.ca)}/${fmt(t.ct)} cores`}, {fmt(t.mt ? (100 * t.ma) / t.mt : 0, 0)}% memory</div>
              </div>
            );
          })}
        </div>
        {kinds.map((k) => (
          <div key={k} className="mb-3">
            <div className="mb-1 text-[12px] uppercase tracking-wide text-muted-foreground">{KIND_LABEL[k] ?? k}</div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
              {snap.nodes.filter((n) => n.k === k).map((n) => <NodeTile key={n.n} n={n} />)}
            </div>
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground">Bar: cores in use. Dot: node state (teal busy, grey idle, red down or draining). Violet pips: GPUs in use.</p>
      </section>

      <section aria-label="Our jobs">
        <h2 className="mb-2 text-base font-semibold text-foreground">Our jobs</h2>
        <div className="rounded-lg border border-border">
          <div className="border-b border-border p-3 text-[13px] text-muted-foreground">
            {q.running} running and {q.pending} pending of ours. Everyone: {snap.queue.all.running} running, {snap.queue.all.pending} pending.
          </div>
          {jobs.length === 0 ? <p className="p-3 text-[13px] text-muted-foreground">No jobs queued.</p> : (
            <table className="w-full text-[13px]">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground"><th className="p-2 font-medium">Kind (job name)</th><th className="p-2 text-right font-medium">Running</th><th className="p-2 text-right font-medium">Pending</th></tr></thead>
              <tbody>{jobs.map(([k, v]) => <tr key={k} className="border-t border-border"><td className="p-2 font-mono">{k}</td><td className="p-2 text-right tabular-nums">{v.r}</td><td className="p-2 text-right tabular-nums">{v.p}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </section>

      <section aria-label="History" className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">History ({range === "24h" ? "last 24 hours" : range === "7d" ? "last 7 days" : "everything kept"})</h2>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Chart title="Download bandwidth against target" unit="Gbps" data={data} lines={[{ key: "download_gbps", name: "Measured" }, { key: "download_target_gbps", name: "Target" }]} empty={`No bandwidth data yet. ${waiting}`} />
          <Chart title="Pairs processed per second" unit="pairs/s" data={data} lines={[{ key: "pairs_per_s", name: "Pairs/s" }]} empty={`No throughput data yet. ${waiting}`} />
          <Chart title="Utilization by node kind" unit="% in use" data={data} domainMax={100}
            lines={kinds.map((k) => ({ key: "u_" + k, name: KIND_LABEL[k] ?? k }))} empty="No utilization history yet." />
          <Chart title="Queue" unit="jobs" data={data} lines={[{ key: "q_run", name: "Our running" }, { key: "q_pend", name: "Our pending" }, { key: "q_all_pend", name: "All pending" }]} empty="No queue history yet." />
          <Chart title="Samples shipped and excluded" unit="samples" data={data} lines={[{ key: "shipped", name: "Shipped" }, { key: "excluded", name: "Excluded" }, { key: "review", name: "In review" }]} empty={`No sample counts yet. ${waiting}`} />
          <Chart title="Disk" unit="% / GB" data={data} lines={[{ key: "disk_pct", name: "Project space %" }, { key: "staging_used_gb", name: "Staging GB" }, { key: "disk_free_gb", name: "Free GB" }]} empty="No disk history yet." />
        </div>
      </section>
    </div>
  );
}

const HpcOps = () => {
  usePageMeta({ title: "HPC dashboard", path: "/HPC-dashboard", noindex: true });
  const { user, loading, openSignIn } = useAuth();
  const [range, setRange] = useState<Range>("24h");
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback((signal: AbortSignal, quiet: boolean) => {
    if (!quiet) setState({ kind: "loading" });
    fetch(`/api/admin/hpc?range=${range}`, { credentials: "same-origin", signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (signal.aborted) return;
        if (!res.ok) setState({ kind: "error", status: res.status, message: body.message ?? `Request failed (${res.status}).` });
        else setState({ kind: "ok", latest: body.latest as Snap | null, points: (body.points ?? []) as Pt[], now: Date.parse(body.now) || Date.now() });
      })
      .catch(() => {
        if (!signal.aborted && !quiet) setState({ kind: "error", status: 0, message: "Could not reach the server." });
      });
  }, [range]);

  useEffect(() => {
    if (loading || !user) return;
    const ctrl = new AbortController();
    load(ctrl.signal, false);
    const id = window.setInterval(() => { if (document.visibilityState === "visible") load(ctrl.signal, true); }, 5 * 60_000);
    return () => { ctrl.abort(); window.clearInterval(id); };
  }, [user, loading, load]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="px-4 py-6 sm:px-6 sm:py-10">
        <div className="mx-auto max-w-6xl">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tightest text-foreground sm:text-3xl">HPC dashboard</h1>
              <p className="mt-1 text-sm text-muted-foreground">Clipper nodes and the Beta campaign, from a snapshot every 30 minutes.</p>
            </div>
            <div className="flex gap-1" role="group" aria-label="Time range">
              {RANGES.map((r) => (
                <button key={r.id} type="button" onClick={() => setRange(r.id)} className={cn("btn-sm", range === r.id ? "btn-primary" : "btn-secondary")}>{r.label}</button>
              ))}
            </div>
          </div>

          {loading ? null : !user ? (
            <div className="rounded-lg border border-border p-6">
              <p className="text-sm text-muted-foreground">Sign in with an admin account to see the HPC dashboard.</p>
              <button type="button" className="btn-primary mt-4" onClick={() => openSignIn({ reason: "Sign in to see the HPC dashboard." })}>Sign in</button>
            </div>
          ) : state.kind === "loading" ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : state.kind === "error" ? (
            <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">{state.message}</div>
          ) : !state.latest ? (
            <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">No snapshot has arrived yet. The collector job on Clipper posts the first one within 30 minutes of starting.</div>
          ) : (
            <Dashboard snap={state.latest} points={state.points} now={state.now} range={range} />
          )}
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default HpcOps;

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useAuth } from "@/components/auth/AuthProvider";
import { usePageMeta } from "@/hooks/usePageMeta";
import { cn } from "@/lib/utils";

// Site analytics for admins (GET /api/admin/analytics, functions/_shared/web-analytics.ts). Counts of
// distinct visitors and sessions come from the rows Analytics Engine kept; page views and time are weighted.

type Row = Record<string, string | number>;
interface Reports {
  summary: Row[];
  returning: Row[];
  signedIn: Row[];
  series: Row[];
  pages: Row[];
  landing: Row[];
  referrers: Row[];
  campaigns: Row[];
  countries: Row[];
  devices: Row[];
  browsers: Row[];
}
type State =
  | { kind: "loading" }
  | { kind: "error"; status: number; message: string }
  | { kind: "ok"; reports: Reports; generatedAt: string };

const RANGES = [
  { days: 1, label: "24 hours" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

const n = (v: unknown) => Number(v ?? 0) || 0;
const fmt = (v: number) => Math.round(v).toLocaleString();
function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-foreground tabular-nums">{value}</div>
      {note && <div className="mt-1 text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

function Table({ title, head, rows, empty = "No data yet." }: { title: string; head: string[]; rows: (string | number)[][]; empty?: string }) {
  return (
    <section className="rounded-lg border border-border">
      <h2 className="px-4 pt-3 pb-2 text-sm font-semibold text-foreground">{title}</h2>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-t border-border text-left text-xs text-muted-foreground">
                {head.map((h, i) => (
                  <th key={h} className={cn("px-4 py-2 font-medium", i > 0 && "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-t border-border">
                  {r.map((c, i) => (
                    <td key={i} className={cn("px-4 py-1.5", i === 0 ? "font-mono text-xs text-foreground break-all" : "text-right tabular-nums text-muted-foreground")}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Report({ reports, days }: { reports: Reports; days: number }) {
  const s = reports.summary[0] ?? {};
  const visitors = n(s.visitors);
  const sessions = n(s.sessions);
  const returning = n(reports.returning[0]?.visitors);
  const series = reports.series.map((r) => ({
    t: new Date(String(r.t).replace(" ", "T") + "Z").toLocaleString(undefined, days === 1 ? { hour: "numeric" } : { month: "short", day: "numeric" }),
    visitors: n(r.visitors),
    views: n(r.views),
  }));
  const bySessions = (rows: Row[], blank: string) => rows.map((r) => [String(r.key) || blank, fmt(n(r.sessions)), fmt(n(r.visitors))]);
  const byVisitors = (rows: Row[]) => rows.map((r) => [String(r.key) || "Unknown", fmt(n(r.visitors)), fmt(n(r.views))]);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile label="Visitors" value={fmt(visitors)} />
        <Tile label="Returning visitors" value={fmt(returning)} note={visitors ? `${Math.round((returning / visitors) * 100)}% of visitors` : undefined} />
        <Tile label="Sessions" value={fmt(sessions)} />
        <Tile label="Page views" value={fmt(n(s.views))} note={sessions ? `${(n(s.views) / sessions).toFixed(1)} per session` : undefined} />
        <Tile label="Time per session" value={sessions ? duration(n(s.visible_ms) / sessions) : "–"} note="tab visible" />
        <Tile label="Signed-in visitors" value={fmt(n(reports.signedIn[0]?.visitors))} />
      </div>

      <section className="rounded-lg border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Visitors and page views</h2>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="t" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <Tooltip />
              <Line dataKey="visitors" name="Visitors" stroke="var(--primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="views" name="Page views" stroke="var(--muted-foreground)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <Table
        title="Pages"
        head={["Path", "Views", "Visitors", "Avg time on page", "Avg scroll"]}
        rows={reports.pages.map((r) => [String(r.key), fmt(n(r.views)), fmt(n(r.visitors)), n(r.views) ? duration(n(r.visible_ms) / n(r.views)) : "–", `${Math.round(n(r.scroll))}%`])}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Table title="Where visits come from" head={["Referrer", "Sessions", "Visitors"]} rows={bySessions(reports.referrers, "Direct or unknown")} />
        <Table
          title="Campaigns (utm_source / medium / campaign)"
          head={["Campaign", "Sessions", "Visitors"]}
          rows={reports.campaigns.map((r) => [[r.source, r.medium, r.campaign].map((v) => String(v) || "–").join(" / "), fmt(n(r.sessions)), fmt(n(r.visitors))])}
          empty="No visits with utm_ tags yet."
        />
        <Table title="Landing pages" head={["Path", "Sessions", "Visitors"]} rows={bySessions(reports.landing, "/")} />
        <Table title="Countries" head={["Country", "Visitors", "Views"]} rows={byVisitors(reports.countries)} />
        <Table title="Devices" head={["Device", "Visitors", "Views"]} rows={byVisitors(reports.devices)} />
        <Table title="Browsers" head={["Browser", "Visitors", "Views"]} rows={byVisitors(reports.browsers)} />
      </div>
    </div>
  );
}

const AdminAnalytics = () => {
  usePageMeta({ title: "Site analytics", path: "/admin/analytics", noindex: true });
  const { user, loading, openSignIn } = useAuth();
  const [days, setDays] = useState(7);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (loading || !user) return;
    const ctrl = new AbortController();
    setState({ kind: "loading" });
    fetch(`/api/admin/analytics?days=${days}`, { credentials: "same-origin", signal: ctrl.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (ctrl.signal.aborted) return;
        if (!res.ok) setState({ kind: "error", status: res.status, message: body.message ?? `Request failed (${res.status}).` });
        else setState({ kind: "ok", reports: body.reports as Reports, generatedAt: body.generated_at });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ kind: "error", status: 0, message: "Could not reach the server." });
      });
    return () => ctrl.abort();
  }, [days, user, loading]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="py-10 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
            <div>
              <h1 className="font-display text-3xl font-bold text-foreground tracking-tightest">Site analytics</h1>
              <p className="mt-1 text-sm text-muted-foreground">singlet.bio website visits. API, MCP and download traffic are not included.</p>
            </div>
            <div className="flex gap-1" role="group" aria-label="Time range">
              {RANGES.map((r) => (
                <button key={r.days} type="button" onClick={() => setDays(r.days)} className={cn("btn-sm", days === r.days ? "btn-primary" : "btn-secondary")}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? null : !user ? (
            <div className="rounded-lg border border-border p-6">
              <p className="text-sm text-muted-foreground">Sign in with an admin account to see site analytics.</p>
              <button type="button" className="btn-primary mt-4" onClick={() => openSignIn()}>Sign in</button>
            </div>
          ) : state.kind === "loading" ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : state.kind === "error" ? (
            <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">{state.message}</div>
          ) : (
            <>
              <Report reports={state.reports} days={days} />
              <p className="mt-6 text-xs text-muted-foreground">
                Generated {new Date(state.generatedAt).toLocaleString()}. Kept for 90 days. Visitors are browsers (a random id in local storage); time
                counts only while the tab is visible.
              </p>
            </>
          )}
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default AdminAnalytics;

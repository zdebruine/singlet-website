import type { Projection, ProjectionCampaign, ProjectionWindow } from "@/lib/beta-progress";

// Estimated finish dates of the six sequential campaigns if the current pace holds, measured over three windows of recent progress.
// Dates only, with one progress bar per campaign; groups outside the current corpus scope are labeled and muted.

const WINDOWS: { key: ProjectionWindow; label: string; hours: number }[] = [
  { key: "6h", label: "Last 6 hours", hours: 6 },
  { key: "24h", label: "Last 24 hours", hours: 24 },
  { key: "7d", label: "Last week", hours: 168 },
];

function fmtDate(iso: string, nowYear: number) {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString("en-US", d.getFullYear() === nowYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

function fraction(c: ProjectionCampaign): number | null {
  for (const k of [c.pairs, c.samples]) {
    if (k && k.total && k.total > 0 && k.done != null) return Math.min(1, Math.max(0, k.done / k.total));
  }
  return null;
}

const isDone = (c: ProjectionCampaign) => (c.samples?.total ?? 0) > 0 && c.samples?.remaining === 0;

function Cell({ c, w, nowYear }: { c: ProjectionCampaign; w: (typeof WINDOWS)[number]; nowYear: number }) {
  if (isDone(c)) return <span className="text-muted-foreground">Done</span>;
  const iso = c.eta?.[w.key];
  const date = iso ? fmtDate(iso, nowYear) : null;
  if (!date) return <span className="text-muted-foreground" title="No progress in this window">–</span>;
  const actual = c.window_actual_h?.[w.key];
  const short = actual != null && actual < w.hours * 0.95;
  return (
    <span className="tabular-nums" title={short ? `Based on ${Math.round(actual)} hours of history` : undefined}>
      {date}
      {short && <span className="text-muted-foreground">*</span>}
    </span>
  );
}

export default function ProjectionTable({ projection, nowMs }: { projection: Projection; nowMs: number }) {
  const nowYear = new Date(nowMs).getFullYear();
  const rows = projection.campaigns;
  const anyShort = rows.some((c) => WINDOWS.some((w) => {
    const a = c.window_actual_h?.[w.key];
    return a != null && a < w.hours * 0.95 && c.eta?.[w.key];
  }));
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-[14px]">
          <thead>
            <tr className="border-b border-border text-left text-[12.5px] text-muted-foreground">
              <th scope="col" className="py-2 pr-4 font-normal">Campaign</th>
              {WINDOWS.map((w) => (
                <th key={w.key} scope="col" className="whitespace-nowrap py-2 pl-3 text-right font-normal">Pace of the {w.label.toLowerCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const f = fraction(c);
              return (
                <tr key={c.id} className={`border-b border-border/60 align-top ${c.in_scope ? "" : "text-muted-foreground"}`}>
                  <th scope="row" className="py-2.5 pr-4 text-left font-normal">
                    <span className={c.in_scope ? "text-foreground" : ""}>{c.label}</span>
                    {!c.in_scope && (
                      <span className="ml-2 whitespace-nowrap rounded border border-border px-1.5 py-px text-[11.5px]">Outside current scope</span>
                    )}
                    {f != null && (
                      <div className="mt-1.5 h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-muted" role="img"
                        aria-label={`${Math.round(f * 100)}% done`} title={`${Math.round(f * 100)}% done`}>
                        <div className={`h-full rounded-full ${c.in_scope ? "bg-primary" : "bg-muted-foreground/60"}`} style={{ width: `${Math.max(f * 100, f > 0 ? 2 : 0)}%` }} />
                      </div>
                    )}
                  </th>
                  {WINDOWS.map((w) => (
                    <td key={w.key} className="py-2.5 pl-3 text-right"><Cell c={c} w={w} nowYear={nowYear} /></td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12.5px] text-muted-foreground">
        Estimated finish date of each campaign if processing keeps the pace it held over each window. Campaigns run one after another, so a
        later campaign's date includes the work queued ahead of it. The bar shows the share of each campaign's read pairs already processed.
        {anyShort && " * The campaign has run for less than this window, so the estimate uses the history available."}
      </p>
    </div>
  );
}

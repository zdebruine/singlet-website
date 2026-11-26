import { useEffect, useState, type ReactNode } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { usePageMeta } from "@/hooks/usePageMeta";
import {
  CAMPAIGN_STATUS_PATH, ageLabel, dataAge, parseStatus, pct, plainState, reasonLabel, type CampaignStatus,
} from "@/lib/campaign-status";

// Owner's view of the Beta campaign. Reads the status feed the cluster publishes every 10 minutes
// (hpc/clipper/campaign/status_feed.sbatch). Read-only: pausing is done by the orchestrator on the cluster.

const nf = (n: number | null | undefined) => (n == null ? "unknown" : n.toLocaleString("en-US"));

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-[12.5px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-[12.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Bar({ label, value, max, note, warn }: { label: string; value: number; max: number; note: string; warn?: boolean }) {
  return (
    <div>
      <div className="flex justify-between gap-3 text-[13.5px]">
        <span className="text-foreground">{label}</span>
        <span className="text-right text-muted-foreground tabular-nums">{note}</span>
      </div>
      <div className="mt-1 h-2 rounded bg-muted" role="img" aria-label={`${label}: ${note}`}>
        <div className={`h-2 rounded ${warn ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct(value, max)}%` }} />
      </div>
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="mt-10">
    <h2 className="text-[18px] font-semibold text-foreground">{title}</h2>
    <div className="mt-3">{children}</div>
  </section>
);

const BetaCampaign = () => {
  usePageMeta({ title: "Beta campaign status", description: "Progress of the Research Beta campaign.", path: "/beta/campaign", noindex: true });
  const [s, setS] = useState<CampaignStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch(CAMPAIGN_STATUS_PATH, { cache: "no-store" });
        if (!r.ok) throw new Error(r.status === 404 ? "No status has been published yet." : `The status file answered ${r.status}.`);
        const parsed = parseStatus(await r.json());
        if (!parsed) throw new Error("The status file has an unexpected format.");
        if (live) { setS(parsed); setErr(null); }
      } catch (e) {
        if (live) setErr(e instanceof Error ? e.message : "The status file could not be read.");
      }
      if (live) setNow(Date.now());
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const age = s ? dataAge(s.generated_epoch, now) : null;
  const banner =
    age?.freshness === "fresh" ? "bg-muted text-foreground" : age?.freshness === "late" ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-900";
  const maxDay = Math.max(1, ...(s?.per_day ?? []).map((d) => d.done));

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 container-site py-10 max-w-4xl">
        <h1 className="font-display text-3xl font-bold tracking-tightest text-foreground">Beta campaign</h1>
        {err && !s && <p className="mt-4 text-[15px] text-muted-foreground" role="status">{err}</p>}
        {s && age && (
          <>
            <p className={`mt-3 rounded px-3 py-2 text-[14px] ${banner}`} role="status">
              <strong>{plainState(s.state)}.</strong> Data from {ageLabel(age.seconds)}.
              {age.freshness !== "fresh" && " The feed normally updates every 10 minutes, so the cluster job that publishes it may have stopped."}
              {err && ` The last refresh failed: ${err}`}
            </p>

            <Section title="Samples">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Tile label="Done" value={nf(s.samples.done)} hint="finished and kept" />
                <Tile label="Waiting to run" value={nf(s.samples.queued)} hint="queued or running now" />
                <Tile label="In review" value={nf(s.samples.in_review)} hint="finished but held back from release" />
                <Tile label="Failed" value={nf(s.samples.failed)} hint="gave up after retries" />
              </div>
              <p className="mt-3 text-[14px] text-muted-foreground">
                {nf(s.samples.excluded)} more were set aside with a recorded reason and count as finished.
                {s.eta.date
                  ? ` At the pace of the ${s.eta.basis} (${nf(Math.round(s.eta.samples_per_day))} samples a day), the rest would finish around ${s.eta.date}.`
                  : " No sample has finished recently, so no finish date can be estimated."}
              </p>
              <h3 className="mt-5 text-[14px] font-medium text-foreground">Samples finished per day</h3>
              <div className="mt-2 flex h-28 items-end gap-1" role="img" aria-label="Samples finished per day">
                {s.per_day.map((d) => (
                  <div key={d.date} className="flex-1 bg-primary/80" style={{ height: `${(100 * d.done) / maxDay}%` }} title={`${d.date}: ${d.done}`} />
                ))}
              </div>
              <p className="mt-1 text-[12.5px] text-muted-foreground">Days with finishes, last 30 days. Hover a bar for the date and count.</p>
            </Section>

            {(s.failed.count > 0 || s.review.count > 0 || s.halted_pilots.length > 0) && (
              <Section title="What went wrong">
                <ul className="space-y-2 text-[14px]">
                  {Object.entries(s.failed.reasons).map(([k, v]) => (
                    <li key={`f-${k}`}>
                      <strong>{nf(v.count)} failed:</strong> {reasonLabel(k)}. <span className="text-muted-foreground">Examples: {v.examples.join(", ")}</span>
                    </li>
                  ))}
                  {Object.entries(s.review.reasons).map(([k, n]) => (
                    <li key={`r-${k}`}><strong>{nf(n)} in review:</strong> {reasonLabel(k)}.</li>
                  ))}
                  {s.halted_pilots.map((h, i) => (
                    <li key={`h-${i}`}>
                      <strong>A worker on the {h.lane} lane stopped itself</strong> after repeated failures ({reasonLabel(h.reason)}).
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title="Network">
              <Bar
                label="Download speed, estimated"
                value={s.network.estimated_gbps}
                max={s.network.ceiling_gbps}
                note={`${s.network.estimated_gbps.toFixed(2)} of ${s.network.ceiling_gbps.toFixed(2)} GB/s; target ${Math.round(s.network.target_share * 100)}%`}
              />
              <p className="mt-2 text-[12.5px] text-muted-foreground">
                {s.network.measured_gbps == null && "This is the speed the downloaders are allowed, shared among the live workers. It is not yet a byte count."}
                {s.network.downloads_paused && " Downloads are paused now."}
              </p>
            </Section>

            <Section title="Compute in use">
              {s.lanes ? (
                <div className="space-y-3">
                  {Object.entries(s.lanes).map(([k, l]) => (
                    <Bar
                      key={k}
                      label={l.label}
                      value={l.running}
                      max={l.cap}
                      note={`${l.running} of ${l.cap} ${l.unit} running${l.queued ? `, ${l.queued} waiting` : ""}`}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-[14px] text-muted-foreground">The cluster queue could not be read in the last snapshot.</p>
              )}
            </Section>

            <Section title="Disk and uploads">
              <Bar
                label="Free disk"
                value={s.disk.free_gb ?? 0}
                max={Math.max(s.disk.resume_gb * 1.5, 1)}
                warn={s.disk.free_gb != null && s.disk.guard_on && s.disk.free_gb < s.disk.floor_gb}
                note={`${s.disk.free_gb == null ? "unknown" : `${nf(s.disk.free_gb)} GB`} free; downloads stop below ${nf(s.disk.floor_gb)} GB`}
              />
              <p className="mt-3 text-[14px] text-muted-foreground">
                {nf(s.shipping.shipped)} samples uploaded to Beta so far.{" "}
                {s.shipping.awaiting != null && `${nf(s.shipping.awaiting)} are waiting for upload${s.shipping.growing ? " and the line is growing" : ""}. `}
                Recent upload speed is {s.shipping.upload_mb_s.toFixed(1)} MB/s. Reads downloaded but not yet on a device: {s.backlog.gpairs} G pairs
                (downloads pause at {s.backlog.high_gpairs} G).
              </p>
            </Section>

            <p className="mt-10 text-[12.5px] text-muted-foreground">Read-only. To pause or resume the campaign, ask the orchestrator in chat.</p>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default BetaCampaign;

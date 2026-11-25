import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { usePageMeta } from "@/hooks/usePageMeta";
const ReadyQueue = lazy(() => import("@/components/campaign/ReadyQueue"));
import { BETA_PROGRESS_PATH, groupReasons, parseProgress, share, since, type BetaProgress } from "@/lib/beta-progress";

// Public, live view of the Research Beta campaign. Published counts come straight from Beta's catalog; the processing counts come
// from the cluster's public summary, posted every 15 minutes. The owner's HPC dashboard keeps the cluster detail.

const nf = (n: number | null | undefined) => (n == null ? "–" : n.toLocaleString("en-US"));

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-[12.5px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-1 text-[12.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Meter({ label, beta, alpha }: { label: string; beta: number; alpha: number }) {
  const p = share(beta, alpha);
  return (
    <div>
      <div className="flex justify-between gap-3 text-[14px]">
        <span className="text-foreground">{label}</span>
        <span className="text-right tabular-nums text-muted-foreground">
          {nf(beta)} of {nf(alpha)} ({p < 1 && p > 0 ? p.toFixed(1) : Math.round(p)}%)
        </span>
      </div>
      <div className="mt-1.5 h-2.5 rounded bg-muted" role="img" aria-label={`${label}: ${nf(beta)} of ${nf(alpha)}`}>
        <div className="h-2.5 rounded bg-primary" style={{ width: `${Math.max(p, beta > 0 ? 0.6 : 0)}%` }} />
      </div>
    </div>
  );
}

const Section = ({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) => (
  <section className="mt-10">
    <h2 className="text-[18px] font-semibold text-foreground">{title}</h2>
    {note && <p className="mt-1 text-[14px] text-muted-foreground">{note}</p>}
    <div className="mt-4">{children}</div>
  </section>
);

function PerDay({ rows }: { rows: { date: string; published: number }[] }) {
  const last = rows.slice(-21);
  const max = Math.max(1, ...last.map((r) => r.published));
  return (
    <div className="flex h-24 items-end gap-1" role="img" aria-label="Samples published per day">
      {last.map((r) => (
        <div key={r.date} className="flex-1" title={`${r.date}: ${nf(r.published)} samples`}>
          <div className="rounded-t bg-primary/80" style={{ height: `${Math.max(2, (96 * r.published) / max)}px` }} />
        </div>
      ))}
    </div>
  );
}

const Campaign = () => {
  usePageMeta({
    title: "Research Beta campaign",
    description: "Live progress of the Research Beta reprocessing campaign: samples and studies processed, published, held and excluded.",
    path: "/campaign",
  });
  const [p, setP] = useState<BetaProgress | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch(BETA_PROGRESS_PATH, { cache: "no-store" });
        if (!r.ok) throw new Error(`The progress service answered ${r.status}.`);
        const parsed = parseProgress(await r.json());
        if (!parsed) throw new Error("The progress service returned an unexpected format.");
        if (live) {
          setP(parsed);
          setErr(null);
        }
      } catch (e) {
        if (live) setErr(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const a = setInterval(load, 60_000);
    const b = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      live = false;
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  const pub = p?.published;
  const c = p?.campaign;
  const alpha = p?.alpha;
  const excluded = c ? groupReasons(c.excluded_reasons) : [];
  const held = c ? groupReasons(c.held_reasons) : [];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-4xl px-4 pb-20 pt-24 sm:px-6">
        <p className="text-[13px] font-medium uppercase tracking-wide text-primary">Research Beta</p>
        <h1 className="mt-1 text-3xl font-semibold text-foreground">Campaign progress</h1>
        <p className="mt-3 max-w-2xl text-[15.5px] leading-relaxed text-muted-foreground">
          Beta reprocesses public single-cell RNA-seq from the raw reads with the new GPU engine. Each sample appears on this site
          within about half an hour of finishing, and the counts below update on their own.
        </p>
        {err && <p className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-[14px] text-foreground">{err}</p>}

        <Section title="Served now" note={pub ? `Newest sample published ${since(pub.last_publish, now)}.` : undefined}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Tile label="Studies" value={nf(pub?.studies)} hint={pub?.catalog_pending ? `${nf(pub.catalog_pending)} still being added to search` : undefined} />
            <Tile label="Samples" value={nf(pub?.samples)} />
            <Tile label="Cells called" value={nf(pub?.cells)} />
          </div>
          <p className="mt-3 text-[14px]">
            <Link to="/browse" className="text-primary underline-offset-4 hover:underline">Browse the studies</Link>
            <span className="text-muted-foreground"> · downloads need no account</span>
          </p>
        </Section>

        {alpha && pub && (
          <Section
            title="Progress toward Alpha's coverage"
            note="Beta replaces Alpha once it serves at least what Alpha serves. Alpha stays online, read-only, after the switch."
          >
            <div className="space-y-5">
              <Meter label="Studies" beta={pub.studies} alpha={alpha.studies} />
              <Meter label="Samples" beta={pub.samples} alpha={alpha.samples} />
            </div>
          </Section>
        )}

        <Section
          title="Processing"
          note={c ? `Cluster summary from ${since(c.generated_at, now)}. Engine ${c.engine.join(" and ")}.` : "The cluster summary is not available yet."}
        >
          {c && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tile label="Processed" value={nf(c.samples.processed)} hint="samples finished by the engine" />
                <Tile label="Uploaded to Beta" value={nf(c.samples.published)} hint={`in ${nf(c.studies.published)} studies`} />
                <Tile label="Held privately" value={nf(c.samples.held)} hint="kept off the public site" />
                <Tile label="Excluded" value={nf(c.samples.excluded)} hint="set aside with a recorded reason" />
              </div>
              {(c.samples.failed > 0 || c.samples.in_review > 0 || c.samples.awaiting_publish > 0) && (
                <p className="mt-3 text-[14px] text-muted-foreground">
                  {[
                    c.samples.awaiting_publish > 0 && `${nf(c.samples.awaiting_publish)} waiting to be published`,
                    c.samples.in_review > 0 && `${nf(c.samples.in_review)} in review`,
                    c.samples.failed > 0 && `${nf(c.samples.failed)} failed after retries`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  .
                </p>
              )}
              {c.per_day.length > 1 && (
                <div className="mt-6">
                  <p className="mb-2 text-[13.5px] text-muted-foreground">Samples published per day</p>
                  <PerDay rows={c.per_day} />
                  <div className="mt-1 flex justify-between text-[12px] text-muted-foreground">
                    <span>{c.per_day.slice(-21)[0]?.date}</span>
                    <span>{c.per_day[c.per_day.length - 1]?.date}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </Section>

        {c && Array.isArray(c.ready_history) && c.ready_history.length > 1 && (
          <Section title="Work queued ahead of the H100s">
            <Suspense fallback={<div className="h-[330px]" />}>
              <ReadyQueue points={c.ready_history} nowMs={now} />
            </Suspense>
          </Section>
        )}

        {c && (excluded.length > 0 || held.length > 0) && (
          <Section title="Why samples are set aside">
            <div className="grid gap-6 sm:grid-cols-2">
              {excluded.length > 0 && (
                <div>
                  <h3 className="text-[14.5px] font-medium text-foreground">Excluded</h3>
                  <ul className="mt-2 space-y-1.5 text-[14px]">
                    {excluded.map((r) => (
                      <li key={r.reason} className="flex justify-between gap-4 border-b border-border/60 pb-1.5">
                        <span className="text-foreground">{r.reason}</span>
                        <span className="tabular-nums text-muted-foreground">{nf(r.count)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {held.length > 0 && (
                <div>
                  <h3 className="text-[14.5px] font-medium text-foreground">Held privately</h3>
                  <ul className="mt-2 space-y-1.5 text-[14px]">
                    {held.map((r) => (
                      <li key={r.reason} className="flex justify-between gap-4 border-b border-border/60 pb-1.5">
                        <span className="text-foreground">{r.reason}</span>
                        <span className="tabular-nums text-muted-foreground">{nf(r.count)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    Held samples are processed and stored. They are published once their donors can be told apart.
                  </p>
                </div>
              )}
            </div>
          </Section>
        )}

        <p className="mt-12 text-[13px] text-muted-foreground">
          Counts only. Page updated {since(p?.generated_at, now)}.
        </p>
      </main>
      <Footer />
    </div>
  );
};

export default Campaign;

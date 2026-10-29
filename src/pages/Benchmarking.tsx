import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { FeedbackButton } from "@/components/FeedbackDialog";
import { usePageMeta } from "@/hooks/usePageMeta";
import { ALPHA_BASE, ALPHA_STRENGTHS, CENSUS_PANEL } from "@/lib/alpha-benchmarks";
import { ANNOTATIONS_LIVE } from "@/lib/release";
import { AlphaPendingPanel, AnnotationsPanel, ScbcSection, Stat } from "@/components/benchmarks/AlphaParts";

/**
 * What the Research Alpha files do well, measured on real public data, and a short pointer to their known limits. The full
 * measurements, failing rules included, stay public as the JSON files under /data/benchmarks/alpha and on /known-issues.
 */
const Benchmarking = () => {
  usePageMeta({
    title: "Benchmarking",
    description: "What the Singlet Research Alpha files do well, measured on real public data against the authors' own results.",
    path: "/benchmarking",
  });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 container-site py-12 md:py-16">
        <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tightest text-foreground">Benchmarking</h1>
        <p className="mt-3 max-w-2xl text-[15px] text-muted-foreground">
          What the Research Alpha files you can download today do well. Every number is measured on real public data, against the
          authors' own Cell Ranger results or an independent atlas.
        </p>

        <section id="alpha" className="mt-10 scroll-mt-20" aria-labelledby="alpha-h">
          <h2 id="alpha-h" className="text-[24px] md:text-[28px] font-semibold text-foreground">Cells and genes you can trust</h2>
          <p className="mt-3 max-w-3xl text-[14.5px] text-muted-foreground">
            Compared with the matrices the authors deposited in GEO, on 135 Alpha samples across species, chemistries and sample sizes.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {ALPHA_STRENGTHS.map((s) => <Stat key={s.metric} value={s.shown} label={s.label} detail={s.detail} />)}
          </div>
          <p className="mt-3 text-[12px] text-muted-foreground">
            Measured 2026-10-26. Data:{" "}
            {[...new Set(ALPHA_STRENGTHS.map((s) => s.file))].map((f, i) => (
              <span key={f}>
                {i > 0 && ", "}
                <a href={`${ALPHA_BASE}/${f}.json`} className="font-mono text-primary underline underline-offset-2">{f}.json</a>
              </span>
            ))}
          </p>

          <ScbcSection />

          <div className="mt-10">
            <AlphaPendingPanel id={CENSUS_PANEL.id} name={CENSUS_PANEL.name} what={CENSUS_PANEL.what} files={CENSUS_PANEL.files} omitHeadline={/reads used/i} />
          </div>

          {ANNOTATIONS_LIVE && <AnnotationsPanel />}
        </section>

        <section id="limits" className="mt-12 max-w-3xl rounded-lg border border-border p-5 scroll-mt-20" aria-labelledby="limits-h">
          <h2 id="limits-h" className="text-[17px] font-semibold text-foreground">Known limits</h2>
          <ul className="mt-2 list-disc pl-5 space-y-1 text-[14px] text-muted-foreground">
            <li>Alpha read at most 30M reads of each sample's first run, so cells and UMIs per cell are fewer than the authors report.</li>
            <li>The knee filter misses low-RNA cells; every barcode is in the file, so cells can be called again.</li>
            <li>Cell-type labels below lineage level are previews, and labels on cell lines are unreliable.</li>
          </ul>
          <p className="mt-3 text-[14px]">
            <Link to="/known-issues" className="text-primary underline underline-offset-2">All known issues</Link>
            <span className="text-muted-foreground"> · </span>
            <Link to="/beta" className="text-primary underline underline-offset-2">What the Beta re-run changes</Link>
          </p>
        </section>

        <p className="mt-14 text-[13.5px] text-muted-foreground">
          Something here looks wrong, or you want a benchmark we do not run?{" "}
          <FeedbackButton category="idea" className="text-primary underline underline-offset-2">Send feedback</FeedbackButton>
        </p>
      </main>
      <Footer />
    </div>
  );
};

export default Benchmarking;

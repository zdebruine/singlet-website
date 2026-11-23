import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { FeedbackButton } from "@/components/FeedbackDialog";
import { BetaSignupForm } from "@/components/BetaSignupForm";
import { AlphaBetaTable } from "@/components/landing/AlphaBeta";
import { usePageMeta } from "@/hooks/usePageMeta";
import { ALPHA_SITE, BETA_ENGINE, IS_BETA } from "@/lib/channel";
import { BETA_CHANGES } from "@/components/landing/AlphaBeta";
import { CodeBlock } from "@/components/CodeBlock";

// Sneak peek of Research Beta, from Singlet-Bio/singlet docs/research-beta.md. Every Beta cell is a goal, not a claim
// about today's files. The rows are shared with the home page (ALPHA_TO_BETA).

const BetaSignup = () => {
  usePageMeta({
    title: "What's coming in Beta",
    description: "Singlet Research Beta begins in Q1 2027; the full re-run continues through 2027: every sample re-run with every read, every molecule counted once, modern cell calling, benchmarked multimodal layers and per-request slicing. Join the Beta list.",
    path: "/beta",
  });
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 container-site py-12 md:py-16">
        <div className="max-w-3xl">
          <p className="text-[12.5px] font-medium uppercase tracking-wider text-primary">Beta begins in Q1 2027; the full re-run continues through 2027</p>
          <h1 className="mt-1 font-display text-3xl md:text-4xl font-bold tracking-tightest text-foreground">What's coming in Beta</h1>
          <p className="mt-3 text-[15px] text-muted-foreground">
            A full re-run of every sample with a new, benchmarked engine, in the same per-sample format as Alpha, at{" "}
            <span className="font-mono text-foreground">beta.singlet.bio</span>. What you tell us decides what comes first.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a href="#join" className="btn-primary btn-sm">Join the Beta</a>
            <FeedbackButton category="idea" className="btn-secondary btn-sm">Tell us what you need</FeedbackButton>
          </div>
        </div>

        <AlphaBetaTable className="mt-10 max-w-4xl" />

        <p className="mt-4 max-w-4xl text-[13.5px] text-muted-foreground">
          Genotypes are never released. The GPU port of the aligner:{" "}
          <Link to="/beta/gpu-engine" className="text-primary underline underline-offset-2">GPU engine</Link>. What is wrong
          today: <Link to="/known-issues" className="text-primary underline underline-offset-2">Known issues</Link>.
        </p>

        <section id="join" className="mt-14 scroll-mt-20 grid gap-8 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]" aria-labelledby="join-h">
          <div>
            <h2 id="join-h" className="text-[24px] md:text-[28px] font-semibold text-foreground">Join the Beta</h2>
            <p className="mt-3 text-[15px] text-muted-foreground">
              We will email you when Beta opens. Tell us what you work on and it shapes what comes first.
            </p>
          </div>
          <BetaSignupForm />
        </section>
      </main>
      <Footer />
    </div>
  );
};

/** The Beta site's version of /beta: what this release is and how to read it. No sign-up; the campaign is already running. */
const BetaRelease = () => {
  usePageMeta({
    title: "About this release",
    description: "Research Beta reprocesses public single-cell RNA-seq again from every read in SRA with the GPU engine, and publishes each sample as it finishes.",
    path: "/beta",
  });
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 container-site py-12 md:py-16">
        <div className="max-w-3xl">
          <p className="text-[12.5px] font-medium uppercase tracking-wider text-primary">Research Beta · campaign started 2026-11-20</p>
          <h1 className="mt-1 font-display text-3xl md:text-4xl font-bold tracking-tightest text-foreground">About this release</h1>
          <p className="mt-3 text-[15px] text-muted-foreground">
            Research Beta reprocesses public single-cell RNA-seq from the raw reads in SRA, using every read of every run. It runs the new
            GPU engine ({BETA_ENGINE}), which does the alignment and counting on the GPUs of Clipper at GVSU. Each sample is published
            here as soon as it finishes, so coverage grows every day.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link to="/campaign" className="btn-primary btn-sm">Campaign progress</Link>
            <FeedbackButton category="idea" className="btn-secondary btn-sm">Send feedback</FeedbackButton>
          </div>
        </div>

        <section className="mt-10 max-w-4xl" aria-labelledby="changes-h">
          <h2 id="changes-h" className="text-[22px] font-semibold text-foreground">What is different from Alpha</h2>
          <AlphaBetaTable rows={BETA_CHANGES} className="mt-4" />
          <p className="mt-4 text-[13.5px] text-muted-foreground">
            Genotypes, mitochondrial alleles, and ambient-RNA and doublet scores stay out of the public files until their release gates
            pass. Multiplexed samples whose donors cannot be separated are held privately. The engine is described on the{" "}
            <Link to="/beta/gpu-engine" className="text-primary underline underline-offset-2">GPU engine</Link> page.
          </p>
        </section>

        <section className="mt-12 max-w-3xl" aria-labelledby="use-h">
          <h2 id="use-h" className="text-[22px] font-semibold text-foreground">Read Beta data</h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-foreground">
            The file format is the one Alpha uses: one immutable <span className="font-mono">.s1</span> object per sample and a study
            manifest at <span className="font-mono">https://beta-data.singlet.bio/s1/m/&lt;GSE&gt;.json</span>. The Python and R packages are
            the same. Point them at Beta with one variable.
          </p>
          <div className="mt-3">
            <CodeBlock code={"pip install singlet" + String.fromCharCode(10) + "export SINGLET_DATA_BASE=https://beta-data.singlet.bio"} label="bash" />
          </div>
          <p className="mt-3 text-[14.5px] leading-relaxed text-foreground">
            Data is CC0 and code is MIT. Downloads never need an account. Tool calls to the MCP server and API need a free account, with
            keys on the <Link to="/account" className="text-primary underline underline-offset-2">account page</Link>.
          </p>
        </section>

        <section className="mt-12 max-w-3xl" aria-labelledby="next-h">
          <h2 id="next-h" className="text-[22px] font-semibold text-foreground">What happens to Alpha</h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-foreground">
            When Beta covers what Alpha covers, Beta moves to singlet.bio and Alpha stays online as a read-only archive. Until then Alpha
            keeps serving at <a href={ALPHA_SITE} className="text-primary underline underline-offset-2">{ALPHA_SITE.replace("https://", "")}</a>.
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
};

const Beta = () => (IS_BETA ? <BetaRelease /> : <BetaSignup />);

export default Beta;

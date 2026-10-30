import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { FeedbackButton } from "@/components/FeedbackDialog";
import { BetaSignupForm } from "@/components/BetaSignupForm";
import { AlphaBetaTable } from "@/components/landing/AlphaBeta";
import { usePageMeta } from "@/hooks/usePageMeta";

// Sneak peek of Research Beta, from Singlet-Bio/singlet docs/research-beta.md. Every Beta cell is a goal, not a claim
// about today's files. The rows are shared with the home page (ALPHA_TO_BETA).

const Beta = () => {
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

export default Beta;

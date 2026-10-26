import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { FeedbackButton } from "@/components/FeedbackDialog";
import { BetaSignupForm } from "@/components/BetaSignupForm";
import { usePageMeta } from "@/hooks/usePageMeta";

// Sneak peek of Research Beta, from Singlet-Bio/singlet docs/research-beta.md. Every item is a Beta goal, not a claim
// about today's files. Measured progress lives on /benchmarking#beta.

interface Item {
  title: string;
  body: ReactNode;
  today: string;
}

const ITEMS: Item[] = [
  {
    title: "Every read of every run",
    body: "Each sample is aligned from all of its reads, across all of its sequencing runs. Strand and chemistry are tested on every sample before counting.",
    today: "Alpha used the first run and at most 30M reads per sample.",
  },
  {
    title: "Every molecule counted once",
    body: "Each molecule is assigned once, as spliced, unspliced or ambiguous, so the layers can be used for RNA velocity.",
    today: "Alpha can count some molecules twice.",
  },
  {
    title: "Modern droplet calling",
    body: "Cells are separated from empty droplets with a modern caller that keeps low-RNA cells, benchmarked against independent truth. Every barcode is still stored.",
    today: "Alpha used a conservative knee filter.",
  },
  {
    title: "Multimodal layers, each with a public benchmark",
    body: "Antibody tags, hashtags, chromatin accessibility, spatial coordinates, CRISPR guides and immune receptor clonotypes are added one by one. Each ships with a public benchmark against the standard tools.",
    today: "Alpha is transcriptomics only.",
  },
  {
    title: "Derived information without genotypes",
    body: "Genotypes are never released. Where donor-level information is useful, a controlled-access, privacy-preserving path releases derived values instead: Hamming-distance or similarity matrices, lineage trees, and mtDNA heteroplasmy relative to each donor.",
    today: "Alpha releases no genotype or mtDNA variant data.",
  },
  {
    title: "Download only what you ask for",
    body: "Per-request slicing: pick the samples, cells and layers you need (counts, spliced/unspliced, or USA mode) and download just those bytes.",
    today: "Alpha serves whole samples and cell ranges.",
  },
  {
    title: "More samples, more species, curated metadata",
    body: "More studies and samples, more species, and metadata curated to standard ontologies for tissue, disease, cell type and development stage.",
    today: "Some Alpha metadata is uncurated.",
  },
];

const Beta = () => {
  usePageMeta({
    title: "What's coming in Beta",
    description: "Singlet Research Beta, estimated Q1 2027: a full re-run with every read, every molecule counted once, modern cell calling, benchmarked multimodal layers and per-request slicing. Join the Beta list.",
    path: "/beta",
  });
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 container-site py-12 md:py-16">
        <div className="max-w-3xl">
          <p className="text-[12.5px] font-medium uppercase tracking-wider text-primary">Estimated Q1 2027</p>
          <h1 className="mt-1 font-display text-3xl md:text-4xl font-bold tracking-tightest text-foreground">What's coming in Beta</h1>
          <p className="mt-3 text-[15px] text-muted-foreground">
            Beta is a full re-run of every sample, on all of its reads, with a new, benchmarked engine. It uses the same per-sample
            format as Alpha and is released at{" "}
            <span className="font-mono text-foreground">beta.singlet.bio</span>. Alpha, the site you are on, is a research preview
            that is here to collect feedback. What you tell us shapes Beta.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a href="#join" className="btn-primary btn-sm">Join the Beta</a>
            <FeedbackButton category="idea" className="btn-secondary btn-sm">Tell us what you need</FeedbackButton>
          </div>
        </div>

        <ol className="mt-10 grid gap-4 md:grid-cols-2">
          {ITEMS.map((it) => (
            <li key={it.title} className="surface p-5">
              <h2 className="text-[17px] leading-snug font-semibold text-foreground">{it.title}</h2>
              <p className="mt-2 text-[14.5px] leading-relaxed text-foreground">{it.body}</p>
              <p className="mt-3 text-[12.5px] text-muted-foreground">Today: {it.today}</p>
            </li>
          ))}
        </ol>

        <p className="mt-6 max-w-3xl text-[14px] text-muted-foreground">
          These are Beta goals. The engine is being measured against the standard tools now, and results are published as they come
          in, including where it does not yet match them:{" "}
          <Link to="/benchmarking#beta" className="text-primary underline underline-offset-2">Beta benchmarks</Link>. What is wrong in
          Alpha today is on <Link to="/known-issues" className="text-primary underline underline-offset-2">Known issues</Link>.
        </p>

        <section id="join" className="mt-14 scroll-mt-20 grid gap-8 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]" aria-labelledby="join-h">
          <div>
            <h2 id="join-h" className="text-[24px] md:text-[28px] font-semibold text-foreground">Join the Beta</h2>
            <p className="mt-3 text-[15px] text-muted-foreground">
              Leave your email and we will tell you when Beta opens. Tell us what you work on and we will use it to decide what comes
              first.
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

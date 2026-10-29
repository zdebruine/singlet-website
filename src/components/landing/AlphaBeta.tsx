import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { FeedbackButton } from "@/components/FeedbackDialog";
import { cn } from "@/lib/utils";

// What Alpha does today and what Beta changes, one short row per topic. The home page, /beta and /known-issues all
// read ALPHA_TO_BETA, so the story is told once. Plan: docs/LANDING.md and Singlet-Bio/singlet-agents
// docs/RESEARCH_ALPHA_PLAN.md ("Alpha vision"). Every Beta cell is a goal, not a claim about today's files.

export interface AlphaToBeta {
  /** Anchor on /known-issues that explains the Alpha side. */
  id: string;
  topic: string;
  alpha: string;
  beta: string;
}

export const ALPHA_TO_BETA: AlphaToBeta[] = [
  { id: "reads", topic: "Reads", alpha: "First run only, at most 30M reads", beta: "Every read of every run" },
  { id: "counting", topic: "Counting", alpha: "Some molecules counted twice", beta: "Each molecule once: spliced, unspliced or ambiguous" },
  { id: "cell-calling", topic: "Cell calling", alpha: "Conservative knee filter", beta: "Modern droplet calling that keeps low-RNA cells" },
  { id: "annotations", topic: "Labels", alpha: "Cell type, sex and ancestry, accuracy measured", beta: "Trained classifier with calibrated probabilities" },
  { id: "modalities", topic: "Modalities", alpha: "Transcriptomics only", beta: "ADT, HTO, ATAC, spatial, CRISPR, V(D)J, each benchmarked" },
  { id: "genetics", topic: "Genetics", alpha: "No genotype or mtDNA data", beta: "Derived values only, never genotypes (being designed)" },
  { id: "downloads", topic: "Downloads", alpha: "Whole samples or cell ranges", beta: "Only the layers you ask for" },
  { id: "coverage", topic: "Coverage", alpha: "Species taken from GEO metadata", beta: "Strand, chemistry and species tested from the reads" },
  { id: "metadata", topic: "Metadata", alpha: "Some GEO labels uncurated", beta: "Curated to standard ontologies" },
];

/** Topic, Alpha today, Beta. Rows with a Known issues entry link to it. */
export function AlphaBetaTable({ rows = ALPHA_TO_BETA, className }: { rows?: AlphaToBeta[]; className?: string }) {
  return (
    <div className={cn("surface overflow-hidden", className)}>
      <div className="hidden sm:grid grid-cols-[120px_1fr_20px_1fr] gap-x-4 px-5 py-2.5 border-b border-border text-[11.5px] font-semibold uppercase tracking-wider">
        <span className="text-muted-foreground" />
        <span className="text-foreground">Alpha today</span>
        <span aria-hidden="true" />
        <span className="text-primary">Beta goal</span>
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.id} className="grid grid-cols-[1fr] sm:grid-cols-[120px_1fr_20px_1fr] items-baseline gap-x-4 gap-y-0.5 px-5 py-3 border-b border-border/60 last:border-b-0 text-[14px]">
            <span className="text-[12.5px] font-medium uppercase tracking-wider text-muted-foreground">{r.topic}</span>
            <span className="text-foreground">
              <span className="sm:hidden text-muted-foreground">Alpha: </span>
              {r.alpha}
            </span>
            <ArrowRight size={14} className="hidden sm:block self-center text-primary" aria-hidden="true" />
            <span className="text-muted-foreground">
              <span className="sm:hidden text-primary">Beta: </span>
              {r.beta}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const A = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="text-primary underline underline-offset-2">
    {children}
  </Link>
);

/** Measured on pilot and test sets (Singlet-Bio/singlet docs/s1-performance.md), not atlas-wide. */
export const SPEED_MEASURED = [
  { value: "4.0×", label: "smaller than the previous files", detail: "58 samples from 45 studies" },
  { value: "89×", label: "fewer bytes to fetch one sample", detail: "2.1 MB instead of the whole 187 MB study" },
  { value: "4.3 s", label: "to load a 14-sample study into Python", detail: "over the internet, cold cache; about 6× faster than before" },
];

/** The .s1 format's pilot numbers. */
export function SpeedMeasured() {
  return (
    <div className="max-w-[960px] mx-auto mt-6">
      <ul className="grid gap-3 sm:grid-cols-3">
        {SPEED_MEASURED.map((m) => (
          <li key={m.label} className="surface p-4 text-left">
            <p className="text-[24px] leading-none font-semibold tabular text-foreground">{m.value}</p>
            <p className="mt-2 text-[13px] text-foreground">{m.label}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">{m.detail}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-center text-[12.5px] text-muted-foreground">
        Measured on pilot and test sets, not yet atlas-wide.{" "}
        <a href="https://github.com/Singlet-Bio/singlet/blob/main/docs/s1-performance.md" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
          How it was measured
        </a>
      </p>
    </div>
  );
}

/**
 * How much you fetch at each zoom level, from a real study (GSE138867 on data.singlet.bio): its manifest, one of its
 * eight sample objects (7.9–10.4 MB), and the chunks that hold just the cells a cell filter selects.
 */
const ZOOM = [
  { size: "70 KB", what: "Study manifest", how: "Lists every sample and the byte range of each part", w: "100%" },
  { size: "≈9 MB", what: "One sample", how: "One HTTP range read; no need to download the study", w: "72%" },
  { size: "a few chunks", what: "Just your cells", how: "The cell index points at the chunks that hold them", w: "44%" },
];

/** Study → sample → cells: what a request fetches at each level. */
export function ZoomStrip() {
  return (
    <ol className="max-w-[760px] mx-auto space-y-2">
      {ZOOM.map((z, i) => (
        <li key={z.what}>
          <div className="flex justify-center">
            <div
              className={cn("rounded-[6px] px-4 py-3 flex items-baseline justify-between gap-4 min-w-[260px] max-w-full", i === ZOOM.length - 1 ? "bg-primary text-primary-foreground" : "bg-[var(--teal-100)] text-foreground")}
              style={{ width: z.w }}
            >
              <span className="min-w-0">
                <span className="block text-[14.5px] font-semibold">{z.what}</span>
                <span className={cn("block text-[12.5px]", i === ZOOM.length - 1 ? "text-primary-foreground/85" : "text-muted-foreground")}>{z.how}</span>
              </span>
              <span className="shrink-0 font-mono text-[13px] tabular">{z.size}</span>
            </div>
          </div>
        </li>
      ))}
      <li className="pt-1 text-center text-[12.5px] text-muted-foreground">
        Sizes from <A to="/study/GSE138867">GSE138867</A>, 8 samples, 47K cells.
      </li>
    </ol>
  );
}

export function RigorFooter() {
  return (
    <>
      <A to="/benchmarking">Benchmarks</A>
      <span className="mx-2" aria-hidden="true">·</span>
      <A to="/known-issues">Known issues</A>
      <span className="mx-2" aria-hidden="true">·</span>
      <A to="/beta">What's coming in Beta</A>
    </>
  );
}

/** The two calls to action: feedback and the Beta list. */
export function AlphaCtas({ className }: { className?: string }) {
  return (
    <div className={className ?? "flex flex-wrap items-center justify-center gap-3"}>
      <Link to="/beta#join" className="btn-primary">
        Join the Beta
      </Link>
      <FeedbackButton category="idea" className="btn-secondary">
        Send feedback
      </FeedbackButton>
    </div>
  );
}

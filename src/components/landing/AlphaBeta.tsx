import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { FeedbackButton } from "@/components/FeedbackDialog";

// Home-page stories, each split into what Alpha does today and what Beta adds. Plan: docs/LANDING.md and
// Singlet-Bio/singlet-agents docs/RESEARCH_ALPHA_PLAN.md ("Alpha vision"). Alpha and Beta share the store format (per-sample
// objects, pz2); its numbers are labelled as measured on pilot and test sets until atlas-wide numbers exist.

function Column({ label, tone, items }: { label: string; tone: "alpha" | "beta"; items: ReactNode[] }) {
  return (
    <div className={tone === "alpha" ? "surface p-5" : "rounded border border-dashed border-border p-5"}>
      <p className={`text-[11.5px] font-semibold uppercase tracking-wider ${tone === "alpha" ? "text-foreground" : "text-primary"}`}>{label}</p>
      <ul className="mt-3 space-y-2.5 text-[14.5px] leading-relaxed">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2.5">
            <span className={`mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full ${tone === "alpha" ? "bg-foreground/60" : "bg-primary"}`} aria-hidden="true" />
            <span className={tone === "alpha" ? "text-foreground" : "text-muted-foreground"}>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Two columns: "In Alpha today" and "Coming in Beta". */
export function TodayVsBeta({ today, beta, footer }: { today: ReactNode[]; beta: ReactNode[]; footer?: ReactNode }) {
  return (
    <div className="max-w-[960px] mx-auto">
      <div className="grid gap-4 md:grid-cols-2">
        <Column label="In Alpha today" tone="alpha" items={today} />
        <Column label="Coming in Beta" tone="beta" items={beta} />
      </div>
      {footer && <div className="mt-6 text-center text-[14px] text-muted-foreground">{footer}</div>}
    </div>
  );
}

const A = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="text-primary underline underline-offset-2">
    {children}
  </Link>
);
const Mono = ({ children }: { children: ReactNode }) => <code className="code-inline">{children}</code>;

export const SPEED = {
  today: [
    <>One immutable object per sample, listed in a small manifest per study, so you fetch a single sample with an HTTP range read, not a whole study.</>,
    <>Count matrices use the <Mono>pz2</Mono> codec; gene names live in shared packs instead of being repeated in every file.</>,
    <>A cell index, so you can fetch just the cells you ask for.</>,
    <>Search, the catalog API and downloads run at the Cloudflare edge: Pages Functions, Workers, D1 and R2.</>,
  ],
  beta: [
    <>The same format for the full re-run, so code written against Alpha keeps working.</>,
    <>Size and load-time numbers measured across the whole atlas, published on the benchmarks page.</>,
    <>Download only the layers you ask for.</>,
  ],
};

/** Measured on pilot and test sets (Singlet-Bio/singlet docs/v2-performance.md), not atlas-wide. */
export const SPEED_MEASURED = [
  { value: "4.0×", label: "smaller than the previous files", detail: "58 samples from 45 studies" },
  { value: "258–299M", label: "non-zeros decoded per second, per thread", detail: "with AVX-512" },
  { value: "0.36 s", label: "to load one sample into Python over HTTP", detail: "including the download" },
];

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
        <a href="https://github.com/Singlet-Bio/singlet/blob/main/docs/v2-performance.md" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
          How it was measured
        </a>
      </p>
    </div>
  );
}

export const ACCESS = {
  today: [
    <>Plain-English search. A built-in vocabulary reads most questions; a language model is used only for words it cannot place.</>,
    <>A <A to="/docs/mcp">Claude connector</A> (MCP server) that searches, assesses and fetches studies for you.</>,
    <>CC0 data. Downloads need no account and no key.</>,
    <>Python and R loaders: <Mono>singlet.load("GSE…")</Mono>.</>,
  ],
  beta: [
    <>Download only the layers you ask for: counts, spliced/unspliced, or USA mode.</>,
    <>Search on curated ontology terms for tissue, disease and cell type.</>,
    <>The same tools over more samples and more species.</>,
  ],
};

export const RIGOR = {
  today: [
    <>Quality control on every sample; samples below the cut-off are left out of counts and search by default.</>,
    <>Every barcode with at least 100 reads is stored, so you can call cells again.</>,
    <>Alpha is benchmarked against an independent pipeline and the authors' own results, and shown as measured.</>,
    <>Every issue we know about is listed, with what Beta changes.</>,
  ],
  beta: [
    <>Every read of every run, with strand and chemistry tested per sample.</>,
    <>Every molecule counted once: spliced, unspliced or ambiguous.</>,
    <>Modern droplet calling.</>,
    <>A public benchmark for every capability against the standard tools, with code and a notebook.</>,
  ],
};

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

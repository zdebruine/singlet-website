import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { usePageMeta } from "@/hooks/usePageMeta";

// The Beta GPU engine (workstream W11), from Singlet-Bio/singlet docs/gpu-engine/exploration.md §12 and the M5 runs on
// Clipper (jobs 789609, 789646, 789658). Every number here is measured on real reads unless the row says "model".
// Update the rows as stages land; never state a speed or equivalence that was not measured.

const REPO = "https://github.com/Singlet-Bio/singlet";
const PR = `${REPO}/pull/61`;
const DESIGN = `${REPO}/blob/gpu/w11-prototypes/docs/gpu-engine/exploration.md`;

type State = "exact" | "slow" | "open";

interface Stage {
  stage: string;
  check: string;
  speed: string;
  state: State;
}

const STAGES: Stage[] = [
  {
    stage: "Seed search (STAR's suffix-array search)",
    check: "323,688,051 of 323,688,051 seed records identical to STAR, on 3 samples (human sparse index, mouse dense index)",
    speed: "about 1.0 G seed records/s on one H100",
    state: "exact",
  },
  {
    stage: "Windows, stitching, extension and multimapper selection",
    check: "1,991,926 of 1,991,926 distinct reads (4,118,999 reads) identical to STAR, mapped and unmapped, on PBMC 1k v3",
    speed: "0.6–0.7 M distinct reads/s per GPU today; target ≥ 10 M",
    state: "slow",
  },
  {
    stage: "Duplicate collapse, count sort, UMI collapse",
    check: "Count matrices identical to the CPU engine, and identical across batch sizes and reruns",
    speed: "1.6–2.0 G read pairs/s",
    state: "exact",
  },
  {
    stage: "Read ingest (host to GPU)",
    check: "Lossless decode of the engine's read format",
    speed: "12–15 M read pairs/s per CPU thread; 12.3 GB/s over PCIe",
    state: "exact",
  },
  {
    stage: "Whole sample, end to end",
    check: "Stages are not yet linked into one run",
    speed: "model: 27–36 M read pairs/s per 2-GPU node, bound by the CPU-side callers",
    state: "open",
  },
];

const STATE_LABEL: Record<State, { text: string; cls: string }> = {
  exact: { text: "Identical", cls: "bg-primary/10 text-primary" },
  slow: { text: "Identical, below speed target", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  open: { text: "Not yet run", cls: "bg-muted text-muted-foreground" },
};

const BetaGpuEngine = () => {
  usePageMeta({
    title: "Beta GPU engine",
    description: "A GPU port of STAR's alignment for Singlet Research Beta, built to give the same output as STAR read for read. Measured status of each stage on NVIDIA H100.",
    path: "/beta/gpu-engine",
  });
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 container-site py-12 md:py-16">
        <div className="max-w-3xl">
          <p className="text-[12.5px] font-medium uppercase tracking-wider text-primary">
            <Link to="/beta" className="hover:underline">Beta</Link> · in development
          </p>
          <h1 className="mt-1 font-display text-3xl md:text-4xl font-bold tracking-tightest text-foreground">GPU engine</h1>
          <p className="mt-3 text-[15px] text-muted-foreground">
            Beta re-aligns about 70,000 samples from all of their reads, about 21.7 trillion read pairs. On CPUs that is 250–330
            thousand core-hours. The GPU engine is a port of STAR's alignment to NVIDIA H100 GPUs, written to give the same
            alignments as STAR, read for read, so that Beta's counts do not depend on which engine produced them.
          </p>
        </div>

        <section className="mt-10 max-w-3xl" aria-labelledby="design-h">
          <h2 id="design-h" className="text-[22px] font-semibold text-foreground">How it works</h2>
          <ul className="mt-3 space-y-2 text-[14.5px] leading-relaxed text-foreground">
            <li><span className="font-medium">Each distinct read once.</span> About half the reads in a sample repeat an earlier sequence; each sequence is aligned once and its result reused.</li>
            <li><span className="font-medium">STAR's search, on the GPU.</span> The same suffix array, seed rules, scoring, splice-junction database and multimapper rules as STAR 2.7.11b.</li>
            <li><span className="font-medium">No BAM.</span> Alignments go straight to GPU sort-and-reduce steps that produce gene, spliced/unspliced and junction counts with UMI collapse.</li>
            <li><span className="font-medium">CPU for the rest.</span> Cell calling, demultiplexing and export stay on the node's CPU cores, unchanged.</li>
          </ul>
        </section>

        <section className="mt-10" aria-labelledby="status-h">
          <h2 id="status-h" className="text-[22px] font-semibold text-foreground">Measured status</h2>
          <p className="mt-2 max-w-3xl text-[14px] text-muted-foreground">
            Measured on real reads on NVIDIA H100 NVL GPUs (GVSU Clipper), against STAR's own internal state dumped for the same
            reads. "Identical" means every record matched, with no tolerance.
          </p>
          <div className="mt-4 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-4 py-3 font-medium text-foreground">Stage</th>
                  <th className="px-4 py-3 font-medium text-foreground">Equivalence check</th>
                  <th className="px-4 py-3 font-medium text-foreground">Speed</th>
                  <th className="px-4 py-3 font-medium text-foreground">State</th>
                </tr>
              </thead>
              <tbody>
                {STAGES.map((s) => (
                  <tr key={s.stage} className="border-b border-border/50 align-top">
                    <td className="px-4 py-2.5 font-medium text-foreground">{s.stage}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{s.check}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{s.speed}</td>
                    <td className="px-4 py-2.5">
                      <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${STATE_LABEL[s.state].cls}`}>
                        {STATE_LABEL[s.state].text}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-10 max-w-3xl" aria-labelledby="next-h">
          <h2 id="next-h" className="text-[22px] font-semibold text-foreground">What is left</h2>
          <ul className="mt-3 space-y-2 text-[14.5px] leading-relaxed text-foreground">
            <li>Make the stitching stage about 15× faster while keeping it identical. Most of its time is spent building alignment windows.</li>
            <li>Link the stages into one run and check whole samples against the CPU engine, on 3′, 5′ and single-nucleus libraries.</li>
            <li>Pass the same equivalence and <Link to="/benchmarking#beta" className="text-primary underline underline-offset-2">Beta benchmarks</Link> as the CPU engine. Until it does, Beta runs on the CPU engine.</li>
          </ul>
        </section>

        <section className="mt-10 max-w-3xl" aria-labelledby="code-h">
          <h2 id="code-h" className="text-[22px] font-semibold text-foreground">Code</h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-foreground">
            Open source under the MIT License, in the <span className="font-mono">singlet</span> repository.
          </p>
          <ul className="mt-3 space-y-1.5 text-[14px]">
            <li>
              <a href={PR} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                Singlet-Bio/singlet#61 <ExternalLink size={11} className="inline" />
              </a>{" "}
              <span className="text-muted-foreground">: the GPU prototypes and the STAR state-dump tool used as ground truth</span>
            </li>
            <li>
              <a href={DESIGN} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                docs/gpu-engine/exploration.md <ExternalLink size={11} className="inline" />
              </a>{" "}
              <span className="text-muted-foreground">: design, throughput model and every measurement (§12)</span>
            </li>
          </ul>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default BetaGpuEngine;

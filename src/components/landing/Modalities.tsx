import { Link } from "react-router-dom";
import { GitBranch, Scissors, Shield, Dna } from "lucide-react";
import type { ReactNode } from "react";

/** A true modality: a distinct measurement stored in the file, not a score derived from another one. */
interface Modality {
  icon: ReactNode;
  name: string;
  /** Under 20 words: what we did. */
  what: string;
  /** Shown as a small tag where only some files carry it. */
  note?: string;
}

const ICON = { size: 26, strokeWidth: 1.5, "aria-hidden": true } as const;

export const MODALITIES: Modality[] = [
  {
    icon: <Scissors {...ICON} />,
    name: "Spliced and unspliced counts",
    what: "Exonic and intronic reads counted separately for every cell, ready for RNA velocity.",
  },
  {
    icon: <GitBranch {...ICON} />,
    name: "Splice junctions",
    what: "Reads crossing each exon-exon junction, per cell, with how often each exon is included.",
  },
  {
    icon: <Dna {...ICON} />,
    name: "Mitochondrial variants",
    what: "Per-cell allele counts at mitochondrial DNA positions, for heteroplasmy and lineage tracing.",
    note: "select studies",
  },
  {
    icon: <Shield {...ICON} />,
    name: "V(D)J segments",
    what: "Per-cell counts of immune receptor V, D and J gene segments, informative in T and B cells.",
    note: "immune cells",
  },
];

/** The modalities, then a line about everything else we compute from the transcriptome. */
export function ModalityGrid() {
  return (
    <div>
      <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-8 max-w-[1040px] mx-auto">
        {MODALITIES.map((m) => (
          <li key={m.name} className="flex gap-4">
            <span className="mt-0.5 shrink-0 grid place-items-center h-12 w-12 rounded-xl bg-[var(--teal-50)] text-primary">{m.icon}</span>
            <div className="min-w-0">
              <h3 className="text-[16px] font-semibold leading-snug">
                {m.name}
                {m.note && <span className="ml-2 align-middle rounded border border-border px-1.5 py-0.5 text-[10.5px] font-normal uppercase tracking-wider text-muted-foreground">{m.note}</span>}
              </h3>
              <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">{m.what}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-12 text-center text-[14.5px] text-muted-foreground max-w-[640px] mx-auto">
        We also compute doublet scores, cell-cycle phase, ambient RNA and sample-level calls from the transcriptome. All of it is free to download.{" "}
        <Link to="/docs#modalities" className="text-primary hover:underline">
          Every modality in the docs →
        </Link>
      </p>
    </div>
  );
}

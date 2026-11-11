import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtInt } from "@/lib/catalog-display";
import {
  CONFOUND_TEXT,
  GRADE_TEXT,
  type DesignContrastView,
  type DesignLevelView,
  type StudyDesignView,
} from "../../../functions/_shared/design-view";
import type { ConditionFilter } from "./ConditionsPanel";

const TYPE_LABEL: Record<string, string> = {
  disease: "Disease",
  tumor_normal: "Tumor vs normal",
  treatment: "Treatment",
  genetic: "Genetic",
  time: "Time",
  age: "Age",
  sex: "Sex",
  response: "Response",
  severity_stage: "Severity or stage",
  tissue_site: "Tissue or site",
  cell_fraction: "Sorted fraction",
  prep_tech: "Preparation",
  infection: "Infection",
  differentiation_stage: "Differentiation",
  other: "Other",
};
const typeLabel = (t: string) => TYPE_LABEL[t] ?? t.replace(/_/g, " ");

const GRADE_CLASS: Record<string, string> = {
  A: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400",
  B: "border-sky-500/50 text-sky-700 dark:text-sky-400",
  C: "border-amber-500/50 text-amber-700 dark:text-amber-400",
  D: "border-border text-muted-foreground",
};

interface Props {
  design: StudyDesignView;
  /** GSMs whose counts are in the published file (the page's approved samples). */
  inFile: Set<string>;
  active: ConditionFilter | null;
  onToggle: (f: ConditionFilter) => void;
  onShowRaw: () => void;
}

/**
 * The curated study design: factors with normalized levels, the comparisons they support with grade and confounds, and the curation notes.
 * Clicking a level filters the samples table to that level's samples. Replaces the GEO-characteristics table when a design exists; the raw
 * table stays one click away ("Show as deposited").
 */
export function DesignPanel({ design, inFile, active, onToggle, onShowRaw }: Props) {
  const [showWeaker, setShowWeaker] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const notes = design.conflicts.length + design.abstentions.length;

  return (
    <div className="space-y-3">
      <div className="surface px-4 py-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 text-[10.5px] uppercase tracking-wider",
              design.tier === "confirmed" ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-400" : "border-amber-500/50 text-amber-700 dark:text-amber-400"
            )}
          >
            {design.tier}
          </span>
          <span className="text-muted-foreground">{design.tier_text}</span>
        </div>
        {design.summary && <p className="mt-2 text-foreground">{design.summary}</p>}
      </div>

      {design.factors.length > 0 && (
        <div className="surface overflow-hidden" role="table" aria-label="Design factors">
          <div role="row" className="hidden sm:grid grid-cols-[30%_1fr] gap-3 border-b border-border px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <span role="columnheader">Factor</span>
            <span role="columnheader">Levels (samples in file / in study)</span>
          </div>
          {design.factors.map((f) => (
            <div key={f.id} role="row" className="grid gap-2 sm:grid-cols-[30%_1fr] sm:gap-3 border-b border-border last:border-b-0 px-4 py-3 text-[13px]">
              <div role="cell" className="min-w-0">
                <div className="font-medium text-foreground">{f.name}</div>
                <div className="text-[11px] text-muted-foreground">{typeLabel(f.type)}</div>
              </div>
              <ul role="cell" className="flex min-w-0 flex-wrap gap-1.5" aria-label={`Levels of ${f.name}`}>
                {f.levels.map((l) => (
                  <LevelChip key={l.id} factor={f.name} level={l} inFile={inFile} active={active} onToggle={onToggle} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {design.tier !== "unresolved" && (
        <div className="surface px-4 py-3">
          <h3 className="text-[14px] font-medium mb-2">Comparisons</h3>
          {design.comparisons.length === 0 && design.weaker.length === 0 && design.collapsed.length === 0 && (
            <p className="text-[13px] text-muted-foreground">The design supports no comparison between groups.</p>
          )}
          {design.comparisons.length === 0 && design.weaker.length > 0 && (
            <p className="text-[13px] text-muted-foreground">No comparison here reaches grade B; the weaker ones are listed below.</p>
          )}
          <ul className="divide-y divide-border">
            {design.comparisons.map((c) => (
              <ContrastRow key={c.id} c={c} />
            ))}
          </ul>
          {design.weaker.length > 0 && (
            <div className="mt-2">
              <button type="button" className="inline-flex items-center gap-1 text-[12.5px] text-primary hover:underline" onClick={() => setShowWeaker((v) => !v)} aria-expanded={showWeaker}>
                {showWeaker ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {showWeaker ? "Hide" : "Show"} {fmtInt(design.weaker.length)} weaker {design.weaker.length === 1 ? "comparison" : "comparisons"} (grade C)
              </button>
              {showWeaker && (
                <ul className="divide-y divide-border">
                  {design.weaker.map((c) => (
                    <ContrastRow key={c.id} c={c} />
                  ))}
                </ul>
              )}
            </div>
          )}
          {(design.collapsed.length > 0 || design.held > 0) && (
            <ul className="mt-2 space-y-0.5 text-[12.5px] text-muted-foreground">
              {design.collapsed.map((g) => (
                <li key={g.factor_id}>
                  Also compares the {fmtInt(g.n_levels)} levels of {g.factor} with each other ({fmtInt(g.n_pairs)} {g.n_pairs === 1 ? "pair" : "pairs"}, not listed).
                </li>
              ))}
              {design.held > 0 && (
                <li>
                  {fmtInt(design.held)} {design.held === 1 ? "comparison is" : "comparisons are"} held back because the group assignments are unresolved.
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-3">
          {notes > 0 && (
            <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => setShowNotes((v) => !v)} aria-expanded={showNotes}>
              {showNotes ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Curation notes ({fmtInt(notes)})
            </button>
          )}
          <button type="button" className="text-primary hover:underline" onClick={onShowRaw}>
            Show as deposited in GEO
          </button>
        </div>
        <span>
          {design.provenance.paper_used ? "Read from the GEO record and the paper" : "Read from the GEO record"}
          {design.provenance.prompt_version ? ` · prompt ${design.provenance.prompt_version}` : ""}
        </span>
      </div>
      {showNotes && notes > 0 && (
        <ul className="surface px-4 py-3 space-y-1 text-[12.5px] text-muted-foreground list-disc pl-8">
          {design.conflicts.map((c, i) => (
            <li key={`c${i}`}>
              {c.gsm && <span className="font-mono text-foreground">{c.gsm}: </span>}
              {c.note}
            </li>
          ))}
          {design.abstentions.map((a, i) => (
            <li key={`a${i}`}>{a}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LevelChip({ factor, level, inFile, active, onToggle }: { factor: string; level: DesignLevelView; inFile: Set<string>; active: ConditionFilter | null; onToggle: (f: ConditionFilter) => void }) {
  const available = level.gsms.filter((g) => inFile.has(g));
  const on = active?.key === factor && active.value === level.standard;
  const authorDiffers = level.label && level.label.toLowerCase() !== level.standard.toLowerCase();
  const onto = level.ontology.map((o) => `${o.label} (${o.id})`).join(", ");
  const title = [
    `${fmtInt(available.length)} of ${fmtInt(level.gsms.length)} samples are in the published file`,
    authorDiffers ? `Author's label: ${level.label}` : "",
    onto ? `Ontology: ${onto}` : "",
    available.length ? (on ? "Click to show all samples" : "Click to show only these samples") : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <li className="min-w-0 max-w-full">
      <button
        type="button"
        disabled={!available.length}
        onClick={() => onToggle({ key: factor, value: level.standard, gsms: new Set(available) })}
        aria-pressed={on}
        title={title}
        className={cn("chip h-auto min-h-7 py-1 max-w-full sm:max-w-[420px] font-normal text-left disabled:opacity-60 disabled:cursor-default", on && "border-primary/60 bg-primary/[0.06] text-primary")}
      >
        {level.role !== "other" && (
          <span className={cn("shrink-0 rounded px-1 text-[10px] uppercase tracking-wider", level.role === "reference" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
            {level.role === "reference" ? "ref" : "test"}
          </span>
        )}
        <span className="min-w-0 truncate">{level.standard}</span>
        {authorDiffers && <span className="hidden min-w-0 truncate text-[11px] text-muted-foreground sm:inline">“{level.label}”</span>}
        <span className={cn("shrink-0 font-mono text-[11px] tabular", on ? "text-primary/80" : "text-muted-foreground")}>
          {fmtInt(available.length)}/{fmtInt(level.gsms.length)}
        </span>
      </button>
    </li>
  );
}

function ContrastRow({ c }: { c: DesignContrastView }) {
  const [open, setOpen] = useState(false);
  const shared = Object.entries(c.shared);
  const donors = c.donors_test != null && c.donors_reference != null ? ` · ${fmtInt(c.donors_test)} vs ${fmtInt(c.donors_reference)} donors` : "";
  return (
    <li className="py-2 text-[13px]">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={cn("rounded border px-1.5 text-[11px] font-mono", GRADE_CLASS[c.grade])} title={`Grade ${c.grade}: ${GRADE_TEXT[c.grade]}`}>
          {c.grade}
        </span>
        <span className="font-medium text-foreground">
          {c.test} <span className="text-muted-foreground font-normal">vs</span> {c.reference ?? "the rest"}
        </span>
        <span className="text-[12px] text-muted-foreground">
          {fmtInt(c.n_test)} vs {fmtInt(c.n_reference)} samples{donors} · {c.factor} · {c.stated ? "stated by the authors" : "derived from the groups"}
        </span>
        <button type="button" className="ml-auto inline-flex items-center gap-0.5 text-[12px] text-primary hover:underline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} details
        </button>
      </div>
      {c.confounds.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[12.5px] text-amber-700 dark:text-amber-400">
          {c.confounds.map((k) => (
            <li key={k}>{CONFOUND_TEXT[k] ?? k.replace(/_/g, " ")}</li>
          ))}
        </ul>
      )}
      {open && (
        <dl className="mt-2 grid gap-1.5 text-[12.5px]">
          {shared.length > 0 && (
            <div>
              <dt className="text-muted-foreground">Both groups share</dt>
              <dd>{shared.map(([k, v]) => `${k}: ${v}`).join(" · ")}</dd>
            </div>
          )}
          {c.differs.length > 0 && (
            <div>
              <dt className="text-muted-foreground">Also differs</dt>
              <dd>
                <ul>
                  {c.differs.map((d) => (
                    <li key={d.attribute} className={cn(d.aligned && "text-amber-700 dark:text-amber-400")}>
                      {d.attribute}: {d.test_values.join(", ") || "—"} <span className="text-muted-foreground">vs</span> {d.reference_values.join(", ") || "—"}
                      {d.aligned ? " (changes with the groups)" : ""}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          {(c.pairing || c.replication_unit) && (
            <div>
              <dt className="text-muted-foreground">Replication</dt>
              <dd>
                {c.replication_unit ? `by ${c.replication_unit}` : ""}
                {c.pairing && c.pairing !== "unknown" ? ` · ${c.pairing}` : c.pairing === "unknown" ? " · pairing not stated" : ""}
              </dd>
            </div>
          )}
          {c.evidence && (
            <div>
              <dt className="text-muted-foreground">Evidence</dt>
              <dd className="italic">“{c.evidence}”</dd>
            </div>
          )}
        </dl>
      )}
    </li>
  );
}

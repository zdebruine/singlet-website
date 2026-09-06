import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, Copy, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtBytes, fmtCompact, fmtInt } from "@/lib/catalog-display";
import { bundleUrl } from "@/integrations/api/client";
import type { StudyRow } from "@/integrations/api/types";

interface Props {
  row: StudyRow;
  selected: boolean;
  onToggle: (row: StudyRow) => void;
  /** Violet label when the explanation belongs to an interpreted query. */
  ai: boolean;
  why?: string;
  /** True when `why` was written by the model (signed-in explanations), not derived from the filters. */
  aiWhy?: boolean;
}

export function metaLine(r: StudyRow): string[] {
  const parts: string[] = [];
  parts.push(r.organism_label || "Unknown organism");
  if (r.tissue_groups.length) parts.push(r.tissue_groups.slice(0, 2).join(", ") + (r.tissue_groups.length > 2 ? " +" + (r.tissue_groups.length - 2) : ""));
  if (r.assay_families.length) parts.push(r.assay_families.slice(0, 2).join(", "));
  parts.push(r.bundle_n_samples != null ? `${fmtInt(r.bundle_n_samples)} samples in file` : `${fmtInt(r.n_done)} samples (catalog)`);
  parts.push(r.file_cells != null ? `${fmtCompact(r.file_cells)} cells (file)` : `${fmtCompact(r.n_cells)} cells (catalog)`);
  if (r.year) parts.push(String(r.year));
  return parts;
}

function LoadSnippet({ gseId }: { gseId: string }) {
  const [copied, setCopied] = useState(false);
  const code = `singlet.load("${gseId}")`;
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="relative z-10 inline-flex items-center gap-2 rounded font-mono text-[12px] h-7 px-2 bg-dark text-dark-foreground hover:brightness-110 transition"
      aria-label={`Copy ${code}`}
      title="Copy to clipboard"
    >
      <span>{code}</span>
      {copied ? <Check size={12} className="text-primary" /> : <Copy size={12} className="text-dark-muted" />}
    </button>
  );
}

export function StudyCard({ row, selected, onToggle, ai, why, aiWhy }: Props) {
  const conditions = row.conditions.slice(0, 3);
  const explanation = why ?? row.why;
  const failed = row.n_failed ?? Math.max(0, row.n_total - row.n_done);

  return (
    <article
      className={cn("surface group relative p-4 transition-colors", selected && "border-primary/60 bg-primary/[0.02]")}
      aria-labelledby={`${row.gse_id}-title`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(row)}
          aria-label={`Select ${row.gse_id}`}
          className="mt-[3px] h-4 w-4 shrink-0 rounded-[2px]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <Link to={`/study/${row.gse_id}`} className="relative z-10 font-mono text-[13px] text-primary hover:underline">
              {row.gse_id}
            </Link>
            {row.year && <span className="font-mono text-[12px] text-muted-foreground tabular">{row.year}</span>}
          </div>
          <h3 id={`${row.gse_id}-title`} className="mt-0.5 text-[15px] font-semibold leading-snug text-foreground line-clamp-2">
            <Link to={`/study/${row.gse_id}`} className="before:absolute before:inset-0 hover:text-primary transition-colors">
              {row.title ?? "Untitled study"}
            </Link>
          </h3>
          <p className="mt-1 text-[13px] text-muted-foreground tabular">
            {metaLine(row).map((p, i) => (
              <span key={i}>
                {i > 0 && <span className="mx-1.5 text-border-strong">·</span>}
                {p}
              </span>
            ))}
            {row.suspect_cells && (
              <span className="ml-1.5 inline-flex items-center gap-1 text-warning" title="Cell counts for some plate-based samples in this study are implausible and are under review.">
                <AlertTriangle size={12} /> flagged counts
              </span>
            )}
          </p>

          {(row.match.facets.length > 0 || row.match.keywords.some((k) => k.hits.length)) && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Match evidence">
              {row.match.facets.map((facet) => (
                <li key={`${facet.key}-${facet.label}`} title={facet.detail} className={cn("chip h-6 text-[11px]", facet.status === "hit" && "chip-active", facet.status === "miss" && "text-muted-foreground")}>
                  {facet.label}: {facet.status}
                </li>
              ))}
              {row.match.keywords.filter((k) => k.hits.length).map((keyword) => (
                <li key={keyword.term} title={keyword.hits.join(" · ")} className="chip h-6 text-[11px]">“{keyword.term}”</li>
              ))}
            </ul>
          )}

          {row.abstract && <p className="mt-2 text-[13px] leading-relaxed text-foreground/75 line-clamp-2">{row.abstract}</p>}

          {(conditions.length > 0 || failed > 0) && (
            <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Conditions">
              {conditions.map((c) => (
                <li
                  key={c.key}
                  className="flag h-6 font-normal max-w-full min-w-0"
                  title={c.values.map((v, i) => `${v} (${c.counts[i]})`).join(" · ")}
                >
                  <span className="font-medium shrink-0">{c.key}:</span>
                  <span className="truncate min-w-0 max-w-[280px]">
                    {c.values.slice(0, 3).join(" vs ")}
                    {c.values.length > 3 ? ` +${c.values.length - 3}` : ""}
                  </span>
                </li>
              ))}
              {row.n_conditions > conditions.length && (
                <li className="chip h-6 text-[12px] text-muted-foreground">+{row.n_conditions - conditions.length} more</li>
              )}
              {failed > 0 && (
                <li className="chip h-6 text-[12px] text-muted-foreground" title="Samples the pipeline could not process">
                  {fmtInt(failed)} failed
                </li>
              )}
            </ul>
          )}

          {explanation && (
            <p className="mt-2.5 text-[13px] leading-snug">
              {aiWhy && (
                <span className="ai-badge mr-1.5 align-[1px]" title="Written by the model from this study's metadata">
                  AI
                </span>
              )}
              <span className={cn("font-medium", ai || aiWhy ? "text-ai" : "text-muted-foreground")}>{ai || aiWhy ? "Why it matches:" : "Matches:"}</span>{" "}
              <span className="text-foreground/85">{explanation}</span>
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 transition-opacity">
            <LoadSnippet gseId={row.gse_id} />
            {row.has_bundle ? (
              <a
                href={bundleUrl(row.gse_id)}
                className="relative z-10 inline-flex items-center gap-1.5 text-[13px] text-primary hover:underline"
                download
              >
                <Download size={13} />
                Download .singlet
                {row.bundle_bytes != null && <span className="text-muted-foreground">· {fmtBytes(row.bundle_bytes)}</span>}
              </a>
            ) : (
              <span className="text-[13px] text-muted-foreground">File not built yet</span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export function StudyCardSkeleton() {
  return (
    <div className="surface p-4 animate-pulse" aria-hidden="true">
      <div className="flex gap-3">
        <div className="h-4 w-4 rounded-[2px] bg-secondary mt-1" />
        <div className="flex-1 space-y-2.5">
          <div className="h-3 w-24 rounded bg-secondary" />
          <div className="h-4 w-3/4 rounded bg-secondary" />
          <div className="h-3 w-1/2 rounded bg-secondary" />
          <div className="h-3 w-full rounded bg-secondary" />
          <div className="h-7 w-48 rounded bg-secondary" />
        </div>
      </div>
    </div>
  );
}

export default StudyCard;

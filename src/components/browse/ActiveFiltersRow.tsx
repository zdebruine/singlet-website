import type { ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { organismLabel } from "@/lib/catalog-display";
import type { AppliedFilters, DroppedValue } from "@/integrations/api/types";
import { activeFilters, FIELD_LABEL } from "./browse-state";

interface Props {
  applied: AppliedFilters;
  /** True when the chips came out of the plain-English interpreter. */
  ai: boolean;
  dropped?: DroppedValue[];
  note?: string;
  /** Right-aligned extras (AI budget counter, explain button). */
  trailing?: ReactNode;
  onRemove: (field: string, value: string) => void;
  onAddFilter: () => void;
  onClear: () => void;
  className?: string;
}

/**
 * "We read that as …" row. Violet only when the chips are AI-derived; explicit
 * filters use the teal active-chip style.
 */
export function ActiveFiltersRow({ applied, ai, dropped, note, trailing, onRemove, onAddFilter, onClear, className }: Props) {
  const chips = activeFilters(applied, organismLabel);
  if (!chips.length && !note && !dropped?.length) return null;

  return (
    <div className={cn(ai ? "ai-surface" : "surface", "px-3 py-2", className)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {ai ? (
          <>
            <span className="ai-badge">AI</span>
            <span className="text-[13px] text-foreground/80">We read that as</span>
          </>
        ) : (
          <span className="text-[13px] text-foreground/80">Filters</span>
        )}
        {chips.map((c) => (
          <button
            key={`${c.field}:${c.value}`}
            type="button"
            onClick={() => onRemove(c.field, c.value)}
            className={cn(ai ? "ai-chip" : "chip-active", "h-7 text-[12px] pl-2 pr-1.5 max-w-[320px]")}
            title={`Remove ${FIELD_LABEL[c.field] ?? c.field}: ${c.label}`}
          >
            <span className="opacity-70">{FIELD_LABEL[c.field] ?? c.field}:</span>
            <span className="truncate">{c.label}</span>
            <X size={11} className="shrink-0" />
          </button>
        ))}
        <button type="button" onClick={onAddFilter} className="chip h-7 text-[12px] px-2 text-muted-foreground">
          <Plus size={11} />
          add filter
        </button>
        {chips.length > 1 && (
          <button type="button" onClick={onClear} className="text-[12px] text-muted-foreground hover:text-foreground underline underline-offset-2">
            clear all
          </button>
        )}
        <span className="ml-auto inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          {trailing}
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">AND across groups · any-of within a group</span>
        </span>
      </div>
      {(note || (dropped && dropped.length > 0)) && (
        <p className="mt-1.5 text-[12px] text-muted-foreground leading-snug">
          {note}
          {dropped && dropped.length > 0 && (
            <>
              {note ? " " : ""}
              Not in the catalog vocabulary:{" "}
              {dropped.map((d, i) => (
                <span key={`${d.field}:${d.value}`}>
                  {i > 0 && ", "}
                  <span className="text-foreground/80">{FIELD_LABEL[d.field] ?? d.field}</span> “{d.value}”
                </span>
              ))}
              .
            </>
          )}
        </p>
      )}
    </div>
  );
}

export default ActiveFiltersRow;

import { ArrowRight, SearchX } from "lucide-react";
import { fmtInt, organismLabel } from "@/lib/catalog-display";
import type { Suggestion } from "@/integrations/api/types";
import { FIELD_LABEL } from "./browse-state";

interface Props {
  level: "gse" | "gsm";
  suggestions: Suggestion[];
  hasFilters: boolean;
  onApply: (params: string) => void;
  onClear: () => void;
  onSamples?: () => void;
}

function suggestionText(s: Suggestion): { verb: string; what: string } {
  if (s.keep) {
    const label = s.keep.field === "organism" ? organismLabel(s.keep.value) : s.keep.value;
    return { verb: "Keep only", what: `${FIELD_LABEL[s.keep.field] ?? s.keep.field}: ${label}` };
  }
  if (s.drop) {
    if (s.drop.field === "all_filters") return { verb: "Search", what: `“${s.drop.value}” alone` };
    if (s.drop.field === "q") return { verb: "Drop keywords", what: `“${s.drop.value}”` };
    const label = s.drop.field === "organism" ? organismLabel(s.drop.value) : s.drop.value;
    return { verb: "Remove", what: `${FIELD_LABEL[s.drop.field] ?? s.drop.field}: ${label}` };
  }
  return { verb: "Try", what: "a broader search" };
}

export function EmptyState({ level, suggestions, hasFilters, onApply, onClear, onSamples }: Props) {
  const noun = level === "gse" ? "studies" : "samples";
  return (
    <div className="surface px-6 py-10 text-center">
      <SearchX size={22} className="mx-auto text-muted-foreground" aria-hidden="true" />
      <h2 className="mt-3 text-[17px] font-semibold text-foreground font-sans">No {noun} match all of these</h2>
      <p className="mt-1.5 text-[13.5px] text-muted-foreground max-w-[520px] mx-auto">
        Filters combine with AND, and nothing is loosened behind your back. Pick one of these to change the question instead:
      </p>

      {suggestions.length > 0 ? (
        <ul className="mt-5 flex flex-col items-center gap-2">
          {suggestions.map((s, i) => {
            const t = suggestionText(s);
            return (
              <li key={i} className="w-full max-w-[520px]">
                <button
                  type="button"
                  onClick={() => onApply(s.params)}
                  className="w-full flex items-center justify-between gap-3 rounded border border-border bg-card hover:border-primary/60 hover:bg-primary/[0.03] px-3.5 h-10 text-[13.5px] text-left transition-colors"
                >
                  <span>
                    <span className="text-muted-foreground">{t.verb} </span>
                    <span className="font-medium text-foreground">{t.what}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-primary tabular whitespace-nowrap">
                    {fmtInt(s.total)} {s.total === 1 ? "study" : "studies"}
                    <ArrowRight size={12} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 text-[13px] text-muted-foreground">No single change rescues this search.</p>
      )}

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {hasFilters && (
          <button type="button" onClick={onClear} className="btn-secondary btn-sm">
            Clear everything
          </button>
        )}
        {level === "gse" && onSamples && (
          <button type="button" onClick={onSamples} className="btn-secondary btn-sm">
            Look at samples instead
          </button>
        )}
      </div>
    </div>
  );
}

export default EmptyState;

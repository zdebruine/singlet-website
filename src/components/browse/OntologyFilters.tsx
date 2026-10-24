import { useEffect, useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtInt } from "@/lib/catalog-display";
import { apiClient } from "@/integrations/api/client";
import type { AppliedFilters } from "@/integrations/api/types";
import { PROPERTY_FIELDS, TERM_FIELDS, type PropertyField, type TermField } from "./browse-state";

/** Labels for the ontology ids in the applied filters, for chips ("UBERON:0002048" -> "lung"). */
export function useTermLabels(applied: AppliedFilters): Map<string, string> {
  const wanted = TERM_FIELDS.map((t) => [t.name, applied.terms?.[t.name] ?? []] as const).filter(([, v]) => v.length);
  const key = JSON.stringify(wanted);
  const q = useQuery({
    queryKey: ["ontology-labels", key],
    enabled: wanted.length > 0,
    staleTime: 3_600_000,
    queryFn: async ({ signal }) => {
      const out = new Map<string, string>();
      for (const [name, values] of wanted) {
        const r = await apiClient.ontologyTerms(name, { values }, signal);
        for (const t of r.resolved) if ("label" in t) out.set(t.value, t.label);
      }
      return out;
    },
  });
  return q.data ?? new Map();
}

function TermPicker({ name, label, ontologies, placeholder, selected, labels, onToggle }: {
  name: TermField;
  label: string;
  ontologies: string;
  placeholder: string;
  selected: string[];
  labels: Map<string, string>;
  onToggle: (name: TermField, value: string) => void;
}) {
  const [open, setOpen] = useState(selected.length > 0);
  const [text, setText] = useState("");
  const [needle, setNeedle] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setNeedle(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const terms = useQuery({
    queryKey: ["ontology-terms", name, needle],
    enabled: open,
    staleTime: 300_000,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => apiClient.ontologyTerms(name, { q: needle, limit: needle ? 12 : 8 }, signal),
  });
  const options = useMemo(() => (terms.data?.terms ?? []).filter((t) => !selected.includes(t.id)), [terms.data, selected]);

  return (
    <div className="py-1.5">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-baseline justify-between text-left text-[13px] text-foreground/90 hover:text-foreground">
        <span>{label}{selected.length > 0 && <span className="ml-1 text-primary">({selected.length})</span>}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{ontologies}</span>
      </button>
      {selected.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {selected.map((v) => (
            <li key={v}>
              <button type="button" onClick={() => onToggle(name, v)} className="chip-active h-7 text-[12px]" aria-label={`Remove ${label.toLowerCase()} ${labels.get(v) ?? v}`} title={v}>
                {labels.get(v) ?? v}
                <X size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="mt-1.5">
          <input
            type="text"
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            aria-label={`Search ${label.toLowerCase()} terms`}
            className="input h-7 px-2 text-xs"
          />
          {terms.data && !terms.data.available ? (
            <p className="mt-1.5 text-[11px] text-muted-foreground">Ontology terms are not loaded yet.</p>
          ) : (
            <ul className={cn("mt-1.5 space-y-1", terms.isFetching && "opacity-60")}>
              {options.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => { onToggle(name, t.id); setText(""); }} className="group flex min-h-[22px] w-full items-center gap-2 text-left" title={`${t.id} · ${fmtInt(t.n_samples)} samples`}>
                    <span className="flex-1 truncate text-[13px] text-foreground/80 group-hover:text-foreground">{t.label}</span>
                    <span className="font-mono text-[11px] tabular text-muted-foreground">{fmtInt(t.n_studies)}</span>
                  </button>
                </li>
              ))}
              {needle && !terms.isFetching && options.length === 0 && <li className="text-xs text-muted-foreground">No terms with samples.</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Ontology filters for the Browse rail: one picker per filter. A term matches samples mapped to it or to any
 * narrower term ("T cell" includes CD4-positive T cells, "lung" includes its lobes). Counts are studies with a
 * file that have such samples.
 */
export function OntologyFilters({ current, labels, onToggle, onPropToggle }: {
  current: AppliedFilters;
  labels: Map<string, string>;
  onToggle: (name: TermField, value: string) => void;
  onPropToggle: (name: PropertyField, value: string) => void;
}) {
  return (
    <div>
      {PROPERTY_FIELDS.map((p) => (
        <div key={p.name} className="py-1.5">
          <div className="mb-1 text-[13px] text-foreground/90">{p.label}</div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={p.label}>
            {p.values.map(([value, label]) => {
              const on = (current.props?.[p.name] ?? []).includes(value);
              return (
                <button key={value} type="button" aria-pressed={on} onClick={() => onPropToggle(p.name, value)}
                  className={cn("chip h-7 px-2 text-[12px]", on && "border-primary text-primary bg-primary/5")}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {TERM_FIELDS.map((t) => (
        <TermPicker key={t.name} name={t.name} label={t.label} ontologies={t.ontologies} placeholder={t.placeholder} selected={current.terms?.[t.name] ?? []} labels={labels} onToggle={onToggle} />
      ))}
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        Sample metadata mapped to ontology terms. A term also matches its narrower terms. Counts are studies with a file.
        Donor, perturbation and sample kind are read from the sample's GEO fields; samples without that evidence are left out when one is set.
      </p>
    </div>
  );
}

export default OntologyFilters;

import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** A real query as the vocabulary reads it (organism, tissue and cell type come from explicit words). */
const EXAMPLE = {
  q: "microglia in the aging mouse brain",
  parts: [
    { word: "microglia", field: "cell type", value: "microglia" },
    { word: "aging", field: "keyword", value: "aging" },
    { word: "mouse", field: "organism", value: "Mus musculus" },
    { word: "brain", field: "tissue", value: "Brain / CNS" },
  ],
};

/** How a question becomes filters, for the About page and the AI Search page. */
export function QueryParse() {
  return (
    <div>
      <p className="mb-4 text-[12.5px] font-medium text-muted-foreground uppercase tracking-wider">How a question becomes filters</p>
      <div className="rounded-full border border-border bg-background px-4 py-2.5 text-[14px]">
        {EXAMPLE.q.split(" ").map((w, i) => (
          <span key={i} className={cn(EXAMPLE.parts.some((p) => p.word === w) && "font-semibold text-primary")}>
            {w}{" "}
          </span>
        ))}
      </div>
      <div className="my-3 flex justify-center text-muted-foreground" aria-hidden="true">
        ↓
      </div>
      <ul className="grid grid-cols-2 gap-2">
        {EXAMPLE.parts.map((p) => (
          <li key={p.field} className="rounded border border-border px-3 py-2">
            <span className="block text-[11px] uppercase tracking-wider text-muted-foreground">{p.field}</span>
            <span className="text-[14px] font-medium">{p.value}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <span className="rounded bg-[var(--teal-50)] px-2 py-1 text-foreground">vocabulary</span>
        <ArrowRight size={13} aria-hidden="true" />
        <span className="rounded border border-dashed border-border px-2 py-1">AI, only for words it cannot place</span>
      </div>
    </div>
  );
}

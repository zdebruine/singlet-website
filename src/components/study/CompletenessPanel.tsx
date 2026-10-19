import { fmtInt } from "@/lib/catalog-display";
import type { Completeness } from "@/integrations/api/types";

/** One cell of the accounting row; hidden when the count is zero and the cell is optional. */
function Stat({ label, value, title }: { label: string; value: number | null; title?: string }) {
  if (value == null) return null;
  return (
    <div className="min-w-0" title={title}>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-[15px] font-medium tabular">{fmtInt(value)}</dd>
    </div>
  );
}

const CLASS_LABEL = {
  not_processable: "Cannot be processed",
  retry: "Not finished",
  qc: "Failed QC",
  queued: "Queued",
} as const;

/**
 * Where every GEO sample of the study ended up. Shown only when the study is
 * not whole, so a clean study stays uncluttered.
 */
const CompletenessPanel = ({ c }: { c: Completeness | null }) => {
  if (!c || c.state === "complete") return null;
  return (
    <section className="surface px-4 py-3 mb-4" aria-labelledby="completeness-h">
      <h2 id="completeness-h" className="text-[15px] font-semibold">Completeness</h2>
      <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
        <Stat label="Samples on GEO" value={c.geo_samples} title="Samples GEO lists for this series" />
        <Stat label="Processed" value={c.processed} />
        <Stat label="In study file" value={c.in_file} title="Processed samples in the published .singlet file" />
        <Stat label="Passed QC" value={c.passed_qc} title="In the file, not flagged low QC and not removed" />
      </dl>
      {c.notes.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-[13px] text-muted-foreground list-disc pl-4">
          {c.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {c.reasons.length > 0 && (
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          {c.reasons.map((r) => `${CLASS_LABEL[r.class]}: ${r.reason} (${fmtInt(r.n)})`).join(" · ")}
        </p>
      )}
    </section>
  );
};

export default CompletenessPanel;

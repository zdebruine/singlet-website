import { Link } from "react-router-dom";
import { fmtInt } from "@/lib/catalog-display";
import type { BundleIndexResponse } from "@/integrations/api/types";

interface ProvenancePanelProps {
  index: BundleIndexResponse | undefined;
  nCatalogProcessed: number;
}

/** Provenance facts pulled straight from the bundle manifest — never fabricated. */
export function ProvenancePanel({ index, nCatalogProcessed }: ProvenancePanelProps) {
  if (!index) return null;

  const rows: { label: string; value: string }[] = [
    ...(index.singlet_version && index.singlet_version !== "unknown" ? [{ label: "Pipeline version", value: index.singlet_version }] : []),
    ...(index.reference_build ? [{ label: "Reference build", value: index.reference_build }] : []),
    ...(index.created_at ? [{ label: "Packed", value: index.created_at.slice(0, 10) }] : []),
    {
      label: "Samples in file",
      value:
        index.n_samples !== nCatalogProcessed
          ? `${fmtInt(index.n_samples)} (catalog lists ${fmtInt(nCatalogProcessed)} processed)`
          : fmtInt(index.n_samples),
    },
  ];

  if (rows.length === 0) return null;

  return (
    <section className="mb-6" aria-labelledby="provenance-h">
      <h2 id="provenance-h" className="text-[18px] mb-2">Provenance</h2>
      <dl className="surface px-4 py-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className="text-foreground font-mono">{r.value}</dd>
          </div>
        ))}
        <dt className="text-muted-foreground">License</dt>
        <dd>
          <Link to="/data-license" className="text-primary hover:underline">CC0 — free to reuse, no attribution required</Link>
        </dd>
      </dl>
    </section>
  );
}

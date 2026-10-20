import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { extractSampleAttrs, type AttrRow } from "../../../functions/_shared/attr-extract";
import { approvedSamples, buildStudyCard, sampleLine, type StudyInput } from "../../../functions/_shared/study-card";
import type { BundleIndexResponse, GseDetailResponse } from "@/integrations/api/types";

interface DataSummaryProps {
  data: Pick<GseDetailResponse, "series" | "meta" | "samples">;
  index: BundleIndexResponse | undefined;
}

const FIRST = 12;

/**
 * What is in the study, in two to four sentences, built from the approved samples' own records and the file
 * index (functions/_shared/study-card). It is shown only when every entity and number in it resolves to a fact;
 * the submitter's abstract stays below it as provenance.
 */
export function DataSummary({ data, index }: DataSummaryProps) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);

  const built = useMemo(() => {
    const input: StudyInput = {
      series: { id: data.series.id, title: data.series.title, abstract: data.series.abstract, unusable_gsm_ids: data.series.unusable_gsm_ids },
      meta: data.meta ? { organisms: data.meta.organisms } : null,
      file_paths: index ? [...index.samples.flatMap((s) => s.files.map((f) => f.path.replace(/^samples\/[^/]+\//, ""))), ...(index.study_files ?? []).map((f) => f.path)] : undefined,
      samples: data.samples.map((s) => ({
        gsm_id: s.gsm_id,
        gse_id: s.gse_id,
        organism_primary: s.organism_primary ?? null,
        protocol: s.protocol,
        assay_family: s.assay_family,
        modality: s.modality,
        n_cells: s.n_cells,
        status: s.status,
        title: s.title,
        source: s.source,
        characteristics_raw: s.characteristics_raw ?? null,
        low_qc: s.low_qc,
      })),
    };
    const approved = approvedSamples(input);
    const rows: AttrRow[] = approved.flatMap(
      (s) => extractSampleAttrs({ gsm_id: s.gsm_id, gse_id: s.gse_id, title: s.title, source: s.source, characteristics: s.characteristics_raw, organism_primary: s.organism_primary }).rows,
    );
    const card = buildStudyCard(input, rows);
    const lines = approved.map((s) => ({ gsm_id: s.gsm_id, line: sampleLine(s, rows) })).filter((l) => l.line);
    return { card, lines };
  }, [data, index]);

  const { card, lines } = built;
  if (!card.grounded || !card.summary_text) return null;
  const shown = all ? lines : lines.slice(0, FIRST);

  return (
    <section className="mb-6" aria-labelledby="data-summary-h">
      <h2 id="data-summary-h" className="text-[18px] mb-2">Data summary</h2>
      <div className="surface px-4 py-3">
        <p className="text-[14px] text-foreground leading-relaxed">{card.summary_text}</p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Read from the sample records in GEO and the published file. Only what is stated is listed; the abstract below is the submitter's.
        </p>
        {lines.length > 0 && (
          <div className="mt-2">
            <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 text-[13px] text-primary hover:underline" aria-expanded={open}>
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {open ? "Hide samples" : `Per-sample facts (${lines.length})`}
            </button>
            {open && (
              <>
                <dl className="mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12.5px]">
                  {shown.map((l) => (
                    <div key={l.gsm_id} className="contents">
                      <dt className="font-mono text-muted-foreground">{l.gsm_id}</dt>
                      <dd className="text-foreground/85">{l.line}</dd>
                    </div>
                  ))}
                </dl>
                {lines.length > FIRST && (
                  <button onClick={() => setAll(!all)} className="mt-2 text-[13px] text-primary hover:underline">
                    {all ? "Show fewer" : `Show all ${lines.length}`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

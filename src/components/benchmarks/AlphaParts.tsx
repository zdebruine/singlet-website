import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Clock, ExternalLink, Minus } from "lucide-react";
import { commitUrl } from "@/lib/benchmarks";
import { loadAlphaPanel, loadScbc, pct, times, type AlphaResult, type AlphaSource, type ScbcDoc } from "@/lib/alpha-benchmarks";
import { FigureChart, figureSupported, MetricTable } from "@/components/benchmarks/BenchParts";
import { fmtInt } from "@/lib/catalog-display";

/** One number with its label: the stat tile used across the Alpha panels. */
export function Stat({ value, label, detail }: { value: string; label: string; detail?: string }) {
  return (
    <div className="surface p-4">
      <p className="text-[26px] leading-none font-semibold tabular text-foreground">{value}</p>
      <p className="mt-2 text-[13px] text-foreground">{label}</p>
      {detail && <p className="mt-1 text-[12px] text-muted-foreground">{detail}</p>}
    </div>
  );
}

function Panel({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-20 mt-8" aria-labelledby={id ? `${id}-h` : undefined}>
      <h3 id={id ? `${id}-h` : undefined} className="text-[17px] font-semibold text-foreground">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SourceLine({ source, measured }: { source: AlphaSource | null; measured: string | null }) {
  if (!source && !measured) return null;
  return (
    <p className="mt-3 text-[12px] text-muted-foreground">
      {measured && <>Measured {measured}. </>}
      {source?.repo && source.commit && (
        <>
          Source:{" "}
          <a href={commitUrl(source.commit)} target="_blank" rel="noopener noreferrer" className="font-mono text-primary underline underline-offset-2">
            {source.commit.slice(0, 9)}
          </a>
          {source.files?.length ? <> · {source.files.map((f) => <span key={f} className="font-mono">{f} </span>)}</> : null}
        </>
      )}
    </p>
  );
}

const Yes = () => <Check className="h-4 w-4 text-primary" aria-label="yes" />;
const No = () => <Minus className="h-4 w-4 text-muted-foreground" aria-label="no" />;
const mark = (v: boolean | string) => (typeof v === "string" ? <span>{v}</span> : v ? <Yes /> : <No />);

/** The scBaseCount and Cell Ranger comparison, measured on the Alpha files. */
export function ScbcPanels({ doc }: { doc: ScbcDoc }) {
  const { cell_calls: cc, depth: dp, coverage: cov, depth_matched: dm } = doc;
  const gap = dm.rows.map((r) => r.noise_floor - r.depth_matched);
  return (
    <>
      <Panel title="Coverage and protocol breadth" id="alpha-coverage">
        <p className="max-w-3xl text-[14px] text-muted-foreground">
          scBaseCount (Arc Institute) processes 10x Genomics libraries only. Singlet also processes other droplet and plate-based
          protocols, and keeps every barcode so cells can be re-called.
        </p>
        <p className="mt-4 max-w-3xl rounded border border-dashed border-border px-4 py-3 text-[13.5px] text-muted-foreground">
          <span className="font-medium text-foreground">Coverage — updated after the Alpha release.</span> Sample counts for this
          comparison are recomputed on the Alpha atlas once the catalog is loaded. Today's totals are in the census below.
        </p>
        <div className="mt-4 overflow-x-auto max-w-3xl">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b border-border text-left text-[12px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Protocol or property</th>
                <th className="py-2 pr-4 font-medium">Singlet Alpha</th>
                <th className="py-2 font-medium">scBaseCount</th>
              </tr>
            </thead>
            <tbody>
              {cov.protocols.map((p) => (
                <tr key={p.protocol} className="border-b border-border/60">
                  <td className="py-1.5 pr-4 text-foreground">{p.protocol}</td>
                  <td className="py-1.5 pr-4">{mark(p.singlet)}</td>
                  <td className="py-1.5">{mark(p.scbasecount)}</td>
                </tr>
              ))}
              {cov.other.map((p) => (
                <tr key={p.item} className="border-b border-border/60">
                  <td className="py-1.5 pr-4 text-foreground">{p.item}</td>
                  <td className="py-1.5 pr-4 text-muted-foreground">{mark(p.singlet)}</td>
                  <td className="py-1.5 text-muted-foreground">{mark(p.scbasecount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Cell recovery against the authors' Cell Ranger results" id="alpha-cells">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat value={pct(cc.singlet_median_recovery)} label="of the authors' cells found (median)" detail={`${cc.n} samples; range ${pct(cc.singlet_recovery_range[0])}–${pct(cc.singlet_recovery_range[1])}; scBaseCount ${pct(cc.scbasecount_median_recovery)}`} />
          <Stat value={`${pct(cc.singlet_precision_range[0])}–${pct(cc.singlet_precision_range[1])}`} label="of Singlet's cells are in the authors' sets" detail={`precision, the same ${cc.n} samples`} />
          <Stat value={times(dp.cell_ratio_median)} label="cells per sample, against scBaseCount (median)" detail={`${fmtInt(dp.samples)} shared human samples`} />
        </div>
        <div className="mt-4 overflow-x-auto max-w-3xl">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b border-border text-left text-[12px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Sample</th>
                <th className="py-2 pr-4 font-medium">Singlet recovery</th>
                <th className="py-2 pr-4 font-medium">scBaseCount recovery</th>
                <th className="py-2 font-medium">Singlet precision</th>
              </tr>
            </thead>
            <tbody>
              {cc.rows.map((r, i) => (
                <tr key={i} className="border-b border-border/60 tabular">
                  <td className="py-1.5 pr-4 text-foreground">{r.category}</td>
                  <td className="py-1.5 pr-4">{pct(r.singlet_recovery)}</td>
                  <td className="py-1.5 pr-4 text-muted-foreground">{pct(r.scbasecount_recovery)}</td>
                  <td className="py-1.5 text-muted-foreground">{pct(r.singlet_precision)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 max-w-3xl text-[13.5px] text-muted-foreground">Basis: {cc.basis}. {cc.note}</p>
      </Panel>

      <Panel title="Depth: UMIs per cell" id="alpha-depth">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat value={times(dp.umi_ratio_median)} label="UMIs per cell, against scBaseCount (median)" detail={`${fmtInt(dp.median_umi_per_cell.singlet)} vs ${fmtInt(dp.median_umi_per_cell.scbasecount)} UMIs per cell`} />
          <Stat value={pct(dp.reads_used_median)} label="of each sample's reads used (median)" detail="Alpha read at most 30M reads of the first run" />
          <Stat value={times(dp.full_depth.umi_ratio_median)} label="UMIs per cell where Alpha used over 90% of the reads" detail={`${fmtInt(dp.full_depth.samples)} samples; cells ${times(dp.full_depth.cell_ratio_median)}`} />
        </div>
        <p className="mt-3 max-w-3xl text-[13.5px] text-muted-foreground">
          The gap follows the read cap: where Alpha used nearly all of a sample's reads, the ratio rises to {times(dp.full_depth.umi_ratio_median)}.
          Basis: {fmtInt(dp.samples)} {dp.basis}.
        </p>
      </Panel>

      <Panel title="Gene profiles at equal depth" id="alpha-profiles">
        <p className="max-w-3xl text-[14px] text-muted-foreground">
          At equal depth, Singlet's per-cell gene profiles match scBaseCount's within its own sampling noise: {gap.length} of {gap.length} samples
          are {Math.min(...gap).toFixed(2)}–{Math.max(...gap).toFixed(2)} below the noise floor. {dm.note}
        </p>
        <div className="mt-4 overflow-x-auto max-w-3xl">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b border-border text-left text-[12px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Sample</th>
                <th className="py-2 pr-4 font-medium">Depth-matched r</th>
                <th className="py-2 pr-4 font-medium">Noise floor</th>
                <th className="py-2 font-medium">Pseudobulk ρ</th>
              </tr>
            </thead>
            <tbody>
              {dm.rows.map((r, i) => (
                <tr key={i} className="border-b border-border/60 tabular">
                  <td className="py-1.5 pr-4 text-foreground">{r.category}</td>
                  <td className="py-1.5 pr-4">{r.depth_matched.toFixed(3)}</td>
                  <td className="py-1.5 pr-4 text-muted-foreground">{r.noise_floor.toFixed(3)}</td>
                  <td className="py-1.5 text-muted-foreground">{r.pseudobulk_spearman.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SourceLine source={doc.source} measured={doc.measured_at} />
        <p className="mt-1 text-[12px] text-muted-foreground">
          <a href={`${doc.source.repo}/blob/${doc.source.commit}/docs/scbasecount-comparison.md`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline underline-offset-2">
            Full write-up and code <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </p>
      </Panel>
    </>
  );
}

function Running({ name, what }: { name: string; what: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-5">
      <span className="inline-flex items-center gap-1 rounded border border-border bg-secondary px-2 py-0.5 text-[12px] font-medium text-muted-foreground">
        <Clock className="h-3 w-3" aria-hidden="true" /> Benchmark running
      </span>
      <h3 className="mt-3 text-[15px] font-semibold text-foreground">{name}</h3>
      <p className="mt-1 text-[13.5px] text-muted-foreground">{what}</p>
    </div>
  );
}

function AlphaResultView({ result }: { result: AlphaResult }) {
  if (result.kind === "contract") {
    const d = result.doc;
    return (
      <>
        <p className="max-w-3xl text-[14.5px] text-foreground">{d.conclusion}</p>
        {(d.figures ?? []).some(figureSupported) && (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {(d.figures ?? []).filter(figureSupported).slice(0, 2).map((f) => <FigureChart key={f.id} figure={f} />)}
          </div>
        )}
        <div className="mt-4"><MetricTable metrics={d.metrics} pooledFirst /></div>
        {d.caveats && d.caveats.length > 0 && (
          <details className="mt-3 text-[13px] text-muted-foreground">
            <summary className="cursor-pointer text-foreground">Caveats and methods</summary>
            <ul className="mt-2 list-disc pl-5 space-y-1">{d.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
            <p className="mt-2 whitespace-pre-line">{d.methods.replace(/\*\*/g, "")}</p>
          </details>
        )}
        <SourceLine source={{ repo: "https://github.com/Singlet-Bio/singlet", commit: d.singlet.commit }} measured={d.generated_at.slice(0, 10)} />
      </>
    );
  }
  return (
    <>
      <p className="max-w-3xl text-[14.5px] text-foreground">{result.conclusion}</p>
      {result.headline.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {result.headline.map((h) => <Stat key={h.label} value={h.value} label={h.label} detail={h.detail} />)}
        </div>
      )}
      {result.tables.map((t) => (
        <div key={t.title} className="mt-5 overflow-x-auto">
          <p className="mb-2 text-[13px] font-medium text-foreground">{t.title}</p>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[12px] uppercase tracking-wider text-muted-foreground">
                {t.columns.map((c) => <th key={c} className="py-2 pr-4 font-medium">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r, i) => (
                <tr key={i} className="border-b border-border/60 tabular">
                  {r.map((v, j) => <td key={j} className="py-1.5 pr-4">{v ?? "n/a"}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {t.note && <p className="mt-2 text-[12px] text-muted-foreground">{t.note}</p>}
        </div>
      ))}
      {result.caveats.length > 0 && (
        <ul className="mt-4 list-disc pl-5 text-[13px] text-muted-foreground">
          {result.caveats.map((c) => <li key={c}>{c}</li>)}
        </ul>
      )}
      <SourceLine source={result.source} measured={result.measuredAt} />
    </>
  );
}

/** One Alpha measurement panel: "Benchmark running" until at least one of its files is published. */
export function AlphaPendingPanel({ id, name, what, files, note }: { id: string; name: string; what: string; files: readonly string[]; note?: ReactNode }) {
  const { data, isLoading } = useQuery({ queryKey: ["alpha-benchmark", ...files], queryFn: ({ signal }) => loadAlphaPanel(files, signal), staleTime: 5 * 60_000 });
  if (isLoading) return <div className="h-32 rounded bg-secondary animate-pulse" aria-hidden="true" />;
  if (!data?.length) return <Running name={name} what={what} />;
  return (
    <Panel title={name} id={`alpha-${id}`}>
      {note && <p className="mb-4 max-w-3xl text-[13.5px] text-muted-foreground">{note}</p>}
      <div className="space-y-8">
        {data.map((r, i) => (
          <div key={i}>
            <h4 className="mb-2 text-[14.5px] font-semibold text-foreground">{r.kind === "contract" ? r.doc.title : r.title}</h4>
            <AlphaResultView result={r} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** The scBaseCount comparison, loaded from its JSON. */
export function ScbcSection() {
  const { data, isLoading } = useQuery({ queryKey: ["alpha-benchmark", "scbasecount"], queryFn: ({ signal }) => loadScbc(signal), staleTime: 5 * 60_000 });
  if (isLoading) return <div className="mt-8 h-64 rounded bg-secondary animate-pulse" aria-hidden="true" />;
  if (!data) return <div className="mt-8"><Running name="Alpha against scBaseCount and Cell Ranger" what="Coverage, cell recovery, depth and gene-profile agreement on shared samples." /></div>;
  return <ScbcPanels doc={data} />;
}

const ANNOTATION_DOC = "https://github.com/Singlet-Bio/singlet/blob/main/docs/cell_annotation.md";

/** Per-cell labels in Alpha and their measured accuracy (singlet-bio docs/cell_annotation.md). Shown once the labels are served. */
export function AnnotationsPanel() {
  return (
    <Panel title="Annotations" id="alpha-annotations">
      <p className="max-w-3xl text-[14px] text-muted-foreground">
        Per-cell labels from Singlet's validated labeller. Accuracy is measured on real data with independent labels; the evidence
        is small, so read these as early numbers.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat value="0.84" label="cell-type accuracy, compartment level" detail="16 studies with curated labels, per study" />
        <Stat value="0.75" label="lineage level" detail="cell type 0.43, subtype 0.32: deeper levels are a preview" />
        <Stat value="98.1%" label="of samples agree with GEO sex metadata" detail="153 of 156 called, of 157 samples; the 3 disagreements were GEO errors" />
        <Stat value="22" label="real donors in the ancestry check" detail="with self-reported ancestry; donors simulated from 1000 Genomes corroborate only" />
      </div>
      <ul className="mt-4 max-w-3xl list-disc pl-5 space-y-1 text-[13.5px] text-muted-foreground">
        <li>Cell type: Cell Ontology labels. A cell stops at the deepest level its evidence supports.</li>
        <li>Chromosomal sex: human and mouse. Some cells stay "ambiguous".</li>
        <li>
          Genetic ancestry: continental HANCESTRO groups, only for human donors with enough genotype coverage, a minority of
          studies. Mixed ancestry is reported as "admixed". No genotypes are published.
        </li>
      </ul>
      <p className="mt-3 text-[12px] text-muted-foreground">
        Source:{" "}
        <a href={ANNOTATION_DOC} target="_blank" rel="noopener noreferrer" className="font-mono text-primary underline underline-offset-2">
          docs/cell_annotation.md
        </a>
      </p>
    </Panel>
  );
}

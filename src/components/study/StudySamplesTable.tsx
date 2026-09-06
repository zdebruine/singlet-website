import { Fragment, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, ChevronRight, Copy, ExternalLink, ListFilter, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FLAGGED_CELLS_LABEL,
  failureDetail,
  failureLabel,
  fmtBytes,
  fmtInt,
  fmtPct,
  isFailed,
  isProcessed,
  protocolLabel,
} from "@/lib/catalog-display";
import { conditionPairs } from "@/components/browse/SampleTable";
import type { GsmRow, SampleQc } from "@/integrations/api/types";
import type { ConditionFilter } from "./ConditionsPanel";

type SortCol = "gsm_id" | "status" | "n_cells" | "n_cells_called" | "mapping_rate" | "median_genes" | "assay" | "n_input_reads" | "seq_saturation";
type StatusFilter = "all" | "processed" | "failed";

const INITIAL_ROWS = 150;

interface Props {
  gseId: string;
  studyTitle: string | null;
  samples: GsmRow[];
  highlightGsm: string | null;
  condition: ConditionFilter | null;
  onClearCondition: () => void;
  /** Per-sample QC read straight from the published file, keyed by gsm_id (upper-cased). */
  qcByGsm?: Record<string, SampleQc>;
}

function gsmNumber(id: string): number {
  const n = parseInt(id.replace(/^GSM/i, ""), 10);
  return isNaN(n) ? 0 : n;
}

function statusRank(s: GsmRow): number {
  if (s.status === "DONE") return 0;
  if (s.status === "DONE_QC_WARN") return 1;
  if (s.status === "FAIL") return 2;
  if (s.status === "HARD_FAIL") return 3;
  return 4;
}

function StatusCell({ s }: { s: GsmRow }) {
  if (s.status === "DONE") return <span className="status-ok">processed</span>;
  if (s.status === "DONE_QC_WARN") return <span className="flag" title="Processed, but one or more QC metrics are outside the usual range">QC warning</span>;
  if (isFailed(s.status)) {
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <span className="status-fail">failed</span>
        {s.failure_category && (
          <span className="text-[11px] text-muted-foreground leading-tight" title={failureDetail(s.failure_category) ?? undefined}>
            {failureLabel(s.failure_category)}
          </span>
        )}
      </span>
    );
  }
  return <span className="chip h-6 text-xs">{s.status.toLowerCase()}</span>;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        })
      }
      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      aria-label={label}
      title={label}
    >
      {copied ? <Check size={11} className="text-primary" /> : <Copy size={11} />}
    </button>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-[13px] text-foreground mt-0.5 break-words">{children}</dd>
    </div>
  );
}

function ExpandedRow({ s, gseId, studyTitle, colSpan, qc }: { s: GsmRow; gseId: string; studyTitle: string | null; colSpan: number; qc?: SampleQc }) {
  const ch = s.characteristics ?? {};
  const chEntries = Object.entries(ch);
  const ownTitle = s.title && s.title.trim() !== (studyTitle ?? "").trim() ? s.title : null;
  const processed = isProcessed(s.status);
  const hasQc = s.mapping_rate != null || s.median_genes != null || s.median_umis != null || s.mt_pct != null;
  const py = `adata[adata.obs["gsm_id"] == "${s.gsm_id}"]`;
  const r = `sce[, sce$gsm_id == "${s.gsm_id}"]`;

  return (
    <tr className="bg-background/70" id={`${s.gsm_id}-details`}>
      <td colSpan={colSpan} className="!py-4 !px-4">
        <div className="grid gap-x-8 gap-y-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            <div>
              <h4 className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">GEO characteristics</h4>
              {chEntries.length ? (
                <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px]">
                  {chEntries.map(([k, v]) => (
                    <Fragment key={k}>
                      <dt className="text-muted-foreground whitespace-nowrap">{k}</dt>
                      <dd className="text-foreground break-words">{v || "—"}</dd>
                    </Fragment>
                  ))}
                </dl>
              ) : (
                <p className="text-[13px] text-muted-foreground">None recorded on GEO.</p>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              <Detail label="Source">{s.source ?? "—"}</Detail>
              {ownTitle && <Detail label="Sample title">{ownTitle}</Detail>}
              <Detail label="Assay">{s.assay_family ?? protocolLabel(s.protocol)}{s.protocol && s.assay_family ? <span className="text-muted-foreground"> · {s.protocol}</span> : null}</Detail>
              {s.modality && <Detail label="Modality">{s.modality}</Detail>}
              {s.sex && <Detail label="Sex">{s.sex}</Detail>}
              {s.donor_id && <Detail label="Donor">{s.donor_id}</Detail>}
              {s.disease && <Detail label="Disease">{s.disease}</Detail>}
            </dl>
          </div>

          <div className="min-w-0 space-y-4">
            <div>
              <h4 className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Processing</h4>
              {isFailed(s.status) ? (
                <div className="warning-surface px-3 py-2 text-[13px]">
                  <p className="font-medium">{failureLabel(s.failure_category)}</p>
                  <p className="mt-0.5 text-warning/90">{s.failure_detail || failureDetail(s.failure_category) || "This sample did not complete the pipeline and is not in the file."}</p>
                </div>
              ) : hasQc ? (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                  <Detail label="Cells">
                    {s.suspect_cells ? <span className="flag font-sans">{FLAGGED_CELLS_LABEL}</span> : <span className="font-mono tabular">{fmtInt(s.n_cells)}</span>}
                  </Detail>
                  <Detail label="Mapped"><span className="font-mono tabular">{fmtPct(s.mapping_rate)}</span></Detail>
                  <Detail label="Median genes"><span className="font-mono tabular">{fmtInt(s.median_genes)}</span></Detail>
                  <Detail label="Median UMIs"><span className="font-mono tabular">{fmtInt(s.median_umis)}</span></Detail>
                  {s.mt_pct != null && <Detail label="Mito %"><span className="font-mono tabular">{fmtPct(s.mt_pct > 1 ? s.mt_pct / 100 : s.mt_pct)}</span></Detail>}
                </dl>
              ) : (
                <p className="text-[13px] text-muted-foreground">No QC metrics recorded for this sample.</p>
              )}
              {(s.singlet_version || s.pipeline_date || s.pz_size_bytes != null) && (
                <p className="mt-2 text-[12px] text-muted-foreground">
                  {[
                    s.singlet_version ? `pipeline ${s.singlet_version}` : null,
                    s.pipeline_date ? `run ${s.pipeline_date}` : null,
                    s.pz_size_bytes != null ? `${fmtBytes(s.pz_size_bytes)} in file` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>

            {qc && (
              <div>
                <h4 className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">QC from the published file</h4>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                  {qc.n_input_reads != null && <Detail label="Input reads"><span className="font-mono tabular">{fmtInt(qc.n_input_reads)}</span></Detail>}
                  {qc.uniquely_mapped_pct != null && <Detail label="Uniquely mapped"><span className="font-mono tabular">{fmtPct(qc.uniquely_mapped_pct)}</span></Detail>}
                  {qc.n_cells_called != null && <Detail label="Cells called"><span className="font-mono tabular">{fmtInt(qc.n_cells_called)}</span></Detail>}
                  {qc.median_umi != null && <Detail label="Median UMI"><span className="font-mono tabular">{fmtInt(qc.median_umi)}</span></Detail>}
                  {qc.median_genes != null && <Detail label="Median genes"><span className="font-mono tabular">{fmtInt(qc.median_genes)}</span></Detail>}
                  {qc.exonic_fraction != null && <Detail label="Exonic"><span className="font-mono tabular">{fmtPct(qc.exonic_fraction)}</span></Detail>}
                  {qc.intronic_fraction != null && <Detail label="Intronic"><span className="font-mono tabular">{fmtPct(qc.intronic_fraction)}</span></Detail>}
                  {qc.sequencing_saturation != null && <Detail label="Seq. saturation"><span className="font-mono tabular">{fmtPct(qc.sequencing_saturation)}</span></Detail>}
                  {qc.median_mito_fraction != null && <Detail label="Median mito"><span className="font-mono tabular">{fmtPct(qc.median_mito_fraction)}</span></Detail>}
                  {qc.fraction_reads_in_cells != null && <Detail label="Reads in cells"><span className="font-mono tabular">{fmtPct(qc.fraction_reads_in_cells)}</span></Detail>}
                  {qc.total_genes_detected != null && <Detail label="Genes detected"><span className="font-mono tabular">{fmtInt(qc.total_genes_detected)}</span></Detail>}
                  {qc.reference_build && <Detail label="Reference">{qc.reference_build}</Detail>}
                </dl>
              </div>
            )}

            {processed && (
              <div>
                <h4 className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Select this sample after loading {gseId}</h4>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <code className="code-inline text-[12px] truncate">{py}</code>
                    <CopyButton text={py} label="Copy Python selection" />
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <code className="code-inline text-[12px] truncate">{r}</code>
                    <CopyButton text={r} label="Copy R selection" />
                  </div>
                </div>
              </div>
            )}

            <div>
              <h4 className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Source records</h4>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                <li>
                  <a href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${s.gsm_id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    GEO {s.gsm_id} <ExternalLink size={10} />
                  </a>
                </li>
                {s.srr_ids.slice(0, 12).map((srr) => (
                  <li key={srr}>
                    <a href={`https://trace.ncbi.nlm.nih.gov/Traces/?view=run_browser&acc=${srr}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-primary hover:underline">
                      {srr} <ExternalLink size={10} />
                    </a>
                  </li>
                ))}
                {s.srr_ids.length > 12 && <li className="text-muted-foreground">+{s.srr_ids.length - 12} more runs</li>}
                {s.srr_ids.length === 0 && <li className="text-muted-foreground">No SRA runs recorded</li>}
              </ul>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

export function StudySamplesTable({ gseId, studyTitle, samples, highlightGsm, condition, onClearCondition, qcByGsm }: Props) {
  const [sortCol, setSortCol] = useState<SortCol>("gsm_id");
  const [sortAsc, setSortAsc] = useState(true);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);

  const hasQc = useMemo(() => samples.some((s) => s.mapping_rate != null || s.median_genes != null), [samples]);
  const hasReads = useMemo(() => !!qcByGsm && samples.some((s) => qcByGsm[s.gsm_id.toUpperCase()]?.n_input_reads != null), [samples, qcByGsm]);
  const hasCellsCalled = useMemo(() => !!qcByGsm && samples.some((s) => qcByGsm[s.gsm_id.toUpperCase()]?.n_cells_called != null), [samples, qcByGsm]);
  const hasSaturation = useMemo(() => !!qcByGsm && samples.some((s) => qcByGsm[s.gsm_id.toUpperCase()]?.sequencing_saturation != null), [samples, qcByGsm]);

  const nProcessed = useMemo(() => samples.filter((s) => isProcessed(s.status)).length, [samples]);
  const nFailed = useMemo(() => samples.filter((s) => isFailed(s.status)).length, [samples]);

  // Auto-expand and reveal the anchored sample.
  useEffect(() => {
    if (!highlightGsm) return;
    if (!samples.some((s) => s.gsm_id.toUpperCase() === highlightGsm)) return;
    setExpanded((prev) => new Set(prev).add(highlightGsm));
    setShowAll(true);
    setStatus("all");
  }, [highlightGsm, samples]);

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else {
      setSortCol(col);
      setSortAsc(col === "gsm_id" || col === "status" || col === "assay");
    }
  };

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rows = useMemo(() => {
    const needle = text.trim().toLowerCase();
    let out = samples.filter((s) => {
      if (status === "processed" && !isProcessed(s.status)) return false;
      if (status === "failed" && !isFailed(s.status)) return false;
      if (condition) {
        const v = s.characteristics?.[condition.key];
        if (!v || v.toLowerCase() !== condition.value.toLowerCase()) return false;
      }
      if (needle) {
        const hay = [
          s.gsm_id,
          s.source,
          s.title,
          s.tissue,
          s.cell_type,
          s.disease,
          s.donor_id,
          s.sex,
          s.protocol,
          s.assay_family,
          ...Object.entries(s.characteristics ?? {}).map(([k, v]) => `${k}: ${v}`),
        ]
          .filter(Boolean)
          .join(" \n ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    out = [...out].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "gsm_id":
          cmp = gsmNumber(a.gsm_id) - gsmNumber(b.gsm_id);
          break;
        case "status":
          cmp = statusRank(a) - statusRank(b) || gsmNumber(a.gsm_id) - gsmNumber(b.gsm_id);
          break;
        case "n_cells":
          cmp = (a.n_cells ?? -1) - (b.n_cells ?? -1);
          break;
        case "mapping_rate":
          cmp = (a.mapping_rate ?? -1) - (b.mapping_rate ?? -1);
          break;
        case "median_genes":
          cmp = (a.median_genes ?? -1) - (b.median_genes ?? -1);
          break;
        case "n_input_reads":
          cmp = ((qcByGsm?.[a.gsm_id.toUpperCase()]?.n_input_reads) ?? -1) - ((qcByGsm?.[b.gsm_id.toUpperCase()]?.n_input_reads) ?? -1);
          break;
        case "seq_saturation":
          cmp = ((qcByGsm?.[a.gsm_id.toUpperCase()]?.sequencing_saturation) ?? -1) - ((qcByGsm?.[b.gsm_id.toUpperCase()]?.sequencing_saturation) ?? -1);
          break;
        case "assay":
          cmp = (a.assay_family ?? a.protocol ?? "").localeCompare(b.assay_family ?? b.protocol ?? "");
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return out;
  }, [samples, status, condition, text, sortCol, sortAsc]);

  const visible = showAll ? rows : rows.slice(0, INITIAL_ROWS);
  const hidden = rows.length - visible.length;

  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sortCol !== col) return <ArrowUpDown size={11} className="opacity-30" />;
    return sortAsc ? <ArrowUp size={11} /> : <ArrowDown size={11} />;
  };

  const columns: { col: SortCol | null; label: string; cls?: string; hidden?: boolean }[] = [
    { col: "gsm_id", label: "Sample" },
    { col: "status", label: "Status" },
    { col: "n_cells", label: hasCellsCalled ? "Cells (catalog)" : "Cells", cls: "num" },
    { col: "n_cells_called", label: "Cells (file)", cls: "num", hidden: !hasCellsCalled },

    { col: "mapping_rate", label: "Mapped", cls: "num", hidden: !hasQc },
    { col: "median_genes", label: "Genes / cell", cls: "num", hidden: !hasQc },
    { col: "n_input_reads", label: "Input reads", cls: "num", hidden: !hasReads },
    { col: "seq_saturation", label: "Seq. saturation", cls: "num", hidden: !hasSaturation },
    { col: "assay", label: "Assay" },
    { col: null, label: "Tissue · cell type" },
    { col: null, label: "Characteristics" },
  ];
  const shownColumns = columns.filter((c) => !c.hidden);
  const colSpan = shownColumns.length + 1;

  const anyFilter = status !== "all" || !!condition || text.trim() !== "";

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div role="group" aria-label="Filter by status" className="inline-flex rounded border border-border bg-card overflow-hidden">
          {(
            [
              ["all", `All (${fmtInt(samples.length)})`],
              ["processed", `Processed (${fmtInt(nProcessed)})`],
              ["failed", `Failed (${fmtInt(nFailed)})`],
            ] as [StatusFilter, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setStatus(v)}
              aria-pressed={status === v}
              className={cn(
                "h-8 px-3 text-[13px] border-r border-border last:border-r-0 transition-colors",
                status === v ? "bg-primary/[0.08] text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-background"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="relative flex-1 min-w-[200px] max-w-[360px]">
          <ListFilter size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="text"
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Filter samples (accession, source, characteristics…)"
            aria-label="Filter samples"
            className="input h-8 pl-8 text-[13px]"
          />
        </label>

        {condition && (
          <button type="button" onClick={onClearCondition} className="chip-active h-8 px-2.5 text-[13px] font-normal" title="Clear this condition filter">
            {condition.key}: {condition.value} <X size={12} />
          </button>
        )}

        <span className="ml-auto text-[12px] text-muted-foreground tabular">
          {anyFilter ? `${fmtInt(rows.length)} of ${fmtInt(samples.length)} samples` : `${fmtInt(samples.length)} samples`}
        </span>
      </div>

      <div className="surface !rounded-none overflow-x-auto">
        <table className="data-table w-full min-w-[900px]">
          <thead>
            <tr>
              <th className="w-8" aria-label="Expand" />
              {shownColumns.map((c) => (
                <th
                  key={c.label}
                  onClick={c.col ? () => toggleSort(c.col as SortCol) : undefined}
                  aria-sort={c.col && sortCol === c.col ? (sortAsc ? "ascending" : "descending") : undefined}
                  className={cn(c.col && "cursor-pointer select-none hover:text-foreground", c.cls)}
                >
                  <span className={cn("inline-flex items-center gap-1", c.cls === "num" && "flex-row-reverse")}>
                    {c.label} {c.col && <SortIcon col={c.col} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="text-center text-muted-foreground py-8">
                  No samples match these filters.
                </td>
              </tr>
            )}
            {visible.map((s) => {
              const failedRow = isFailed(s.status);
              const hl = highlightGsm === s.gsm_id.toUpperCase();
              const open = expanded.has(s.gsm_id.toUpperCase()) || expanded.has(s.gsm_id);
              const pairs = conditionPairs(s.characteristics, 3);
              const nPairs = Object.keys(s.characteristics ?? {}).length;
              const tissueCell = [s.tissue, s.cell_type].filter(Boolean).join(" · ");
              const qc = qcByGsm?.[s.gsm_id.toUpperCase()];
              return (
                <Fragment key={s.gsm_id}>
                  <tr
                    id={s.gsm_id}
                    className={cn("cursor-pointer scroll-mt-24", hl && "bg-primary/[0.06]", failedRow && "text-muted-foreground")}
                    onClick={() => toggleExpanded(s.gsm_id)}
                  >
                    <td className="!pr-0">
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={`${s.gsm_id}-details`}
                        aria-label={`${open ? "Hide" : "Show"} details for ${s.gsm_id}`}
                        className="text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpanded(s.gsm_id);
                        }}
                      >
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    </td>
                    <td className="whitespace-nowrap">
                      <span className="font-mono text-[12.5px] text-foreground">{s.gsm_id}</span>
                      {s.organism_label && <div className="text-[11px] text-muted-foreground">{s.organism_label}</div>}
                    </td>
                    <td>
                      <StatusCell s={s} />
                    </td>
                    <td className={cn("num text-[12.5px]", s.suspect_cells && "text-warning")}>
                      {s.n_cells == null ? (
                        "—"
                      ) : s.suspect_cells ? (
                        <span className="inline-flex items-center gap-1" title="Known plate-protocol counting bug — value under review">
                          <AlertTriangle size={11} /> {fmtInt(s.n_cells)}
                        </span>
                      ) : (
                        fmtInt(s.n_cells)
                      )}
                    </td>
                    {hasQc && <td className="num text-[12.5px]">{fmtPct(s.mapping_rate)}</td>}
                    {hasQc && <td className="num text-[12.5px]">{fmtInt(s.median_genes)}</td>}
                    {hasReads && <td className="num text-[12.5px] font-mono">{fmtInt(qc?.n_input_reads)}</td>}
                    {hasSaturation && <td className="num text-[12.5px] font-mono">{fmtPct(qc?.sequencing_saturation)}</td>}
                    <td className="whitespace-nowrap text-[12.5px]" title={s.protocol ?? undefined}>
                      {s.assay_family ?? protocolLabel(s.protocol)}
                    </td>
                    <td className="text-[12.5px] max-w-[220px]">
                      <div className="truncate" title={tissueCell || undefined}>{tissueCell || <span className="text-muted-foreground">—</span>}</div>
                    </td>
                    <td className="text-[12px] max-w-[320px]">
                      {pairs.length ? (
                        <ul className="space-y-0.5">
                          {pairs.map((p) => (
                            <li key={p} className="truncate text-foreground/80" title={p}>
                              {p}
                            </li>
                          ))}
                          {nPairs > pairs.length && <li className="text-muted-foreground">+{nPairs - pairs.length} more</li>}
                        </ul>
                      ) : s.source ? (
                        <span className="text-muted-foreground truncate block" title={s.source}>{s.source}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                  {open && <ExpandedRow s={s} gseId={gseId} studyTitle={studyTitle} colSpan={colSpan} qc={qc} />}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {hidden > 0 && (
        <div className="flex justify-center py-3">
          <button type="button" onClick={() => setShowAll(true)} className="btn-secondary btn-sm">
            Show all {fmtInt(rows.length)} samples
          </button>
        </div>
      )}
    </div>
  );
}

export default StudySamplesTable;

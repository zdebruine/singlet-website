import { forwardRef, useState } from "react";
import { Check, Copy, Download, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtBytes, fmtCompact, fmtInt } from "@/lib/catalog-display";
import { bundleUrl } from "@/integrations/api/client";
import { PY_INSTALL, R_INSTALL } from "@/lib/install-snippets";
import type { Selection } from "./useSelection";

type Tab = "python" | "r" | "curl";

const TABS: { id: Tab; label: string }[] = [
  { id: "python", label: "Python" },
  { id: "r", label: "R" },
  { id: "curl", label: "curl" },
];

export function snippetFor(tab: Tab, ids: string[]): string {
  if (tab === "python") {
    if (ids.length === 1) return `# ${PY_INSTALL}\nimport singlet\nadata = singlet.load("${ids[0]}")`;
    return `# ${PY_INSTALL}\nimport singlet\nids = [${ids.map((i) => `"${i}"`).join(", ")}]\nadatas = {g: singlet.load(g) for g in ids}`;
  }
  if (tab === "r") {
    if (ids.length === 1) return `# ${R_INSTALL}\nlibrary(singlet)\nsce <- load("${ids[0]}")`;
    return `# ${R_INSTALL}\nlibrary(singlet)\nids <- c(${ids.map((i) => `"${i}"`).join(", ")})\nsces <- lapply(ids, load)`;
  }
  return ids.map((i) => `curl -O ${bundleUrl(i)}`).join("\n");
}

/** Trigger several downloads without a popup per file (hidden iframes). */
function downloadAll(ids: string[]) {
  ids.forEach((id, i) => {
    setTimeout(() => {
      const f = document.createElement("iframe");
      f.style.display = "none";
      f.src = bundleUrl(id);
      document.body.appendChild(f);
      setTimeout(() => f.remove(), 60_000);
    }, i * 400);
  });
}

interface Props {
  selection: Selection;
  className?: string;
}

export const SelectionBar = forwardRef<HTMLDivElement, Props>(function SelectionBar({ selection, className }, ref) {
  const [tab, setTab] = useState<Tab>("python");
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { items, totals, clear, toggle } = selection;
  if (!items.length) return null;

  const ids = items.map((i) => i.gse_id);
  const code = snippetFor(tab, ids);
  const downloadable = items.filter((i) => i.has_bundle).map((i) => i.gse_id);

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={cn("fixed inset-x-0 bottom-0 z-30 border-t border-dark-border surface-dark outline-none", className)}
      role="region"
      aria-label="Selected studies"
    >
      <div className="container-site py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[13px] font-medium text-dark-foreground hover:text-white"
            aria-expanded={expanded}
          >
            {fmtInt(totals.studies)} {totals.studies === 1 ? "study" : "studies"} selected
            <span className="text-dark-muted font-normal">
              {" "}
              · {fmtCompact(totals.cells)} cells
              {totals.bytes > 0 && ` · ${fmtBytes(totals.bytes)}`}
            </span>
          </button>

          <div className="flex items-center rounded border border-dark-border overflow-hidden" role="tablist" aria-label="Snippet language">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "h-7 px-3 text-[12px] font-medium transition-colors",
                  tab === t.id ? "bg-white/10 text-white" : "text-dark-muted hover:text-dark-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={copy} className="btn-secondary btn-sm !bg-transparent !text-dark-foreground !border-dark-border hover:!bg-white/5">
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={() => downloadAll(downloadable)}
              disabled={!downloadable.length}
              className="btn-primary btn-sm"
              title={downloadable.length < ids.length ? `${ids.length - downloadable.length} selected studies have no file yet` : undefined}
            >
              <Download size={13} />
              Download {fmtInt(downloadable.length)} {downloadable.length === 1 ? "file" : "files"}
            </button>
            <button type="button" onClick={clear} className="btn-ghost !text-dark-muted hover:!text-white hover:!bg-white/5" aria-label="Clear selection">
              <X size={14} />
            </button>
          </div>
        </div>

        <pre className="mt-2.5 font-mono text-[12.5px] leading-[1.55] text-dark-foreground whitespace-pre overflow-x-auto max-h-[112px]">{code}</pre>

        {expanded && (
          <ul className="mt-2 flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto">
            {items.map((i) => (
              <li key={i.gse_id}>
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  className="inline-flex items-center gap-1 rounded border border-dark-border px-2 h-6 font-mono text-[11px] text-dark-foreground hover:bg-white/5"
                  title={i.title ?? i.gse_id}
                >
                  {i.gse_id}
                  <X size={10} className="text-dark-muted" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});

export default SelectionBar;

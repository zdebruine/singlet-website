/**
 * Export button for /browse: bulk manifest of the current search (up to
 * 2,000 studies), in a few formats, plus the existing accession list.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileJson, FileText, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtInt } from "@/lib/catalog-display";
import { apiClient } from "@/integrations/api/client";
import type { SearchQuery } from "@/integrations/api/types";

const MANIFEST_CAP = 2000;

interface Item {
  format: "tsv" | "json" | "curl" | "wget" | "python" | "r";
  label: string;
  hint: string;
  icon: React.ReactNode;
}

const MANIFEST_ITEMS: Item[] = [
  { format: "tsv", label: "Manifest (TSV)", hint: "Spreadsheet-friendly table", icon: <FileText size={13} /> },
  { format: "json", label: "Manifest (JSON)", hint: "For scripts", icon: <FileJson size={13} /> },
  { format: "curl", label: "Download script (curl)", hint: "Fetches every file", icon: <Terminal size={13} /> },
  { format: "wget", label: "Download script (wget)", hint: "Fetches every file", icon: <Terminal size={13} /> },
  { format: "python", label: "Download script (Python)", hint: "Uses the singlet package", icon: <Terminal size={13} /> },
  { format: "r", label: "Download script (R)", hint: "Uses the singlet package", icon: <Terminal size={13} /> },
];

interface Props {
  query: SearchQuery;
  total: number;
  accessionsHref: string;
  className?: string;
}

export function ExportMenu({ query, total, accessionsHref, className }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (total <= 0) return null;

  const exported = Math.min(total, MANIFEST_CAP);
  const capped = total > MANIFEST_CAP;

  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        type="button"
        className="btn-secondary btn-sm"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Download size={13} />
        Export
        <ChevronDown size={12} className={cn("transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Export current search"
          className="surface absolute right-0 top-full mt-1.5 z-30 w-[300px] py-1.5"
        >
          <div className="px-3 py-1.5 text-[12px] text-muted-foreground border-b border-border mb-1">
            {fmtInt(exported)} {exported === 1 ? "study" : "studies"} match{capped && ` (of ${fmtInt(total)})`}
            {capped && (
              <div className="mt-0.5 text-warning">Manifest exports are capped at {fmtInt(MANIFEST_CAP)} studies; narrow your filters to include the rest.</div>
            )}
          </div>

          {MANIFEST_ITEMS.map((item) => (
            <a
              key={item.format}
              role="menuitem"
              href={apiClient.manifestUrl(query, item.format)}
              onClick={() => setOpen(false)}
              className="flex items-start gap-2 px-3 py-1.5 text-[13px] text-foreground hover:bg-secondary transition-colors"
            >
              <span className="mt-0.5 text-muted-foreground">{item.icon}</span>
              <span className="min-w-0">
                <span className="block font-medium">{item.label}</span>
                <span className="block text-[11.5px] text-muted-foreground">{item.hint}</span>
              </span>
            </a>
          ))}

          <div className="mt-1 border-t border-border pt-1">
            <a
              role="menuitem"
              href={accessionsHref}
              download="singlet-accessions.txt"
              onClick={() => setOpen(false)}
              className="flex items-start gap-2 px-3 py-1.5 text-[13px] text-foreground hover:bg-secondary transition-colors"
            >
              <span className="mt-0.5 text-muted-foreground">
                <FileText size={13} />
              </span>
              <span className="min-w-0">
                <span className="block font-medium">Accession list (.txt)</span>
                <span className="block text-[11.5px] text-muted-foreground">Just the GSE IDs, up to 5,000</span>
              </span>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export default ExportMenu;

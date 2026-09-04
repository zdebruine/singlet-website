/**
 * DownloadPanel — download UX for a study's .singlet bundle.
 *
 * Shows the bundle size, license note, a Download button (public R2 URL), and
 * copy-able Python / R / curl one-liners. Only per-study (GSE) bundles exist.
 */
import { Download } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { CodeBlock } from "@/components/CodeBlock";
import { fmtBytes } from "@/lib/catalog-display";

const R2_BASE = (import.meta.env.VITE_R2_PUBLIC_URL as string | undefined) ?? "https://data.singlet.bio";

interface DownloadPanelProps {
  /** GSE accession */
  accession: string;
  /** R2 object key — null means no bundle has been published yet */
  r2BundleKey: string | null | undefined;
  /** Bundle size in bytes */
  r2BundleBytes: number | null | undefined;
  /** Single-column layout for a narrow sidebar. */
  stacked?: boolean;
  className?: string;
}

export function DownloadPanel({ accession, r2BundleKey, r2BundleBytes, stacked = false, className }: DownloadPanelProps) {
  const downloadUrl = r2BundleKey ? `${R2_BASE}/${r2BundleKey}` : null;
  // In the narrow sidebar the trailing comments don't fit; drop them there.
  const py = stacked
    ? `import singlet\nadata = singlet.load("${accession}")`
    : `import singlet\nadata = singlet.load("${accession}")   # AnnData`;
  const r = stacked
    ? `library(singlet)\nsce <- load("${accession}")`
    : `library(singlet)\nsce <- load("${accession}")   # SingleCellExperiment`;
  const curl = downloadUrl ? `curl -L "${downloadUrl}" -o "${accession}.singlet"` : `# No bundle published yet for ${accession}`;

  return (
    <div className={cn("surface overflow-hidden", className)}>
      <div className={cn("px-4 py-3 border-b border-border flex gap-3", stacked ? "flex-col" : "items-center justify-between flex-wrap")}>
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[13px] text-muted-foreground min-w-0">
          <span className="font-mono text-foreground truncate">{accession}.singlet</span>
          {downloadUrl && <span className="tabular">{r2BundleBytes != null ? fmtBytes(r2BundleBytes) : "size unknown"}</span>}
          <span aria-hidden="true">·</span>
          <Link to="/data-license" className="hover:text-foreground">CC0</Link>
          {!stacked && (
            <>
              <span aria-hidden="true">·</span>
              <span>Cloudflare R2, no egress fees</span>
            </>
          )}
        </div>
        {downloadUrl ? (
          <a href={downloadUrl} download className={cn("btn-primary", stacked ? "w-full" : "btn-sm")}>
            <Download size={14} /> Download{stacked && r2BundleBytes != null ? ` · ${fmtBytes(r2BundleBytes)}` : ""}
          </a>
        ) : (
          <span className="flag self-start">File not built yet</span>
        )}
      </div>
      <div className={cn("p-4 grid gap-3", stacked ? "grid-cols-1" : "md:grid-cols-2")}>
        <CodeBlock code={py} label="python" compact />
        <CodeBlock code={r} label="r" compact />
        <CodeBlock code={curl} label="curl" compact wrap={stacked} className={cn(!stacked && "md:col-span-2")} />
      </div>
      {downloadUrl ? (
        <p className="px-4 pb-3 text-xs text-muted-foreground leading-relaxed">
          One file holds every processed sample in the study; select samples with <code className="code-inline">gsm_id</code> after
          loading. <Link to="/docs#singlet-file" className="text-primary hover:underline">What's inside →</Link>
        </p>
      ) : (
        <p className="px-4 pb-3 text-xs text-muted-foreground leading-relaxed">
          The samples are processed but the study file hasn't been assembled yet, so <code className="code-inline">load("{accession}")</code> will
          not work until it is. Files are built in batches; check back soon.
        </p>
      )}
    </div>
  );
}

export default DownloadPanel;

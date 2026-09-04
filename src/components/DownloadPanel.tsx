/**
 * DownloadPanel — download UX for a study's .singlet bundle.
 *
 * Shows the bundle size, license note, a Download button (public R2 URL), and
 * copy-able Python / R / curl one-liners. Only per-study (GSE) bundles exist.
 */
import { Download } from "lucide-react";
import { Link } from "react-router-dom";
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
}

export function DownloadPanel({ accession, r2BundleKey, r2BundleBytes }: DownloadPanelProps) {
  const downloadUrl = r2BundleKey ? `${R2_BASE}/${r2BundleKey}` : null;
  const py = `import singlet\nadata = singlet.load("${accession}")   # AnnData`;
  const r = `library(singlet)\nsce <- load("${accession}")   # SingleCellExperiment`;
  const curl = downloadUrl ? `curl -L "${downloadUrl}" -o "${accession}.singlet"` : `# No bundle published yet for ${accession}`;

  return (
    <div className="surface overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
          <span className="font-mono text-foreground">{accession}.singlet</span>
          <span>{r2BundleBytes != null ? fmtBytes(r2BundleBytes) : "size unknown"}</span>
          <span aria-hidden="true">·</span>
          <span>CC0</span>
          <span aria-hidden="true">·</span>
          <span>Cloudflare R2, no egress fees</span>
        </div>
        {downloadUrl ? (
          <a href={downloadUrl} download className="btn-primary btn-sm">
            <Download size={14} /> Download
          </a>
        ) : (
          <span className="flag">No bundle published yet</span>
        )}
      </div>
      <div className="p-4 grid md:grid-cols-2 gap-3">
        <CodeBlock code={py} label="python" compact />
        <CodeBlock code={r} label="r" compact />
        <CodeBlock code={curl} label="curl" compact className="md:col-span-2" />
      </div>
      <p className="px-4 pb-3 text-xs text-muted-foreground">
        The file contains every processed sample in the study; filter on <code className="code-inline">gsm_id</code> after
        loading. <Link to="/docs#singlet-file" className="text-primary hover:underline">What's inside →</Link>
      </p>
    </div>
  );
}

export default DownloadPanel;

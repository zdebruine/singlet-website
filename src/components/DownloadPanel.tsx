/**
 * DownloadPanel — reusable download UX for .singlet bundles.
 *
 * Shows:
 *  - .singlet format badge + size + CC0 / $0 egress note
 *  - [Download] button (R2 URL from VITE_R2_PUBLIC_URL + r2_bundle_key)
 *  - Python copy-paste snippet
 *  - curl command
 *
 * R2 is not yet live — the URL will 404 until provisioned; that's expected.
 */
import { useState } from "react";
import { Download, Copy, Check, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

const R2_BASE = (import.meta.env.VITE_R2_PUBLIC_URL as string | undefined) ?? "https://data.singlet.bio";

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "unknown size";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

interface DownloadPanelProps {
  /** GSE or GSM accession — used in the code snippet */
  accession: string;
  /** R2 object key — null means no bundle yet */
  r2BundleKey: string | null | undefined;
  /** Bundle size in bytes */
  r2BundleBytes: number | null | undefined;
}

export function DownloadPanel({ accession, r2BundleKey, r2BundleBytes }: DownloadPanelProps) {
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);

  const downloadUrl = r2BundleKey ? `${R2_BASE}/${r2BundleKey}` : null;
  const pythonSnippet = `import singlet\n\n# Load directly — streams from Cloudflare R2\nadata = singlet.load("${accession}")\nprint(adata)`;
  const curlLine = downloadUrl
    ? `curl -L "${downloadUrl}" -o "${accession}.singlet"`
    : `# Bundle not yet available for ${accession}`;

  const copyText = (text: string, setCopied: (v: boolean) => void) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-muted/20 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-mono font-semibold">.singlet</span>
          <span className="text-xs text-muted-foreground">{formatBytes(r2BundleBytes)}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">License: <span className="font-medium text-foreground">CC0</span></span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">Egress: <span className="font-medium text-emerald-600">$0 (Cloudflare R2)</span></span>
        </div>
        <div className="flex items-center gap-2">
          {downloadUrl ? (
            <a
              href={downloadUrl}
              download
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Download size={14} /> Download
            </a>
          ) : (
            <button
              disabled
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-muted text-muted-foreground text-sm font-medium cursor-not-allowed"
              title="Bundle not yet provisioned on R2"
            >
              <Download size={14} /> Download
            </button>
          )}
          {!downloadUrl && (
            <span className="text-xs text-amber-600 font-medium">R2 not yet provisioned</span>
          )}
        </div>
      </div>

      {/* Python snippet */}
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Python</span>
          <button
            onClick={() => copyText(pythonSnippet, setCopiedSnippet)}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-muted transition-colors"
          >
            {copiedSnippet ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
          </button>
        </div>
        <div className="rounded-lg bg-background border border-border p-3 font-mono text-xs text-muted-foreground leading-6 overflow-x-auto whitespace-pre">
          {pythonSnippet}
        </div>
        <p className="text-[10px] text-muted-foreground/60 mt-1">
          <Link to="/docs/access" className="underline hover:text-primary">Python · R · curl quickstart →</Link>
        </p>
      </div>

      {/* curl command */}
      <div className="px-6 py-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">curl</span>
          <button
            onClick={() => copyText(curlLine, setCopiedCurl)}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-muted transition-colors"
          >
            {copiedCurl ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
          </button>
        </div>
        <div className="rounded-lg bg-background border border-border p-3 font-mono text-xs text-foreground overflow-x-auto">
          {curlLine}
        </div>
      </div>
    </div>
  );
}

export default DownloadPanel;

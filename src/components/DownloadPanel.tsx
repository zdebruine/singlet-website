/**
 * DownloadPanel — download UX for a study's .singlet bundle.
 *
 * Shows the bundle size, license note, a Download button (public data URL),
 * and copy-able Python / R / curl one-liners. Only per-study (GSE) bundles exist.
 */
import { useState } from "react";
import { Download } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { CodeBlock } from "@/components/CodeBlock";

type Lang = "python" | "r" | "curl";
const LANGS: { id: Lang; label: string }[] = [
  { id: "python", label: "Python" },
  { id: "r", label: "R" },
  { id: "curl", label: "curl" },
];
const LANG_KEY = "singlet:lang";

/** The visitor's snippet language, remembered in this browser. */
function useLanguage(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const v = window.localStorage.getItem(LANG_KEY);
      return v === "r" || v === "curl" ? v : "python";
    } catch {
      return "python";
    }
  });
  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(LANG_KEY, l);
    } catch {
      /* storage blocked */
    }
  };
  return [lang, setLang];
}

interface DownloadPanelProps {
  /** GSE accession */
  accession: string;
  /** Public download URL — null means no bundle has been published yet */
  bundleUrl: string | null | undefined;
  /** Bundle size in bytes */
  bundleBytes: number | null | undefined;
  /** Single-column layout for a narrow sidebar. */
  stacked?: boolean;
  className?: string;
}

export function DownloadPanel({ accession, bundleUrl, bundleBytes, stacked = false, className }: DownloadPanelProps) {
  const downloadUrl = bundleUrl || null;
  const [lang, setLang] = useLanguage();
  // In the narrow sidebar the trailing comments don't fit; drop them there.
  // Install lines live on /docs#install — a pip command never goes in a Python block.
  const py = stacked
    ? `import singlet\nadata = singlet.load("${accession}")`
    : `import singlet\nadata = singlet.load("${accession}")   # AnnData`;
  // singlet::load, not bare load(): the package's load() masks base::load.
  const r = stacked
    ? `library(singlet)\nsce <- singlet::load("${accession}")`
    : `library(singlet)\nsce <- singlet::load("${accession}")   # SingleCellExperiment`;
  const curl = downloadUrl ? `curl -L "${downloadUrl}" -o "${accession}.singlet"` : `# No bundle published yet for ${accession}`;

  return (
    <div className={cn("surface overflow-hidden", className)}>
      <div className={cn("px-4 py-3 border-b border-border flex gap-3", stacked ? "flex-col" : "items-center justify-between flex-wrap")}>
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[13px] text-muted-foreground min-w-0">
          <span className="font-mono text-foreground truncate">{accession}.singlet</span>
          <span aria-hidden="true">·</span>
          <Link to="/data-license" className="hover:text-foreground">CC0</Link>
          {!stacked && (
            <>
              <span aria-hidden="true">·</span>
              <span>no account required</span>
            </>
          )}
        </div>
        {downloadUrl ? (
          <a href={downloadUrl} download className={cn("btn-primary", stacked ? "w-full" : "btn-sm")}>
            <Download size={14} /> Download
          </a>
        ) : (
          <span className="flag self-start">File pending</span>
        )}
      </div>
        // min-w-0 lets each block shrink to its column so long lines scroll inside
        // the block instead of being clipped; the narrow sidebar soft-wraps instead.
        <div className="p-3 space-y-2 [&>*]:min-w-0">
          <div className="inline-flex rounded border border-border overflow-hidden" role="group" aria-label="Language">
            {LANGS.map((l) => (
              <button
                key={l.id}
                type="button"
                aria-pressed={lang === l.id}
                onClick={() => setLang(l.id)}
                className={cn(
                  "h-7 px-3 text-[12px] font-medium border-r border-border last:border-r-0 transition-colors",
                  lang === l.id ? "bg-secondary text-foreground" : "bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
          <CodeBlock code={lang === "python" ? py : lang === "r" ? r : curl} label={lang} compact wrap={stacked} />
        </div>
      {downloadUrl ? (
        <p className="px-4 pb-3 text-xs text-muted-foreground leading-relaxed">
          One file per study; filter by <code className="code-inline">gsm_id</code> after loading.{" "}
          <Link to="/docs#install" className="text-primary hover:underline">Install</Link> ·{" "}
          <Link to="/docs#singlet-file" className="text-primary hover:underline">What's inside →</Link>
        </p>
      ) : (
        <p className="px-4 pb-3 text-xs text-muted-foreground leading-relaxed">
          The samples are processed but the study file is still being assembled, so <code className="code-inline">singlet.load("{accession}")</code> will
          not work until it is. The study will appear in default searches once the file is published.
        </p>
      )}
    </div>
  );
}

export default DownloadPanel;

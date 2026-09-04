import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Dark code block (#0F1F1D, JetBrains Mono, 3px radius) with a copy button.
 * Lines starting with `#` (Python/R/shell comments) are dimmed.
 */
export function CodeBlock({
  code,
  label,
  className,
  compact = false,
  wrap = false,
}: {
  code: string;
  /** Small caption in the header row, e.g. "Python" or "bash". */
  label?: string;
  className?: string;
  compact?: boolean;
  /** Soft-wrap long lines (narrow sidebars) instead of scrolling horizontally. */
  wrap?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };
  const lines = code.replace(/\n$/, "").split("\n");
  return (
    <div className={cn("code-block relative", className)}>
      {(label || true) && (
        <div className="flex items-center justify-between px-3 h-8 border-b border-dark-border">
          <span className="text-[11px] uppercase tracking-wider text-dark-muted font-sans">{label ?? ""}</span>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 text-[11px] font-sans text-dark-muted hover:text-dark-foreground transition-colors rounded px-1.5 h-6"
            aria-label="Copy code"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      <pre
        className={cn(
          "m-0",
          wrap ? "whitespace-pre-wrap break-all" : "overflow-x-auto whitespace-pre",
          compact ? "px-3 py-2.5" : "px-4 py-3.5"
        )}
      >
        {lines.map((line, i) => {
          const t = line.trimStart();
          const isComment = t.startsWith("#") && !t.startsWith("#!");
          // Inline trailing comments: "code   # note"
          const idx = isComment ? -1 : line.indexOf("   #");
          if (!isComment && idx > 0) {
            return (
              <div key={i}>
                {line.slice(0, idx)}
                <span className="tok-comment">{line.slice(idx)}</span>
              </div>
            );
          }
          return (
            <div key={i} className={isComment ? "tok-comment" : undefined}>
              {line.length ? line : " "}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

export default CodeBlock;

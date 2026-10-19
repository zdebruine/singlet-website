import { useState } from "react";
import { Link } from "react-router-dom";
import { Code2, MousePointerClick, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { CodeBlock } from "@/components/CodeBlock";
import { EXAMPLE_GSE, PY_INSTALL, pySnippet, rSnippet } from "@/lib/install-snippets";
import { claudeCodeConfigNoKey } from "@/lib/mcp-snippets";

type Way = "browser" | "code" | "claude";

const WAYS: { id: Way; label: string; icon: typeof Code2 }[] = [
  { id: "browser", label: "In the browser", icon: MousePointerClick },
  { id: "code", label: "Python or R", icon: Code2 },
  { id: "claude", label: "With Claude", icon: Sparkles },
];

/** Three ways to use the atlas; one tab open at a time. */
export function WaysIn() {
  const [way, setWay] = useState<Way>("browser");
  const [lang, setLang] = useState<"python" | "r">("python");

  return (
    <div className="surface p-0 overflow-hidden">
      <div role="tablist" aria-label="Ways to use singlet.bio" className="flex border-b border-border overflow-x-auto no-scrollbar">
        {WAYS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={way === id}
            onClick={() => setWay(id)}
            className={cn(
              "flex-1 min-w-[130px] inline-flex items-center justify-center gap-2 h-12 text-[14px] font-medium border-b-2 -mb-px transition-colors",
              way === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon size={16} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="p-5 md:p-6 text-left min-h-[230px]">
        {way === "browser" && (
          <div className="grid md:grid-cols-2 gap-5 items-start">
            <div>
              <h3 className="text-[16px] font-semibold">Search like you would ask a colleague</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
                Type a question in plain English, a GEO accession or keywords. Filter by organism, tissue, disease, assay and cell
                type, open a study to see its samples and QC, and download the files you pick. No account needed.
              </p>
              <Link to="/browse" className="btn-primary btn-sm mt-4 inline-flex">
                Browse studies
              </Link>
            </div>
            <ol className="space-y-2 text-[13.5px]">
              {["Search or filter", "Open a study: samples, conditions, QC", "Download, or copy the one-line loader"].map((s, i) => (
                <li key={s} className="flex gap-3 items-start">
                  <span className="font-mono text-[12px] text-primary mt-0.5">0{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {way === "code" && (
          <div className="grid md:grid-cols-2 gap-5 items-start">
            <div>
              <h3 className="text-[16px] font-semibold">One line to an AnnData or SingleCellExperiment</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
                The packages download a study once, cache it, and hand back the object your analysis already expects, with the
                sample metadata in <code className="code-inline">obs</code> / <code className="code-inline">colData</code>.
              </p>
              <p className="mt-3 text-[13px]">
                <Link to="/docs#install" className="text-primary hover:underline">Install and API docs →</Link>
              </p>
            </div>
            <div className="min-w-0 space-y-2">
              <div className="inline-flex rounded border border-border overflow-hidden" role="group" aria-label="Language">
                {(["python", "r"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={lang === l}
                    onClick={() => setLang(l)}
                    className={cn("h-7 px-3 text-[12px] font-medium border-r border-border last:border-r-0", lang === l ? "bg-secondary text-foreground" : "bg-card text-muted-foreground")}
                  >
                    {l === "python" ? "Python" : "R"}
                  </button>
                ))}
              </div>
              {lang === "python" && <CodeBlock code={PY_INSTALL} label="bash" wrap compact />}
              <CodeBlock code={lang === "python" ? pySnippet(EXAMPLE_GSE) : rSnippet(EXAMPLE_GSE)} label={lang} compact />
            </div>
          </div>
        )}

        {way === "claude" && (
          <div className="grid md:grid-cols-2 gap-5 items-start">
            <div>
              <h3 className="text-[16px] font-semibold">Ask Claude to find and load data</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
                Connect singlet.bio to Claude and ask for what you need: it searches the atlas, reads each study's samples and QC,
                compares candidates and writes the loading code. It works in Claude.ai, Claude Desktop and Claude Code with a free
                API key.
              </p>
              <p className="mt-3 text-[13px]">
                <Link to="/docs/mcp" className="text-primary hover:underline">Connect Claude →</Link>
              </p>
            </div>
            <div className="min-w-0 space-y-2">
              <p className="text-[12px] text-muted-foreground">Claude Code</p>
              <CodeBlock code={claudeCodeConfigNoKey} label="bash" wrap compact />
              <p className="text-[12.5px] text-muted-foreground">
                Then ask: <span className="text-foreground">“Find human kidney studies with more than 10 donors and load the largest.”</span>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

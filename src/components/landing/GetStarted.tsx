import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Globe, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { CodeBlock } from "@/components/CodeBlock";
import { BUILD_DEPS, EXAMPLE_GSE, PY_INSTALL, R_INSTALL_STANDALONE } from "@/lib/install-snippets";
import { MCP_URL, claudeCodeConfig } from "@/lib/mcp-snippets";

type Tool = "web" | "python" | "r" | "claude";

const KEY = "sk_live_…";

/** A letter badge for tools that have no icon of their own. */
const Badge = ({ children }: { children: ReactNode }) => (
  <span className="grid place-items-center h-7 w-7 rounded-md bg-foreground text-background font-mono text-[13px] font-semibold">{children}</span>
);

const TOOLS: { id: Tool; label: string; icon: ReactNode }[] = [
  { id: "web", label: "Web app", icon: <Globe size={26} strokeWidth={1.6} /> },
  { id: "python", label: "Python", icon: <Badge>Py</Badge> },
  { id: "r", label: "R", icon: <Badge>R</Badge> },
  { id: "claude", label: "Claude", icon: <Sparkles size={26} strokeWidth={1.6} /> },
];

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="min-w-0">
      <p className="flex items-center gap-2 text-[14px] font-semibold">
        <span className="grid place-items-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-[12px]">{n}</span>
        {title}
      </p>
      <div className="mt-2.5 space-y-2 text-[13.5px] text-muted-foreground">{children}</div>
    </li>
  );
}

/** Pick a tool, see three steps. Replaces the old /quickstart page. */
export function GetStarted() {
  const [tool, setTool] = useState<Tool>("python");

  return (
    <div>
      <div role="tablist" aria-label="Choose your tool" className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-[760px] mx-auto">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tool === t.id}
            onClick={() => setTool(t.id)}
            className={cn(
              "flex flex-col items-center justify-center gap-3 h-28 rounded-lg border transition-colors",
              tool === t.id ? "border-primary bg-[var(--teal-50)] text-foreground" : "border-border text-muted-foreground hover:text-foreground hover:border-[var(--cell)]"
            )}
          >
            {t.icon}
            <span className="text-[14px] font-medium">{t.label}</span>
          </button>
        ))}
      </div>

      <ol role="tabpanel" className="mt-10 grid md:grid-cols-3 gap-8 max-w-[1040px] mx-auto text-left">
        {tool === "web" && (
          <>
            <Step n={1} title="Search">
              <p>Ask in plain English, or type a GEO accession.</p>
            </Step>
            <Step n={2} title="Open a study">
              <p>Samples, conditions and QC on one page.</p>
            </Step>
            <Step n={3} title="Download">
              <p>One file per study, no account.</p>
              <Link to="/browse" className="btn-primary btn-sm inline-flex mt-1">Browse studies</Link>
            </Step>
          </>
        )}
        {tool === "python" && (
          <>
            <Step n={1} title="Install">
              <CodeBlock label="bash" code={PY_INSTALL} wrap compact />
              <details>
                <summary className="cursor-pointer text-[12.5px]">Needs a C++17 compiler and zstd</summary>
                <CodeBlock label="bash" code={BUILD_DEPS} compact className="mt-2" />
              </details>
            </Step>
            <Step n={2} title="Load a study">
              <CodeBlock label="python" code={`import singlet\nadata = singlet.load("${EXAMPLE_GSE}")`} compact />
            </Step>
            <Step n={3} title="Find more">
              <CodeBlock label="python" code={`singlet.find("microglia in aging mouse brain")`} compact wrap />
            </Step>
          </>
        )}
        {tool === "r" && (
          <>
            <Step n={1} title="Install">
              <CodeBlock label="r" code={R_INSTALL_STANDALONE} compact wrap />
            </Step>
            <Step n={2} title="Load a study">
              <CodeBlock label="r" code={`library(singlet)\nsce <- singlet::load("${EXAMPLE_GSE}")`} compact />
            </Step>
            <Step n={3} title="Find more">
              <CodeBlock label="r" code={`singlet::find("microglia in aging mouse brain")`} compact wrap />
            </Step>
          </>
        )}
        {tool === "claude" && (
          <>
            <Step n={1} title="Get a free API key">
              <Link to="/account#api-keys" className="btn-primary btn-sm inline-flex">Create a key</Link>
            </Step>
            <Step n={2} title="Connect">
              <p>Claude.ai → Settings → Connectors → Add custom connector:</p>
              <CodeBlock label="url" code={`${MCP_URL}?key=${KEY}`} compact wrap />
              <details>
                <summary className="cursor-pointer text-[12.5px]">Claude Code, Desktop, Cursor, VS Code</summary>
                <CodeBlock label="bash" code={claudeCodeConfig(KEY)} compact wrap className="mt-2" />
                <Link to="/docs/mcp" className="text-primary hover:underline text-[12.5px]">Every client →</Link>
              </details>
            </Step>
            <Step n={3} title="Ask">
              <CodeBlock label="prompt" code={`Find human PBMC COVID-19 studies, check QC, load the best one.`} compact wrap />
            </Step>
          </>
        )}
      </ol>
    </div>
  );
}

import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { CodeBlock } from "@/components/CodeBlock";
import { BUILD_DEPS, EXAMPLE_GSE, PY_INSTALL, R_INSTALL_STANDALONE } from "@/lib/install-snippets";
import { MCP_URL, claudeCodeConfigNoKey } from "@/lib/mcp-snippets";

export type Tool = "web" | "python" | "r" | "claude";
const TOOL_IDS: Tool[] = ["web", "python", "r", "claude"];

const Logo = ({ src }: { src: string }) => <img src={src} alt="" width={30} height={30} className="h-[30px] w-[30px] object-contain" />;

const TOOLS: { id: Tool; label: string; icon: ReactNode }[] = [
  { id: "web", label: "Web app", icon: <Globe size={28} strokeWidth={1.6} /> },
  { id: "python", label: "Python", icon: <Logo src="/logos/python.png" /> },
  { id: "r", label: "R", icon: <Logo src="/logos/r.png" /> },
  { id: "claude", label: "Claude", icon: <Logo src="/logos/claude.png" /> },
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
  const { hash } = useLocation();
  // #get-started/r (from the hero icons) selects the R tab.
  useEffect(() => {
    const want = decodeURIComponent(hash.slice(1)).split("/")[1] as Tool | undefined;
    if (want && TOOL_IDS.includes(want)) setTool(want);
  }, [hash]);

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
              <details>
                <summary className="cursor-pointer text-[12.5px]">Needs a C++17 compiler and zstd</summary>
                <CodeBlock label="bash" code={BUILD_DEPS} compact className="mt-2" />
              </details>
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
            <Step n={1} title="Add the connector">
              <p>Claude → Settings → Connectors → Add custom connector:</p>
              <CodeBlock label="url" code={MCP_URL} compact wrap />
            </Step>
            <Step n={2} title="Sign in">
              <p>Click Connect and sign in with GitHub or Google. No key to copy.</p>
              <details>
                <summary className="cursor-pointer text-[12.5px]">Claude Code, Cursor, VS Code</summary>
                <CodeBlock label="bash" code={claudeCodeConfigNoKey} compact wrap className="mt-2" />
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

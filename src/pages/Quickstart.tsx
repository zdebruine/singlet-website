import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { CodeBlock } from "@/components/CodeBlock";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageMeta } from "@/hooks/usePageMeta";
import { BUILD_DEPS, EXAMPLE_GSE, PY_INSTALL, R_INSTALL_STANDALONE } from "@/lib/install-snippets";
import { MCP_URL, claudeCodeConfig, claudeDesktopConfig, cursorConfig, vscodeConfig } from "@/lib/mcp-snippets";

// One job: from nothing to data loaded in your tool. Everything else lives in /docs.

const KEY_PLACEHOLDER = "sk_live_…";
const GSE = EXAMPLE_GSE;

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="grid place-items-center w-8 h-8 shrink-0 rounded-full bg-primary text-primary-foreground text-[14px] font-semibold">{n}</span>
      <div className="min-w-0 flex-1 pt-1">
        <h3 className="text-[16px] font-semibold">{title}</h3>
        <div className="mt-2 space-y-2 text-[14px] text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

const Steps = ({ children }: { children: React.ReactNode }) => <ol className="space-y-8">{children}</ol>;

const Quickstart = () => {
  usePageMeta({
    title: "Quickstart",
    description: "Load a single-cell study in Python, R, Claude, Cursor or VS Code in three steps.",
    path: "/quickstart",
  });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="container-site flex-1 py-12 md:py-16">
        <div className="max-w-[760px]">
          <p className="type-mono text-primary">Quickstart</p>
          <h1 className="mt-2 text-[34px] md:text-[44px] leading-[1.1] font-semibold tracking-tight">Data in your hands in three steps.</h1>
          <p className="mt-4 text-[17px] text-muted-foreground">Pick your tool. No account needed.</p>

          <Tabs defaultValue="python" className="mt-10">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="python">Python</TabsTrigger>
              <TabsTrigger value="r">R</TabsTrigger>
              <TabsTrigger value="claude">Claude</TabsTrigger>
              <TabsTrigger value="cursor">Cursor</TabsTrigger>
              <TabsTrigger value="vscode">VS Code</TabsTrigger>
            </TabsList>

            <TabsContent value="python" className="mt-8">
              <Steps>
                <Step n={1} title="Install">
                  <CodeBlock label="bash" code={PY_INSTALL} wrap />
                  <details>
                    <summary className="cursor-pointer text-[13px]">Needs a C++17 compiler and zstd</summary>
                    <CodeBlock label="bash" code={BUILD_DEPS} className="mt-2" />
                  </details>
                </Step>
                <Step n={2} title="Load a study">
                  <CodeBlock label="python" code={`import singlet\nadata = singlet.load("${GSE}")   # AnnData, spliced + unspliced layers`} />
                </Step>
                <Step n={3} title="Find more">
                  <CodeBlock label="python" code={`singlet.find("microglia in the aging mouse brain", level="gse")`} />
                </Step>
              </Steps>
            </TabsContent>

            <TabsContent value="r" className="mt-8">
              <Steps>
                <Step n={1} title="Install">
                  <CodeBlock label="r" code={R_INSTALL_STANDALONE} />
                </Step>
                <Step n={2} title="Load a study">
                  <CodeBlock label="r" code={`library(singlet)\nsce <- singlet::load("${GSE}")   # SingleCellExperiment\nseu <- singlet::load("${GSE}", as = "seurat")`} />
                </Step>
                <Step n={3} title="Find more">
                  <CodeBlock label="r" code={`singlet::find("microglia in the aging mouse brain")`} />
                </Step>
              </Steps>
            </TabsContent>

            <TabsContent value="claude" className="mt-8">
              <Steps>
                <Step n={1} title="Get a free API key">
                  <p>
                    <Link to="/account" className="text-primary hover:underline">Account → API keys</Link>
                  </p>
                </Step>
                <Step n={2} title="Connect">
                  <p>Claude.ai: Settings → Connectors → Add custom connector:</p>
                  <CodeBlock label="url" code={`${MCP_URL}?key=${KEY_PLACEHOLDER}`} wrap />
                  <details>
                    <summary className="cursor-pointer text-[13px]">Claude Code or Claude Desktop</summary>
                    <CodeBlock label="bash" code={claudeCodeConfig(KEY_PLACEHOLDER)} wrap className="mt-2" />
                    <CodeBlock label="claude_desktop_config.json" code={claudeDesktopConfig(KEY_PLACEHOLDER)} className="mt-2" />
                  </details>
                </Step>
                <Step n={3} title="Ask">
                  <CodeBlock label="prompt" code={`Find human PBMC studies in COVID-19 with at least 20,000 cells,\ncheck their QC, and write Python to load the best one.`} wrap />
                </Step>
              </Steps>
            </TabsContent>

            <TabsContent value="cursor" className="mt-8">
              <Steps>
                <Step n={1} title="Get a free API key">
                  <p>
                    <Link to="/account" className="text-primary hover:underline">Account → API keys</Link>
                  </p>
                </Step>
                <Step n={2} title="Add .cursor/mcp.json">
                  <CodeBlock label=".cursor/mcp.json" code={cursorConfig(KEY_PLACEHOLDER)} />
                </Step>
                <Step n={3} title="Ask in the chat pane">
                  <CodeBlock label="prompt" code={`Add a loader for a human PBMC COVID-19 study to analysis/load_data.py.`} wrap />
                </Step>
              </Steps>
            </TabsContent>

            <TabsContent value="vscode" className="mt-8">
              <Steps>
                <Step n={1} title="Get a free API key">
                  <p>
                    <Link to="/account" className="text-primary hover:underline">Account → API keys</Link>
                  </p>
                </Step>
                <Step n={2} title="Add .vscode/mcp.json">
                  <CodeBlock label=".vscode/mcp.json" code={vscodeConfig(KEY_PLACEHOLDER)} />
                </Step>
                <Step n={3} title="Ask Copilot in agent mode">
                  <CodeBlock label="prompt" code={`Find a mouse brain study with spliced and unspliced counts and load it.`} wrap />
                </Step>
              </Steps>
            </TabsContent>
          </Tabs>

          <p className="mt-14 pt-6 border-t border-border text-[14px] text-muted-foreground">
            Next: <Link to="/docs#modalities" className="text-primary hover:underline">everything beyond gene counts</Link> ·{" "}
            <Link to="/docs#partial-download" className="text-primary hover:underline">one sample only</Link> ·{" "}
            <Link to="/docs/mcp" className="text-primary hover:underline">all MCP tools</Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Quickstart;

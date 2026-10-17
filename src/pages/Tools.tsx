import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { CodeBlock } from "@/components/CodeBlock";
import { usePageMeta } from "@/hooks/usePageMeta";
import { fetchToolIndex, toolPath } from "@/lib/task-docs";

const CONNECT = `git clone https://github.com/Singlet-Bio/singlet-agents && cd singlet-agents/engine
make
claude mcp add singlet -e PYTHONPATH=$PWD/python -- python -m singlet_engine.server --workspace ./ws`;

const Tools = () => {
  const { data, error } = useQuery({ queryKey: ["tool-index"], queryFn: fetchToolIndex, staleTime: 300_000, retry: false });
  usePageMeta({
    title: "Tools",
    description: "MCP tools of the singlet engine prototype: streaming PCA, NMF, neighbour graphs, clustering, embedding, enrichment, reports.",
    path: "/tools",
  });
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="container-site flex-1 py-10 md:py-14">
        <header className="max-w-[820px] mb-8">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Alpha · prototype</p>
          <h1 className="text-[36px] md:text-[42px] mb-3">Tools</h1>
          <p className="text-[17px] text-muted-foreground">
            The first implemented tasks, exposed as MCP tools for agents. Each call runs one compiled streaming kernel, then returns a
            short summary, metrics, figures with text descriptions and suggested next tools. Large arrays stay in a workspace and are
            referred to by key. CPU only; the engine is a prototype and the numbers are from a small test machine.
          </p>
        </header>
        <section className="mb-10 max-w-[820px]">
          <h2 className="text-[20px] mb-3">Connect</h2>
          <CodeBlock label="bash" code={CONNECT} />
        </section>
        {error && <p className="text-muted-foreground">The tool index could not be loaded.</p>}
        {data && (
          <div className="overflow-x-auto">
            <table className="data-table w-full text-[13.5px]">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>What it does</th>
                  <th>Catalogue task</th>
                </tr>
              </thead>
              <tbody>
                {data.tools.map((t) => (
                  <tr key={t.name}>
                    <td className="whitespace-nowrap">
                      <Link to={toolPath(t.name)} className="text-primary underline underline-offset-2">
                        <code className="code-inline">{t.tool}</code>
                      </Link>
                    </td>
                    <td className="max-w-[560px]">{t.description.split(". ")[0]}.</td>
                    <td>
                      <Link to={`/tasks/${t.task_id.replace(".", "/")}`} className="text-muted-foreground hover:text-foreground">
                        <code className="code-inline text-[12px] break-all">{t.task_id}</code>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default Tools;

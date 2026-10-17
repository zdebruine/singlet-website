import { Children, isValidElement, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { CodeBlock } from "@/components/CodeBlock";
import { usePageMeta } from "@/hooks/usePageMeta";
import { cn } from "@/lib/utils";
import { extractHeadings, fetchTaskDoc, fetchToolIndex, slugify, splitFrontMatter, stripTitle } from "@/lib/task-docs";

function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((c) => (typeof c === "string" ? c : isValidElement(c) ? textOf((c.props as { children?: ReactNode }).children) : ""))
    .join("");
}

const components: Components = {
  h2: ({ children }) => <h2 id={slugify(textOf(children))}>{children}</h2>,
  table: ({ children }) => (
    <div className="overflow-x-auto mb-5">
      <table>{children}</table>
    </div>
  ),
  a: ({ href, children }) =>
    href?.startsWith("/") ? (
      <Link to={href}>{children}</Link>
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
  pre: ({ children }) => {
    const el = Children.toArray(children)[0];
    if (isValidElement(el)) {
      const p = el.props as { className?: string; children?: ReactNode };
      const lang = /language-(\w+)/.exec(p.className ?? "")?.[1];
      return <CodeBlock label={lang} code={textOf(p.children)} className="mb-5" />;
    }
    return <pre>{children}</pre>;
  },
  code: ({ className, children }) => <code className={cn(className, !className && "code-inline")}>{children}</code>,
};

const ToolDetail = () => {
  const { name = "" } = useParams<{ name: string }>();
  const { data: index } = useQuery({ queryKey: ["tool-index"], queryFn: fetchToolIndex, staleTime: 300_000, retry: false });
  const meta = index?.tools.find((t) => t.name === name);
  const { data: raw, isLoading, error } = useQuery({
    queryKey: ["tool-doc", name],
    queryFn: () => fetchTaskDoc(`tools/${name}.md`),
    staleTime: 300_000,
    retry: false,
  });
  const [showMcp, setShowMcp] = useState(false);
  const { data: mcp } = useQuery({
    queryKey: ["tool-mcp", name],
    queryFn: async () => JSON.stringify(JSON.parse(await fetchTaskDoc(`tools/mcp/singlet_${name}.json`)), null, 2),
    enabled: showMcp,
    retry: false,
  });
  const parsed = useMemo(() => {
    if (!raw) return null;
    const { fm, body } = splitFrontMatter(raw);
    const b = stripTitle(body).replace(/^\s*>\s.*\n/, "");
    return { fm, body: b, headings: extractHeadings(b).filter((h) => h.level === 2) };
  }, [raw]);
  usePageMeta({ title: meta ? `${meta.tool} (tool)` : "Tool", description: meta?.description ?? "singlet engine tool", path: `/tools/${name}` });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="container-site flex-1 py-10 md:py-14">
        <p className="text-[13px] mb-6">
          <Link to="/tools" className="text-muted-foreground hover:text-foreground">
            ← All tools
          </Link>
        </p>
        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {error && <p className="text-muted-foreground">No tool with this name.</p>}
        {parsed && meta && (
          <div className="grid lg:grid-cols-[250px_minmax(0,1fr)] gap-10 xl:gap-14">
            <aside className="lg:sticky lg:top-20 lg:self-start space-y-6">
              <dl className="space-y-3 text-[13px]">
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Tool</dt>
                  <dd className="mt-0.5 break-all">
                    <code className="code-inline">{meta.tool}</code>
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Catalogue task</dt>
                  <dd className="mt-0.5 break-all">
                    <Link className="text-primary underline underline-offset-2" to={`/tasks/${meta.task_id.replace(".", "/")}`}>
                      {meta.task_id}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Reads</dt>
                  <dd className="mt-0.5 break-words">{meta.reads.length ? meta.reads.join(", ") : "—"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Writes</dt>
                  <dd className="mt-0.5 break-words">{meta.writes.length ? meta.writes.join(", ") : "—"}</dd>
                </div>
              </dl>
              <nav aria-label="On this page" className="hidden lg:block">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">On this page</p>
                <ul className="space-y-0.5 border-l border-border">
                  {parsed.headings.map((h) => (
                    <li key={h.id}>
                      <a href={`#${h.id}`} className="block -ml-px pl-3 py-1 text-[13px] border-l border-transparent text-muted-foreground hover:text-foreground">
                        {h.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </aside>
            <article className="prose-doc !max-w-[860px] min-w-0">
              <header className="mb-8">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Prototype · CPU</p>
                <h1 className="text-[32px] md:text-[38px] leading-tight mb-3">{meta.title}</h1>
                <p className="text-[17px] text-muted-foreground">{meta.description}</p>
                <div className="flex flex-wrap gap-2 mt-4">
                  <button type="button" className="chip" onClick={() => setShowMcp(!showMcp)} aria-expanded={showMcp}>
                    {showMcp ? "Hide" : "Show"} MCP tool definition
                  </button>
                  <a className="chip no-underline" href={`/task-docs/tools/${name}.md`}>
                    Markdown source
                  </a>
                </div>
                {showMcp && (
                  <div className="mt-4">
                    <CodeBlock label="json" code={mcp ?? "Loading…"} />
                  </div>
                )}
              </header>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {parsed.body}
              </ReactMarkdown>
            </article>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default ToolDetail;

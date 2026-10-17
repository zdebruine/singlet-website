import { Children, isValidElement, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { CodeBlock } from "@/components/CodeBlock";
import { usePageMeta } from "@/hooks/usePageMeta";
import { cn } from "@/lib/utils";
import {
  toolPath,
  TASK_ID_RE,
  TIER_LABEL,
  extractHeadings,
  fetchTaskDoc,
  fetchTaskIndex,
  fetchTaskMcp,
  slugify,
  splitFrontMatter,
  stripTitle,
  taskPath,
  type TaskIndex,
} from "@/lib/task-docs";

function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((c) => (typeof c === "string" ? c : isValidElement(c) ? textOf((c.props as { children?: ReactNode }).children) : ""))
    .join("");
}

function buildComponents(index: TaskIndex | undefined): Components {
  const known = new Set(index?.tasks.map((t) => t.id));
  return {
    h2: ({ children }) => <h2 id={slugify(textOf(children))}>{children}</h2>,
    h3: ({ children }) => <h3 id={slugify(textOf(children))}>{children}</h3>,
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
    code: ({ className, children }) => {
      const t = textOf(children);
      if (!className && known.has(t) && TASK_ID_RE.test(t)) {
        return (
          <Link to={taskPath(t)}>
            <code className="code-inline">{t}</code>
          </Link>
        );
      }
      return <code className={cn(className, !className && "code-inline")}>{children}</code>;
    },
  };
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
    <dd className="text-[13px] mt-0.5 break-words">{children}</dd>
  </div>
);

const TaskLinks = ({ ids, index }: { ids?: string[]; index?: TaskIndex }) =>
  !ids?.length ? (
    <>—</>
  ) : (
    <ul className="space-y-0.5">
      {ids.map((id) => {
        const t = index?.tasks.find((x) => x.id === id);
        return (
          <li key={id}>
            {t?.documented ? (
              <Link to={taskPath(id)} className="text-primary underline underline-offset-2">
                {t.title}
              </Link>
            ) : (
              <span>{t?.title ?? id}</span>
            )}
          </li>
        );
      })}
    </ul>
  );

const TaskDetail = () => {
  const { area = "", slug = "" } = useParams<{ area: string; slug: string }>();
  const id = `${area}.${slug}`;
  const { data: index } = useQuery({ queryKey: ["task-index"], queryFn: fetchTaskIndex, staleTime: 300_000 });
  const meta = index?.tasks.find((t) => t.id === id);
  const { data: raw, isLoading, error } = useQuery({
    queryKey: ["task-doc", id],
    queryFn: () => fetchTaskDoc(`${area}/${slug}.md`),
    staleTime: 300_000,
    retry: false,
  });
  const [mcp, setMcp] = useState<string | null>(null);
  const [showMcp, setShowMcp] = useState(false);

  const parsed = useMemo(() => {
    if (!raw) return null;
    const { fm, body } = splitFrontMatter(raw);
    const b = stripTitle(body).replace(/^\s*>\s.*\n/, "");
    return { fm, body: b, headings: extractHeadings(b).filter((h) => h.level === 2) };
  }, [raw]);
  const components = useMemo(() => buildComponents(index), [index]);

  usePageMeta({
    title: meta ? `${meta.title} (task)` : "Task",
    description: meta?.summary || meta?.question || "Task documentation",
    path: `/tasks/${area}/${slug}`,
  });

  useEffect(() => {
    if (!showMcp || mcp || !meta?.mcp) return;
    fetchTaskMcp(meta.mcp).then((j) => setMcp(JSON.stringify(j, null, 2))).catch(() => setMcp("Could not load the MCP definition."));
  }, [showMcp, mcp, meta?.mcp]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="container-site flex-1 py-10 md:py-14">
        <p className="text-[13px] mb-6">
          <Link to="/tasks" className="text-muted-foreground hover:text-foreground">
            ← All tasks
          </Link>
        </p>
        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {error && (
          <div className="max-w-[640px]">
            <h1 className="text-[28px] mb-3">{meta?.title ?? "Task not documented yet"}</h1>
            {meta?.question && <p className="text-[16px] text-muted-foreground">{meta.question}</p>}
            <p className="mt-4 text-[14px] text-muted-foreground">
              {meta ? "This task is in the catalogue but its documentation has not been written yet." : "No task with this id."}
            </p>
          </div>
        )}
        {parsed && (
          <div className="grid lg:grid-cols-[250px_minmax(0,1fr)] gap-10 xl:gap-14">
            <aside className="lg:sticky lg:top-20 lg:self-start space-y-6">
              <dl className="space-y-3">
                <Field label="Task id">
                  <code className="code-inline break-all text-[12px]">{id}</code>
                </Field>
                <Field label="Role">
                  {meta?.priority && meta.priority !== "unassigned" ? `${meta.priority} · ${TIER_LABEL[meta.priority] ?? ""}` : "—"}
                </Field>
                <Field label="Approach">{String(parsed.fm.paradigm ?? "—")}</Field>
                <Field label="Literature status">{String(parsed.fm.literature_status ?? "—")}</Field>
                <Field label="Devices">{Array.isArray(parsed.fm.devices) ? parsed.fm.devices.join(", ") : "—"}</Field>
                <Field label="Needs first">
                  <TaskLinks ids={meta?.depends_on} index={index} />
                </Field>
                <Field label="Feeds">
                  <TaskLinks ids={meta?.feeds} index={index} />
                </Field>
                <Field label="References">
                  {meta?.n_refs ?? "—"}
                  {meta && meta.n_refs ? ` (${meta.n_verified} verified, ${meta.n_partial} partial, ${meta.n_unverified} unverified)` : ""}
                </Field>
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
                <h1 className="text-[32px] md:text-[38px] leading-tight mb-3">{meta?.title ?? String(parsed.fm.title)}</h1>
                {meta?.summary && <p className="text-[17px] text-muted-foreground">{meta.summary}</p>}
                <div className="flex flex-wrap gap-2 mt-4">
                  {meta?.mcp && (
                    <button type="button" className="chip" onClick={() => setShowMcp(!showMcp)} aria-expanded={showMcp}>
                      {showMcp ? "Hide" : "Show"} MCP tool definition
                    </button>
                  )}
                  {meta?.engine_tools?.map((n) => (
                    <Link key={n} className="chip no-underline" to={toolPath(n)}>
                      Prototype tool: {n}
                    </Link>
                  ))}
                  <a className="chip no-underline" href={`/task-docs/${area}/${slug}.md`}>
                    Markdown source
                  </a>
                </div>
                {showMcp && (
                  <div className="mt-4">
                    <p className="text-[13px] mb-2">
                      Tool name <code className="code-inline">{meta?.mcp_tool}</code>.{" "}
                      {meta?.engine_tools?.length ? "A prototype implementation exists in the engine; see the linked tools." : "Planned for the singlet MCP server; not yet callable."}
                    </p>
                    <CodeBlock label="json" code={mcp ?? "Loading…"} />
                  </div>
                )}
              </header>
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>
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

export default TaskDetail;

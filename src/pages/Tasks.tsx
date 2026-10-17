import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { usePageMeta } from "@/hooks/usePageMeta";
import { cn } from "@/lib/utils";
import { TIER_LABEL, fetchTaskIndex, taskPath, type TaskMeta } from "@/lib/task-docs";

const TIERS = ["P0", "P1", "P2", "P3"] as const;
const PARADIGMS = ["model-based", "hybrid", "heuristic"] as const;

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn("chip", active && "border-primary text-primary")}
    >
      {children}
    </button>
  );
}

export function matchesFilters(
  t: TaskMeta,
  f: { q: string; area: string; tiers: string[]; paradigms: string[]; scope: string; documentedOnly: boolean },
): boolean {
  if (f.area && t.area !== f.area) return false;
  if (f.tiers.length && !f.tiers.includes(String(t.priority))) return false;
  if (f.paradigms.length && !f.paradigms.includes(String(t.paradigm))) return false;
  if (f.scope && t.scope !== f.scope) return false;
  if (f.documentedOnly && !t.documented) return false;
  if (f.q) {
    const hay = `${t.id} ${t.title} ${t.question ?? ""} ${t.summary ?? ""}`.toLowerCase();
    return f.q
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every((w) => hay.includes(w));
  }
  return true;
}

const Tasks = () => {
  usePageMeta({
    title: "Tasks (alpha)",
    description:
      "Every single-cell transcriptomics analysis task in the singlet toolkit: literature-grounded theory, benchmarks with metrics and datasets, and an MCP tool definition for agents.",
    path: "/tasks",
  });
  const { data, isLoading, error } = useQuery({ queryKey: ["task-index"], queryFn: fetchTaskIndex, staleTime: 300_000 });
  const [q, setQ] = useState("");
  const [area, setArea] = useState("");
  const [tiers, setTiers] = useState<string[]>([]);
  const [paradigms, setParadigms] = useState<string[]>([]);
  const [scope, setScope] = useState("");
  const [documentedOnly, setDocumentedOnly] = useState(false);

  const filtered = useMemo(
    () => (data?.tasks ?? []).filter((t) => matchesFilters(t, { q, area, tiers, paradigms, scope, documentedOnly })),
    [data, q, area, tiers, paradigms, scope, documentedOnly],
  );
  // Areas follow the analysis workflow order of the index; tasks within an area go from core to emerging.
  const grouped = useMemo(() => {
    const rank = (t: TaskMeta) => (t.priority && t.priority in TIER_LABEL ? t.priority : "P9");
    const m = new Map<string, TaskMeta[]>();
    for (const a of data?.areas ?? []) m.set(a.slug, []);
    for (const t of filtered) m.set(t.area, [...(m.get(t.area) ?? []), t]);
    return [...m.entries()]
      .filter(([, list]) => list.length)
      .map(([slug, list]) => [slug, [...list].sort((x, y) => rank(x).localeCompare(rank(y)) || x.title.localeCompare(y.title))] as [string, TaskMeta[]]);
  }, [filtered, data]);
  const areaName = (slug: string) => data?.areas.find((a) => a.slug === slug)?.name ?? slug;
  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="container-site flex-1 py-10 md:py-14">
        <header className="max-w-[820px] mb-8">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Alpha</p>
          <h1 className="text-[36px] md:text-[42px] mb-3">Tasks</h1>
          <p className="text-[17px] text-muted-foreground">
            The analysis tasks singlet will implement for single-cell transcriptomics. Each task states its question, the theory
            behind the established methods, the benchmarks that will decide whether singlet meets the published standard, and an
            MCP tool definition for agents. The documentation is written ahead of the code.
          </p>
          {data && (
            <p className="text-[13px] text-muted-foreground mt-3">
              {data.stats.total} tasks in {data.areas.length} areas, {data.stats.documented} documented. Generated {data.generated}.
            </p>
          )}
        </header>

        <section aria-label="Filters" className="mb-8 space-y-3">
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter tasks by words in the title or question"
              aria-label="Filter tasks"
              className="h-9 w-full md:w-96 rounded border border-input bg-background px-3 text-[14px]"
            />
            <select
              value={area}
              onChange={(e) => setArea(e.target.value)}
              aria-label="Area"
              className="h-9 w-full md:w-auto max-w-full rounded border border-input bg-background px-2 text-[14px]"
            >
              <option value="">All areas</option>
              {data?.areas.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.name} ({a.count})
                </option>
              ))}
            </select>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              aria-label="Scope"
              className="h-9 w-full md:w-auto max-w-full rounded border border-input bg-background px-2 text-[14px]"
            >
              <option value="">Core and extended</option>
              <option value="core">Core (scRNA-seq, snRNA-seq)</option>
              <option value="extended">Extended (spatial, multimodal, perturbation, ...)</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[12px] text-muted-foreground mr-1">Role</span>
            {TIERS.map((t) => (
              <Chip key={t} active={tiers.includes(t)} onClick={() => toggle(tiers, setTiers, t)}>
                {t} {TIER_LABEL[t]}
              </Chip>
            ))}
            <span className="text-[12px] text-muted-foreground ml-3 mr-1">Approach</span>
            {PARADIGMS.map((p) => (
              <Chip key={p} active={paradigms.includes(p)} onClick={() => toggle(paradigms, setParadigms, p)}>
                {p}
              </Chip>
            ))}
            <Chip active={documentedOnly} onClick={() => setDocumentedOnly(!documentedOnly)}>
              Documented only
            </Chip>
          </div>
        </section>

        {isLoading && <p className="text-muted-foreground">Loading tasks…</p>}
        {error && <p className="text-destructive">Could not load the task index.</p>}
        {data && filtered.length === 0 && <p className="text-muted-foreground">No tasks match these filters.</p>}

        <div className="space-y-10">
          {grouped.map(([slug, list]) => (
            <section key={slug} aria-labelledby={`area-${slug}`}>
              <h2 id={`area-${slug}`} className="text-[18px] font-semibold mb-3">
                {areaName(slug)} <span className="text-muted-foreground font-normal text-[14px]">· {list.length}</span>
              </h2>
              <div className="overflow-x-auto">
                <table className="data-table w-full text-[13.5px]">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Role</th>
                      <th>Approach</th>
                      <th>Literature status</th>
                      <th>Docs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((t) => (
                      <tr key={t.id}>
                        <td className="max-w-[560px]">
                          {t.documented ? (
                            <Link to={taskPath(t.id)} className="font-medium text-primary underline underline-offset-2">
                              {t.title}
                            </Link>
                          ) : (
                            <span className="font-medium">{t.title}</span>
                          )}
                          <div className="font-mono text-[11.5px] text-muted-foreground">{t.id}</div>
                          {!t.documented && t.question && (
                            <div className="text-[12.5px] text-muted-foreground mt-1 line-clamp-2">{t.question}</div>
                          )}
                        </td>
                        <td className="whitespace-nowrap">{t.priority && t.priority !== "unassigned" ? `${t.priority} ${TIER_LABEL[t.priority] ?? ""}` : "—"}</td>
                        <td className="whitespace-nowrap">{t.paradigm ?? "—"}</td>
                        <td className="whitespace-nowrap">{t.status ?? "—"}</td>
                        <td className="whitespace-nowrap">{t.documented ? "documented" : "planned"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Tasks;

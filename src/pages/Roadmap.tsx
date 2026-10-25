import { useQuery } from "@tanstack/react-query";
import { Check, Circle, Loader2 } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Link } from "react-router-dom";
import { usePageMeta } from "@/hooks/usePageMeta";
import { parseRoadmap, roadmapProgress, type Roadmap as RoadmapData } from "@/lib/roadmap";
import { cn } from "@/lib/utils";

async function loadRoadmap(signal?: AbortSignal): Promise<RoadmapData | null> {
  try {
    const res = await fetch("/data/roadmap.json", { signal });
    return res.ok ? parseRoadmap(await res.json()) : null;
  } catch {
    return null;
  }
}

const Roadmap = () => {
  usePageMeta({ title: "Roadmap", description: "Progress toward the Singlet 1.0.0 release.", path: "/roadmap" });
  const { data, isLoading } = useQuery({ queryKey: ["roadmap"], queryFn: ({ signal }) => loadRoadmap(signal), staleTime: 5 * 60_000 });
  const pct = data ? roadmapProgress(data) : 0;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container-site py-12 md:py-16">
        <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tightest text-foreground">Roadmap to Singlet {data?.release ?? "1.0.0"}</h1>
        <p className="mt-3 max-w-2xl text-[15px] text-muted-foreground">
          The release waits on the <Link to="/benchmarking" className="text-primary underline underline-offset-2">benchmarks</Link>, a
          validated exploratory screen, and a full re-run of every sample.
        </p>
        {isLoading ? (
          <div className="mt-10 h-48 rounded bg-secondary animate-pulse" aria-hidden="true" />
        ) : !data ? (
          <p className="mt-10 text-[14px] text-muted-foreground">The roadmap could not be loaded.</p>
        ) : (
          <>
            <div className="mt-8 max-w-2xl" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to release">
              <div className="mb-1 flex justify-between text-[12.5px] text-muted-foreground"><span>Progress to release</span><span className="tabular">{pct}%</span></div>
              <div className="h-2 rounded bg-secondary"><div className="h-2 rounded bg-primary" style={{ width: `${pct}%` }} /></div>
            </div>
            <ol className="mt-10 max-w-2xl space-y-0">
              {data.milestones.map((m, i) => {
                const Icon = m.status === "done" ? Check : m.status === "active" ? Loader2 : Circle;
                return (
                  <li key={m.id} className="relative flex gap-4 pb-8 last:pb-0">
                    {i < data.milestones.length - 1 && <span className="absolute left-[11px] top-6 h-full w-px bg-border" aria-hidden="true" />}
                    <span className={cn("relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                      m.status === "done" ? "border-primary bg-primary text-primary-foreground" : m.status === "active" ? "border-primary bg-background text-primary" : "border-border bg-background text-muted-foreground")}>
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-[15px] font-semibold text-foreground">{m.title}
                        <span className="ml-2 text-[12px] font-normal text-muted-foreground">
                          {m.status === "done" ? "Done" : m.status === "active" ? `In progress${m.progress != null ? ` · ${m.progress}%` : ""}` : "Upcoming"}
                          {m.date ? ` · ${m.status === "done" ? "" : "target "}${m.date}` : ""}
                        </span>
                      </h2>
                      <p className="mt-1 text-[14px] text-muted-foreground">{m.summary}</p>
                      {m.detail && <p className="mt-1 text-[13px] text-muted-foreground">{m.detail}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="mt-10 text-[12px] text-muted-foreground">Updated {data.updated_at.slice(0, 10)}.</p>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default Roadmap;

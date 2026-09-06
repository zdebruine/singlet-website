import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { apiClient } from "@/integrations/api/client";
import { fmtInt } from "@/lib/catalog-display";
import type { SearchQuery } from "@/integrations/api/types";

/**
 * A handful of one-click entry points into /browse. Each hub is a real
 * facet combination; its study count is fetched live from /api/facets
 * (never hardcoded) and the hub is hidden entirely when the count is 0.
 */
interface Hub {
  label: string;
  query: SearchQuery;
}

const HUBS: Hub[] = [
  { label: "Human brain", query: { organism: ["Homo sapiens"], tissue_group: ["Brain / CNS"] } },
  { label: "Mouse brain", query: { organism: ["Mus musculus"], tissue_group: ["Brain / CNS"] } },
  { label: "Human PBMC", query: { organism: ["Homo sapiens"], tissue_group: ["Blood / PBMC"] } },
  { label: "Cancer", query: { disease_group: ["Cancer"] } },
  { label: "COVID-19", query: { disease_group: ["COVID-19"] } },
  { label: "Organoids", query: { tissue_group: ["Organoid"] } },
];

function hubHref(q: SearchQuery): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (Array.isArray(v)) for (const item of v) params.append(k, item);
  }
  return `/browse?${params.toString()}`;
}

export function QuickStartHubs({ title = "Quick start" }: { title?: string }) {
  const results = useQueries({
    queries: HUBS.map((h) => ({
      queryKey: ["facets", "hub", h.label],
      queryFn: () => apiClient.facets({ ...h.query, level: "gse" }),
      staleTime: 300_000,
    })),
  });

  const loading = results.some((r) => r.isLoading);
  const hubs = HUBS.map((h, i) => ({ ...h, count: results[i].data?.total ?? null })).filter(
    (h) => loading || (h.count ?? 0) > 0,
  );

  if (!loading && hubs.length === 0) return null;

  return (
    <div>
      <h2 className="text-[13px] font-sans font-medium tracking-wide text-muted-foreground mb-3 uppercase">{title}</h2>
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {hubs.map((h) => (
          <li key={h.label}>
            <Link
              to={hubHref(h.query)}
              className="surface flex flex-col justify-between gap-3 px-4 py-3.5 h-full hover:border-strong hover:bg-card transition-colors group"
            >
              <span className="text-[15px] font-medium text-foreground group-hover:text-primary transition-colors">{h.label}</span>
              <span className="text-xs text-muted-foreground tabular">
                {h.count != null ? `${fmtInt(h.count)} studies` : <span className="inline-block h-3.5 w-16 rounded bg-secondary animate-pulse" />}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default QuickStartHubs;

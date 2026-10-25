import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BenchmarkDetail from "../pages/BenchmarkDetail";
import {
  capabilityState, metricState, parseResult, parseRoadmap, roadmapProgress, wordCount, type BenchResult,
} from "../lib/benchmarks";
import { CAPABILITIES } from "../lib/benchmark-capabilities";

vi.mock("@/components/Navbar", () => ({ default: () => null }));
vi.mock("@/components/Footer", () => ({ default: () => null }));

vi.mock("recharts", async (orig) => ({ ...(await orig<typeof import("recharts")>()), ResponsiveContainer: () => null }));

const result: BenchResult = {
  schema_version: 1,
  capability: "gene-expression",
  generated_at: "2026-10-25T00:00:00Z",
  singlet_commit: "0123456789abcdef",
  tools: [{ name: "STARsolo", version: "2.7.11b" }],
  datasets: [{ accession: "GSE138867", label: "flagship" }, { accession: "GSM1234567" }],
  methods: "Same reads through each tool.",
  panels: [{ id: "p", title: "Runtime", kind: "bar", unit: "min", direction: "lower", series: [{ tool: "Singlet", singlet: true, points: [{ label: "GSE138867", value: 10 }] }] }],
  metrics: [{ name: "Correlation", value: 0.99, threshold: 0.98, comparator: ">=" }],
  conclusion: "Counts agree.",
};

describe("benchmark evaluation", () => {
  it("evaluates metrics in both directions and treats missing values as pending", () => {
    expect(metricState({ name: "a", value: 0.99, threshold: 0.98, comparator: ">=" })).toBe("pass");
    expect(metricState({ name: "a", value: 0.9, threshold: 0.98, comparator: ">=" })).toBe("fail");
    expect(metricState({ name: "a", value: 5, threshold: 10, comparator: "<=" })).toBe("pass");
    expect(metricState({ name: "a", value: 11, threshold: 10, comparator: "<=" })).toBe("fail");
    expect(metricState({ name: "a", value: null, threshold: 1, comparator: "<=" })).toBe("pending");
  });

  it("rolls metrics up to a page state", () => {
    expect(capabilityState(null)).toBe("in_progress");
    expect(capabilityState(result)).toBe("passing");
    expect(capabilityState({ ...result, metrics: [...result.metrics, { name: "x", value: 1, threshold: 2, comparator: ">=" }] })).toBe("failing");
    expect(capabilityState({ ...result, metrics: [{ name: "x", value: null, threshold: 2, comparator: ">=" }] })).toBe("in_progress");
  });

  it("rejects anything that is not a result for that capability", () => {
    expect(parseResult(result, "gene-expression")).toBe(result);
    expect(parseResult(result, "doublets")).toBeNull();
    expect(parseResult("<!doctype html>", "gene-expression")).toBeNull();
    expect(parseResult({ ...result, schema_version: 2 }, "gene-expression")).toBeNull();
  });

  it("counts words and keeps capability slugs unique", () => {
    expect(wordCount(" a  b\nc ")).toBe(3);
    expect(new Set(CAPABILITIES.map((c) => c.slug)).size).toBe(CAPABILITIES.length);
  });
});

describe("roadmap", () => {
  const rm = {
    schema_version: 1, release: "1.0.0", updated_at: "2026-10-25",
    milestones: [
      { id: "a", title: "A", summary: "s", status: "done" },
      { id: "b", title: "B", summary: "s", status: "active", progress: 50 },
      { id: "c", title: "C", summary: "s", status: "upcoming" },
      { id: "d", title: "D", summary: "s", status: "upcoming" },
    ],
  };
  it("computes progress from done and active milestones", () => {
    const parsed = parseRoadmap(rm)!;
    expect(roadmapProgress(parsed)).toBe(38);
  });
  it("rejects malformed files", () => {
    expect(parseRoadmap({ ...rm, milestones: [{ id: "a" }] })).toBeNull();
    expect(parseRoadmap(null)).toBeNull();
  });
});

function renderDetail(slug: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/benchmarking/${slug}`]}>
        <Routes><Route path="/benchmarking/:capability" element={<BenchmarkDetail />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BenchmarkDetail", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows an honest in-progress state when no result file exists", async () => {
    // The SPA fallback answers 200 with HTML for a missing file.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html>", { status: 200 })));
    renderDetail("gene-expression");
    expect(await screen.findAllByText("Benchmark in progress")).not.toHaveLength(0);
    expect(screen.queryByText("Pass / fail")).toBeNull();
  });

  it("renders datasets, tool versions, commit and metric state from a result file", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(result), { status: 200 })));
    renderDetail("gene-expression");
    expect(await screen.findByText("Pass / fail")).toBeTruthy();
    expect(screen.getByText("GSE138867").getAttribute("href")).toBe("/study/GSE138867");
    expect(screen.getByText("GSM1234567").getAttribute("href")).toBe("/sample/GSM1234567");
    expect(screen.getByText("2.7.11b")).toBeTruthy();
    expect(screen.getByText("012345678").getAttribute("href")).toContain("/commit/0123456789abcdef");
    expect(screen.getByText("Pass")).toBeTruthy();
  });
});

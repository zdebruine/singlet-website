import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BenchmarkDetail from "../pages/BenchmarkDetail";
import {
  datasetLinks, docStatus, paretosFor, paretoOf, parseDoc, parseIndex, reachMatrix, wordCount, type BenchDoc, type BenchMetric,
} from "../lib/benchmarks";
import { CAPABILITIES } from "../lib/benchmark-capabilities";

vi.mock("@/components/Navbar", () => ({ default: () => null }));
vi.mock("@/components/Footer", () => ({ default: () => null }));
vi.mock("recharts", async (orig) => ({ ...(await orig<typeof import("recharts")>()), ResponsiveContainer: () => null }));

const metric = (over: Partial<BenchMetric> = {}): BenchMetric => ({
  id: "acc", name: "Per-cell accuracy", unit: "fraction", category: "accuracy", dataset: "d1", direction: "higher",
  singlet: { value: 0.99 },
  competitors: [{ tool: "cellXY", value: 0.96 }, { tool: "rule", value: 0.9 }],
  rule: { type: "match_or_beat", against: "best" },
  pass: "pass",
  ...over,
});

const doc = (over: Partial<BenchDoc> = {}): BenchDoc => ({
  schema: "singlet.benchmark.capability",
  schema_version: "1.0.0",
  capability: "chromosomal-sex",
  title: "Chromosomal sex",
  conclusion: "Counts agree.",
  methods: "Same reads through each tool.",
  status: "final",
  generated_at: "2026-10-25T00:00:00Z",
  owner: "bench-public",
  singlet: { version: "1.0.0", commit: "0123456789abcdef0123456789abcdef01234567" },
  tools: [{ name: "cellXY", version: "1.4.0", role: "competitor" }],
  datasets: [{ id: "d1", truth: "known donor sex", accessions: { gse: "GSE138867", gsm: ["GSM1234567"], url: "https://example.org/x" } }],
  metrics: [metric()],
  resources: [
    { tool: "singlet", dataset: "pooled", wall_s: 12, max_rss_gb: 1, threads: 1 },
    { tool: "cellXY", dataset: "pooled", wall_s: 48, max_rss_gb: 3, threads: 1 },
    { tool: "rule", dataset: "pooled", wall_s: 2, max_rss_gb: 0.1, threads: 1 },
  ],
  code: [{ path: "python/singlet/celllabels/sex.py", url: "https://github.com/Singlet-Bio/singlet/blob/5c279cd/python/singlet/celllabels/sex.py" }],
  ...over,
});

describe("status roll-up", () => {
  it("passes only a final document whose gating metrics all pass", () => {
    expect(docStatus(null)).toBe("missing");
    expect(docStatus(doc())).toBe("pass");
    expect(docStatus(doc({ status: "draft" }))).toBe("incomplete");
    expect(docStatus(doc({ metrics: [metric(), metric({ id: "b", pass: "fail" })] }))).toBe("fail");
    expect(docStatus(doc({ metrics: [metric({ rule: { type: "informational" }, pass: "na" })] }))).toBe("incomplete");
    expect(docStatus(doc({ metrics: [metric(), metric({ id: "n", rule: { type: "informational" }, pass: "na" })] }))).toBe("pass");
  });
});

describe("parsing", () => {
  it("accepts a 1.x document for its capability and rejects everything else", () => {
    const d = doc();
    expect(parseDoc(d, "chromosomal-sex")).toBe(d);
    expect(parseDoc(d, "doublets")).toBeNull();
    expect(parseDoc({ ...d, schema_version: "2.0.0" }, "chromosomal-sex")).toBeNull();
    expect(parseDoc("<!doctype html>", "chromosomal-sex")).toBeNull();
    expect(parseDoc({ ...d, singlet: undefined }, "chromosomal-sex")).toBeNull();
  });

  it("parses the index", () => {
    const idx = { schema: "singlet.benchmark.index", schema_version: "1.0.0", capabilities: [] };
    expect(parseIndex(idx)).toBe(idx);
    expect(parseIndex({ ...idx, schema: "x" })).toBeNull();
  });

  it("links GSE and GSM internally and the source URL externally", () => {
    const links = datasetLinks(doc().datasets[0]);
    expect(links.map((l) => l.href)).toEqual(["/study/GSE138867", "/sample/GSM1234567", "https://example.org/x"]);
    expect(links.map((l) => l.internal)).toEqual([true, true, false]);
  });

  it("keeps capability slugs unique and counts words", () => {
    expect(new Set(CAPABILITIES.map((c) => c.slug)).size).toBe(CAPABILITIES.length);
    expect(wordCount(" a  b\nc ")).toBe(3);
  });
});

describe("Pareto frontier", () => {
  it("keeps the tools nothing else beats on quality and runtime", () => {
    const p = paretoOf(doc())!;
    // singlet: 0.99 @ 12s, cellXY: 0.96 @ 48s (dominated), rule: 0.90 @ 2s
    expect(p.points).toHaveLength(3);
    expect(p.points.filter((x) => x.frontier).map((x) => x.tool).sort()).toEqual(["rule", "singlet"]);
  });

  it("flips the quality direction for lower-is-better metrics", () => {
    const d = doc({ metrics: [metric({ direction: "lower", singlet: { value: 0.01 }, competitors: [{ tool: "cellXY", value: 0.05 }, { tool: "rule", value: 0.2 }] })] });
    expect(paretoOf(d)!.points.filter((x) => x.frontier).map((x) => x.tool).sort()).toEqual(["rule", "singlet"]);
  });

  it("uses the pareto figure of the document when it has one", () => {
    const d = doc({ figures: [{ id: "p", kind: "pareto", title: "Accuracy vs CPU-h", x: { label: "cpu_h", unit: "CPU-hours" }, y: { label: "Accuracy" },
      series: [{ name: "singlet", tool: "singlet", x: [0.003], y: [0.99], frontier: true }, { name: "cellXY", tool: "cellXY", x: [0.013], y: [0.96], frontier: false }] }] });
    const p = paretosFor(d)[0];
    expect(p.title).toBe("Accuracy vs CPU-h");
    expect(p.points.filter((x) => x.frontier).map((x) => x.tool)).toEqual(["singlet"]);
  });

  it("is absent without competitor values or timings", () => {
    expect(paretoOf(doc({ metrics: [metric({ competitors: [] })] }))).toBeNull();
    expect(paretoOf(doc({ resources: [] }))).toBeNull();
  });
});

describe("reach", () => {
  it("builds a tools x outputs matrix from published reach entries", () => {
    const m = reachMatrix([
      doc({ reach: [{ tool: "singlet", output: "unspliced", supported: "yes" }, { tool: "alevin-fry", output: "unspliced", supported: "partial" }] }),
      doc({ capability: "x" }),
    ]);
    expect(m.tools).toEqual(["singlet", "alevin-fry"]);
    expect(m.outputs).toHaveLength(1);
    expect(m.cell("alevin-fry", "chromosomal-sex", "unspliced")).toBe("partial");
    expect(m.cell("cellXY", "chromosomal-sex", "unspliced")).toBeNull();
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
    renderDetail("chromosomal-sex");
    expect(await screen.findAllByText("Benchmark in progress")).not.toHaveLength(0);
    expect(screen.queryByText("Pass / fail")).toBeNull();
  });

  it("renders datasets, tool versions, commit, code and metric state from a result file", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(doc()), { status: 200 })));
    renderDetail("chromosomal-sex");
    expect(await screen.findByText("Pass / fail")).toBeTruthy();
    expect(screen.getByText("GSE138867").getAttribute("href")).toBe("/study/GSE138867");
    expect(screen.getByText("GSM1234567").getAttribute("href")).toBe("/sample/GSM1234567");
    expect(screen.getByText("1.4.0")).toBeTruthy();
    expect(screen.getByText("012345678").getAttribute("href")).toContain("/commit/0123456789abcdef");
    expect(screen.getByText("python/singlet/celllabels/sex.py")).toBeTruthy();
    expect(screen.getAllByText("Passing").length).toBeGreaterThan(0);
  });
});

describe("published result files", () => {
  const dir = path.resolve(__dirname, "../../public/data/benchmarks");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json");

  it.each(files)("%s parses, keeps its conclusion under 100 words and has valid verdicts", (f) => {
    const slug = f.replace(/\.json$/, "");
    const d = parseDoc(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")), slug);
    expect(d, f).not.toBeNull();
    expect(wordCount(d!.conclusion)).toBeLessThanOrEqual(100);
    expect(CAPABILITIES.some((c) => c.slug === slug)).toBe(true);
    for (const m of d!.metrics) expect(["pass", "fail", "na"]).toContain(m.pass);
    // Never present a document as passing while a gating metric fails.
    if (d!.metrics.some((m) => m.pass === "fail")) expect(docStatus(d)).toBe("fail");
  });
});

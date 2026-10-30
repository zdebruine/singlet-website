import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/components/Navbar", () => ({ default: () => null }));
vi.mock("@/components/Footer", () => ({ default: () => null }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("recharts", async (orig) => ({ ...(await orig<typeof import("recharts")>()), ResponsiveContainer: () => null }));

import Benchmarking from "../pages/Benchmarking";
import KnownIssues from "../pages/KnownIssues";
import Beta from "../pages/Beta";
import { ALPHA_STRENGTHS, parseAlpha, parseScbc } from "../lib/alpha-benchmarks";
import { ANNOTATIONS_LIVE, S1_FORMAT_LIVE } from "../lib/release";
import { ALPHA_TO_BETA } from "../components/landing/AlphaBeta";
import { CAPABILITIES } from "../lib/benchmark-capabilities";

const read = (p: string) => fs.readFileSync(p, "utf8");
const SCBC = JSON.parse(read("public/data/benchmarks/alpha/scbasecount.json"));

function renderPage(el: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{el}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Serves the scBaseCount JSON and, optionally, other files by URL suffix; everything else is the SPA's HTML fallback. */
function stubFetch(files: Record<string, unknown> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/alpha/scbasecount.json")) return new Response(JSON.stringify(SCBC), { status: 200 });
      for (const [suffix, body] of Object.entries(files)) if (url.endsWith(suffix)) return new Response(JSON.stringify(body), { status: 200 });
      return new Response("<!doctype html>", { status: 200 });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Alpha benchmark files", () => {
  it("ships the scBaseCount comparison with the measured headline numbers", () => {
    const d = parseScbc(SCBC)!;
    expect(d).not.toBeNull();
    // Recomputed over the correctly stranded samples only; the table reproduces the median.
    const rec = d.cell_calls.rows.map((r) => r.singlet_recovery).sort((a, b) => a - b);
    expect(d.cell_calls.n).toBe(rec.length);
    expect(d.cell_calls.singlet_median_recovery).toBeCloseTo(rec[(rec.length - 1) / 2], 3);
    expect(d.cell_calls.singlet_median_recovery).toBeCloseTo(0.763, 3);
    expect(d.cell_calls.singlet_precision_range).toEqual([Math.min(...d.cell_calls.rows.map((r) => r.singlet_precision)), 1]);
    expect(d.depth.umi_ratio_median).toBe(0.322);
    expect(d.depth_matched.rows).toHaveLength(8);
    for (const r of d.depth_matched.rows) expect(r.noise_floor - r.depth_matched).toBeLessThanOrEqual(0.04 + 1e-9);
  });

  it("names no sample accession in the Alpha comparison and counts nothing outside Alpha", () => {
    const scbc = read("public/data/benchmarks/alpha/scbasecount.json");
    expect(scbc).not.toMatch(/GS[EM]\d+/);
    expect(scbc).not.toMatch(/shared_samples|singlet_non10x_samples/);
    for (const f of fs.readdirSync("public/data/benchmarks/alpha")) {
      const text = read(`public/data/benchmarks/alpha/${f}`);
      expect(text, f).not.toMatch(/withheld|excluded|exclusion|alpha_samples\.csv/i);
    }
    // The census shows the included atlas only, labelled as of the Alpha release.
    const census = read("public/data/benchmarks/alpha/alpha-census.json");
    expect(census).toMatch(/as of the Alpha release/);
    expect(census).not.toMatch(/54,747|72,386|51,879|249\.7M|305\.5M|239\.6M/);
  });

  it("accepts a summary or a results-contract document and rejects anything else", () => {
    expect(parseAlpha("<!doctype html>", "alpha-census")).toBeNull();
    expect(parseAlpha({ title: "Census" }, "alpha-census")).toBeNull();
    const s = parseAlpha(
      { title: "Census", summary: "All checked.", measured_at: "2026-10-27T00:00:00Z", headline: [{ label: "samples", value: 10 }], tables: [{ title: "t", columns: ["a"], rows: [[1]] }] },
      "alpha-census",
    );
    expect(s && s.kind === "summary" && s.headline[0]).toEqual({ label: "samples", value: "10" });
    expect(s && s.kind === "summary" && s.measuredAt).toBe("2026-10-27");
  });
});

describe("/benchmarking", { timeout: 30_000 }, () => {
  it("shows what Alpha does well and no failing rules, with a short known-limits note", async () => {
    stubFetch({ "/alpha/alpha-census.json": JSON.parse(read("public/data/benchmarks/alpha/alpha-census.json")) });
    const { container } = renderPage(<Benchmarking />);
    expect(screen.getByText("Cells and genes you can trust")).toBeTruthy();
    for (const s of ALPHA_STRENGTHS) expect(screen.getByText(s.shown)).toBeTruthy();
    expect(await screen.findByText("Atlas census, as of the Alpha release")).toBeTruthy();
    expect(await screen.findByText("Gene profiles at equal depth")).toBeTruthy();
    expect(screen.getByText("Known limits")).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/Not yet passing|Why the shortfall|of 22 pages|Coverage — updated/);
    expect(text).not.toMatch(/of each sample's SRA reads used/);
  });

  it("quotes every strength exactly as its benchmark file measured it", () => {
    for (const s of ALPHA_STRENGTHS) {
      const doc = JSON.parse(read(`public/data/benchmarks/alpha/${s.file}.json`));
      const m = doc.metrics.find((x: { id: string; dataset: string }) => x.id === s.metric && x.dataset === "pooled");
      expect(m, s.metric).toBeTruthy();
      expect(m.singlet.value, s.metric).toBe(s.value);
    }
  });
});

describe("Beta copy", () => {
  it("describes Beta engine features as Beta goals, not as Alpha features", () => {
    for (const c of CAPABILITIES) expect(c.hero, c.slug).toMatch(/Beta/);
  });
});

describe("/known-issues", () => {
  it("covers each issue with what Beta changes, and states inclusion criteria only", () => {
    const { container } = renderPage(<KnownIssues />);
    const text = container.textContent ?? "";
    for (const s of [/first sequencing run/, /30 million reads/, /65%/, /2% to 19%/, /RNA velocity/, /CellRanger2\.2/, /at least 100 reads/, /not clonotypes/, /spots without coordinates/, /the file is the\s+truth/, /transit amplifying cell/, /one page of cells per link/]) {
      expect(text).toMatch(s);
    }
    expect(screen.getAllByText("What Beta changes").length).toBeGreaterThanOrEqual(8);
    // Owner rule: excluded items are never listed, counted or linked.
    expect(text).not.toMatch(/GS[EM]\d+|withheld|excluded/i);
    expect(container.querySelector('a[href^="/study/"]')).toBeNull();
  });
});

describe("/beta", () => {
  it("shows the estimate, every Alpha-to-Beta row, the sign-up form and its privacy line", () => {
    renderPage(<Beta />);
    for (const r of ALPHA_TO_BETA) expect(screen.getByText(r.beta)).toBeTruthy();
    expect(screen.getByText("Beta begins in Q1 2027; the full re-run continues through 2027")).toBeTruthy();
    expect(screen.getByRole("form", { name: "Join the Beta" })).toBeTruthy();
    expect(screen.getByText(/never share\s+or sell it/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy#beta");
  });
});

describe("release gates", () => {
  it("labels the .s1 pilot numbers as pilot measurements", () => {
    expect(read("src/components/landing/AlphaBeta.tsx")).toMatch(/Measured on pilot and test sets, not yet atlas-wide/);
  });

  it("shows annotations only with the .s1 format", () => {
    expect(ANNOTATIONS_LIVE).toBe(S1_FORMAT_LIVE);
    const { container } = renderPage(<KnownIssues />);
    expect(container.textContent).toMatch(/compartment 0\.84/);
  });

  it("never names the pilot study", () => {
    for (const f of ["src/components/landing/AlphaBeta.tsx", "src/pages/Index.tsx", "src/pages/Beta.tsx", "src/pages/KnownIssues.tsx", "src/pages/Benchmarking.tsx", "src/components/benchmarks/AlphaParts.tsx"]) {
      expect(read(f)).not.toMatch(/GSE145370/);
    }
  });
});

describe("site wiring", () => {
  it("routes, redirects, sitemap and llms.txt list the new pages", () => {
    const app = read("src/App.tsx");
    for (const p of ["/known-issues", "/beta", "/benchmarking"]) {
      expect(app).toContain(`path="${p}"`);
      expect(read("functions/sitemap.xml.ts")).toContain(`path: "${p}"`);
      expect(read("public/llms.txt")).toContain(`https://singlet.bio${p}`);
    }
    expect(read("public/_redirects")).toMatch(/^\/benchmarks\s+\/benchmarking\s+301$/m);
    expect(read("public/_redirects")).toMatch(/^\/validation\s+\/benchmarking\s+301$/m);
    expect(read("src/pages/Privacy.tsx")).toMatch(/id="beta"/);
  });
});

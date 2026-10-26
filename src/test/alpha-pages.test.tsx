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
import { ALPHA_PENDING, parseAlpha, parseScbc } from "../lib/alpha-benchmarks";
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
    expect(d.cell_calls.singlet_median_recovery).toBe(0.73);
    expect(d.cell_calls.singlet_precision_range).toEqual([0.98, 1]);
    expect(d.depth.umi_ratio_median).toBe(0.322);
    expect(d.depth_matched.rows).toHaveLength(8);
    for (const r of d.depth_matched.rows) expect(r.noise_floor - r.depth_matched).toBeLessThanOrEqual(0.04 + 1e-9);
  });

  it("names no sample accession in the Alpha comparison", () => {
    expect(read("public/data/benchmarks/alpha/scbasecount.json")).not.toMatch(/GS[EM]\d+/);
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

describe("/benchmarking", { timeout: 20_000 }, () => {
  it("separates Alpha from the Beta preview and shows running Alpha benchmarks", async () => {
    stubFetch();
    renderPage(<Benchmarking />);
    expect(screen.getByText("Alpha: measured on the data you can download today")).toBeTruthy();
    expect(screen.getByText("Singlet 1.0.0, the engine for the re-run")).toBeTruthy();
    expect(screen.getByText(/not the Alpha files you can download today/)).toBeTruthy();
    expect(await screen.findByText("73%")).toBeTruthy();
    expect(screen.getByText("0.32×")).toBeTruthy();
    expect(await screen.findAllByText("Benchmark running")).toHaveLength(ALPHA_PENDING.length);
  });

  it("fills a running panel when its file is published", async () => {
    stubFetch({ "/alpha/alpha-census.json": { title: "Atlas QC census", conclusion: "Every sample in Alpha passed the inclusion checks.", headline: [{ label: "samples checked", value: "1,234" }] } });
    renderPage(<Benchmarking />);
    expect(await screen.findByText("Every sample in Alpha passed the inclusion checks.")).toBeTruthy();
    expect(screen.getByText("1,234")).toBeTruthy();
    expect(await screen.findAllByText("Benchmark running")).toHaveLength(ALPHA_PENDING.length - 1);
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
    for (const s of [/first sequencing run/, /30 million reads/, /73%/, /2% to 19%/, /RNA velocity/, /CellRanger2\.2/, /at least 100 reads/, /not clonotypes/, /spots without coordinates/, /the file is the\s+truth/]) {
      expect(text).toMatch(s);
    }
    expect(screen.getAllByText("What Beta changes").length).toBeGreaterThanOrEqual(8);
    // Owner rule: excluded items are never listed, counted or linked.
    expect(text).not.toMatch(/GS[EM]\d+|withheld|excluded/i);
    expect(container.querySelector('a[href^="/study/"]')).toBeNull();
  });
});

describe("/beta", () => {
  it("shows the estimate, the sign-up form and its privacy line", () => {
    renderPage(<Beta />);
    expect(screen.getByText("Estimated Q1 2027")).toBeTruthy();
    expect(screen.getByRole("form", { name: "Join the Beta" })).toBeTruthy();
    expect(screen.getByText(/never share\s+or sell it/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy#beta");
  });
});

describe("home page speed story", () => {
  it("labels store-format numbers as pilot measurements and never names the pilot study", () => {
    const home = read("src/components/landing/AlphaBeta.tsx");
    expect(home).toMatch(/Measured on pilot and test sets, not yet atlas-wide/);
    for (const f of ["src/components/landing/AlphaBeta.tsx", "src/pages/Index.tsx", "src/pages/Beta.tsx", "src/pages/KnownIssues.tsx", "src/pages/Benchmarking.tsx"]) {
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

import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/components/Navbar", () => ({ default: () => null }));
vi.mock("@/components/Footer", () => ({ default: () => null }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null }) }));

import DocsClaudeApi from "../pages/DocsClaudeApi";

const read = (p: string) => fs.readFileSync(p, "utf8");
const MD = "public/docs/claude-api.md";

function renderPage(el: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{el}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Claude API user guide", () => {
  it("is routed, in the sitemap and in llms.txt, and linked from the docs", () => {
    expect(read("src/App.tsx")).toContain('path="/docs/claude-api"');
    expect(read("functions/sitemap.xml.ts")).toContain('path: "/docs/claude-api"');
    expect(read("public/llms.txt")).toContain("https://singlet.bio/docs/claude-api.md");
    expect(read("src/pages/Docs.tsx")).toContain('to="/docs/claude-api"');
    expect(read("src/pages/DocsMcp.tsx")).toContain('to="/docs/claude-api"');
  });

  it("the page and its markdown twin give the same request shape", () => {
    const md = read(MD);
    const page = read("src/pages/DocsClaudeApi.tsx");
    for (const s of ["mcp-client-2025-11-20", '"type": "mcp_toolset"', '"save_cohort": {"enabled": False}', 'model="claude-opus-5-5"', "authorization_token"]) {
      expect(md).toContain(s);
      expect(page).toContain(s);
    }
    expect(md).toMatch(/^# singlet\.bio with Claude/);
    expect(md).not.toMatch(/<html/i);
    expect(md).toContain("SHOWCASE-EXAMPLES");
  });

  it("renders the worked examples and the showcase placeholder", () => {
    const { container } = renderPage(<DocsClaudeApi />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/18,496 cells in 9 samples of 2 studies/);
    expect(text).toMatch(/GSM4301254/);
    expect(text).toMatch(/showcase panel/);
  });
});

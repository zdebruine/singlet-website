import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null }) }));

import { AlphaBanner, AlphaTag } from "@/components/AlphaBanner";
import { DownloadPanel } from "@/components/DownloadPanel";

const read = (p: string) => readFileSync(p, "utf8");

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* none */
  }
});
afterEach(() => vi.restoreAllMocks());

describe("Research Alpha label", { timeout: 20_000 }, () => {
  it("names the release for assistive technology", () => {
    render(<AlphaTag />);
    expect(screen.getByText("Research Alpha preview")).toBeInTheDocument();
    expect(screen.getByTitle("Research Alpha preview")).toBeInTheDocument();
  });

  it("shows the banner with a feedback button, and remembers a dismissal", () => {
    const { unmount } = render(<MemoryRouter><AlphaBanner /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "send feedback" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/ }));
    expect(screen.queryByText(/Beta begins in Q1 2027/)).not.toBeInTheDocument();
    unmount();
    render(<MemoryRouter><AlphaBanner /></MemoryRouter>);
    expect(screen.queryByText(/help us shape Beta/)).not.toBeInTheDocument();
  });

  it("still renders and dismisses when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<MemoryRouter><AlphaBanner /></MemoryRouter>);
    expect(screen.getByText(/Beta begins in Q1 2027; the full re-run continues through 2027/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/ }));
    expect(screen.queryByText(/help us shape Beta/)).not.toBeInTheDocument();
  });
});

describe("launch copy", { timeout: 20_000 }, () => {
  it("makes no claim the Alpha data cannot back on the home and About pages", () => {
    const pages = read("src/pages/Index.tsx") + read("src/pages/About.tsx") + read("src/components/landing/Modalities.tsx");
    for (const claim of [/Only high-quality samples/, /Every modality, one file/, /in every study file/, /four modalities/, /3,198 datasets/, /ready for RNA velocity/, /Mitochondrial variants/]) {
      expect(pages).not.toMatch(claim);
    }
  });

  it("cites one defined release", () => {
    const text = read("src/pages/About.tsx") + read("src/pages/DataLicense.tsx");
    expect(text).not.toMatch(/Release 2026-Q3|release <singlet_version>/);
    expect(text).toMatch(/Singlet Research Alpha \(October 2026\)/);
  });

  it("documents the MCP field the server returns, and that tool calls need an account", () => {
    const docs = read("src/pages/DocsMcp.tsx");
    expect(docs).not.toMatch(/Needs a key\?|no account needed to start/);
    expect(docs).toMatch(/sign_in_required/);
    expect(docs).toMatch(/_meta\.quota/);
    // functions/mcp.ts puts the allowance under `quota` (quotaMeta); its own text must say the same.
    expect(read("functions/mcp.ts")).not.toMatch(/_meta\.allowance/);
    expect(read("functions/mcp.ts")).toMatch(/return \{\s*quota: \{/);
  });

  it("keeps the HPC dashboard out of the public app", () => {
    const app = read("src/App.tsx");
    expect(app).not.toMatch(/import HpcDashboard/);
    expect(app).toMatch(/path="\/hpc-dashboard" element=\{<Navigate to="\/" replace \/>\}/);
  });

  it("ships a static llms.txt", () => {
    const txt = read("public/llms.txt");
    expect(txt).toMatch(/^# singlet\.bio/);
    expect(txt).toMatch(/Research Alpha/);
    expect(txt).toMatch(/https:\/\/singlet\.bio\/mcp/);
    expect(txt).toMatch(/CC0/);
    expect(txt).not.toMatch(/<html/i);
  });

  it("renders no developer comment as text on a study page", () => {
    const { container } = render(
      <MemoryRouter>
        <DownloadPanel accession="GSE1" bundleUrl="https://data.singlet.bio/data/GSE1/GSE1.singlet" bundleBytes={5000} />
      </MemoryRouter>
    );
    expect(container.textContent).not.toMatch(/min-w-0 lets/);
  });
});

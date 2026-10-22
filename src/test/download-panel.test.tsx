import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { DownloadPanel } from "@/components/DownloadPanel";
import { FileTreePanel } from "@/components/study/FileTreePanel";
import { normalizeBundleIndex, normalizeGseDetail } from "@/integrations/api/client";
import type { StudyV2 } from "@/integrations/api/types";

const v2 = (over: Partial<StudyV2> = {}): StudyV2 => ({
  format: "singlet-v2", rev: "0123456789abcdef", manifest_url: "https://data.singlet.bio/v2/m/GSE1.json", n_samples: 12, bytes: 1_000_000, legacy_available: true, ...over,
});
const LEGACY = "https://data.singlet.bio/data/GSE1/GSE1.singlet";

function panel(props: Partial<React.ComponentProps<typeof DownloadPanel>>) {
  return render(
    <MemoryRouter>
      <DownloadPanel accession="GSE1" bundleUrl={LEGACY} bundleBytes={5000} {...props} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* none */
  }
});

describe("DownloadPanel", () => {
  it("is unchanged for a study that is still one file", () => {
    panel({});
    expect(screen.getByText("GSE1.singlet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download/ })).toHaveAttribute("href", LEGACY);
    expect(screen.queryByText(/Manifest/)).toBeNull();
    expect(screen.getByText(/One file per study/)).toBeInTheDocument();
  });

  it("keeps the single-file download while it exists and mentions the per-sample layout", () => {
    panel({ v2: v2() });
    expect(screen.getByRole("link", { name: /Download/ })).toHaveAttribute("href", LEGACY);
    expect(screen.getByText(/Also stored as one file per sample/)).toBeInTheDocument();
  });

  it("offers the manifest once the single file is retired, with a curl line for it", () => {
    panel({ bundleUrl: null, bundleBytes: null, v2: v2({ legacy_available: false }) });
    expect(screen.getByText("GSE1 · 12 sample files")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Manifest/ })).toHaveAttribute("href", "https://data.singlet.bio/v2/m/GSE1.json");
    expect(screen.getByText(/Stored as one file per sample plus a manifest/)).toBeInTheDocument();
    // the loaders do not change
    expect(screen.getAllByText(/singlet\.load\("GSE1"\)/).length).toBeGreaterThan(0);
  });

  it("still says the file is pending for a study with neither", () => {
    panel({ bundleUrl: null });
    expect(screen.getByText("File pending")).toBeInTheDocument();
  });
});

describe("FileTreePanel", () => {
  const base = { gse_id: "GSE1", bytes: 1000, reference_build: null, singlet_version: null, created_at: null, indexed_at: null, n_samples: 1, samples: [{ gsm_id: "GSM1", files: [{ path: "samples/GSM1/cells", bytes_compressed: 10, bytes_uncompressed: 10 }], total_bytes: 10 }], study_files: [] };

  it("labels a v2 listing as sample objects", () => {
    render(<FileTreePanel index={{ ...base, format: "singlet-v2", files_truncated: true }} isLoading={false} isError={false} />);
    expect(screen.getByText("What's in the study")).toBeInTheDocument();
    expect(screen.getByText(/Sample objects \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Members are listed for the first 100 samples/)).toBeInTheDocument();
  });

  it("is unchanged for a legacy listing", () => {
    render(<FileTreePanel index={base} isLoading={false} isError={false} />);
    expect(screen.getByText("What's in the file")).toBeInTheDocument();
    expect(screen.queryByText(/Sample objects/)).toBeNull();
  });
});

describe("API normalisers", () => {
  const series = { id: "GSE1", title: "t", r2_bundle_key: "data/GSE1/GSE1.singlet", n_gsm_total: 1 };

  it("read the v2 block and do not rebuild a legacy URL once it is retired", () => {
    const live = normalizeGseDetail({ series: { ...series, bundle_url: LEGACY, v2: v2() }, samples: [] });
    expect(live.series.v2).toMatchObject({ format: "singlet-v2", manifest_url: "https://data.singlet.bio/v2/m/GSE1.json", n_samples: 12, legacy_available: true });
    expect(live.series.bundle_url).toBe(LEGACY);
    const retired = normalizeGseDetail({ series: { ...series, bundle_url: null, v2: v2({ legacy_available: false }) }, samples: [] });
    expect(retired.series.bundle_url).toBeNull(); // the key alone would have rebuilt the dead URL
    const old = normalizeGseDetail({ series, samples: [] });
    expect(old.series.v2).toBeNull();
    expect(old.series.bundle_url).toBe(LEGACY);
    expect(normalizeGseDetail({ series: { ...series, v2: { format: "other" } }, samples: [] }).series.v2).toBeNull();
  });

  it("pass the v2 listing fields through", () => {
    const j = normalizeBundleIndex({ gse_id: "GSE1", bytes: 1, n_samples: 0, samples: [], study_files: [], format: "singlet-v2", manifest_url: "https://x/m.json", files_truncated: true });
    expect(j).toMatchObject({ format: "singlet-v2", manifest_url: "https://x/m.json", files_truncated: true });
    expect(normalizeBundleIndex({ gse_id: "GSE1", samples: [], study_files: [] }).format).toBeUndefined();
  });
});

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { DownloadPanel } from "@/components/DownloadPanel";
import { FileTreePanel } from "@/components/study/FileTreePanel";
import { normalizeBundleIndex, normalizeGseDetail } from "@/integrations/api/client";
import type { StudyStore } from "@/integrations/api/types";

const store = (over: Partial<StudyStore> = {}): StudyStore => ({
  format: "singlet-store", rev: "0123456789abcdef", manifest_url: "https://data.singlet.bio/store/m/GSE1.json", n_samples: 12, bytes: 1_000_000, legacy_available: true, ...over,
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
    panel({ store: store() });
    expect(screen.getByRole("link", { name: /Download/ })).toHaveAttribute("href", LEGACY);
    expect(screen.getByText(/Also stored as one file per sample/)).toBeInTheDocument();
  });

  it("offers the manifest once the single file is retired, with a curl line for it", () => {
    panel({ bundleUrl: null, bundleBytes: null, store: store({ legacy_available: false }) });
    expect(screen.getByText("GSE1 · 12 sample files")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Manifest/ })).toHaveAttribute("href", "https://data.singlet.bio/store/m/GSE1.json");
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

  it("labels a store listing as sample objects", () => {
    render(<FileTreePanel index={{ ...base, format: "singlet-store", files_truncated: true }} isLoading={false} isError={false} />);
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

  it("read the store block and do not rebuild a legacy URL once it is retired", () => {
    const live = normalizeGseDetail({ series: { ...series, bundle_url: LEGACY, store: store() }, samples: [] });
    expect(live.series.store).toMatchObject({ format: "singlet-store", manifest_url: "https://data.singlet.bio/store/m/GSE1.json", n_samples: 12, legacy_available: true });
    expect(live.series.bundle_url).toBe(LEGACY);
    const retired = normalizeGseDetail({ series: { ...series, bundle_url: null, store: store({ legacy_available: false }) }, samples: [] });
    expect(retired.series.bundle_url).toBeNull(); // the key alone would have rebuilt the dead URL
    const old = normalizeGseDetail({ series, samples: [] });
    expect(old.series.store).toBeNull();
    expect(old.series.bundle_url).toBe(LEGACY);
    expect(normalizeGseDetail({ series: { ...series, store: { format: "other" } }, samples: [] }).series.store).toBeNull();
  });

  it("pass the store listing fields through", () => {
    const j = normalizeBundleIndex({ gse_id: "GSE1", bytes: 1, n_samples: 0, samples: [], study_files: [], format: "singlet-store", manifest_url: "https://x/m.json", files_truncated: true });
    expect(j).toMatchObject({ format: "singlet-store", manifest_url: "https://x/m.json", files_truncated: true });
    expect(normalizeBundleIndex({ gse_id: "GSE1", samples: [], study_files: [] }).format).toBeUndefined();
  });
});

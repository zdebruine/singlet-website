import { describe, expect, it } from "vitest";
import { exclusionFor, studyCompleteness } from "../../functions/_shared/completeness";

const done = { status: "DONE", failure_category: null };
const fail = (c: string | null, status = "FAIL") => ({ status, failure_category: c });
const base = { hasFile: true, bundleSamples: 0, passedQc: null, lowQc: 0, removed: 0 };

describe("exclusionFor", () => {
  it("returns null for processed samples", () => {
    expect(exclusionFor("DONE", null)).toBeNull();
    expect(exclusionFor("DONE_QC_WARN", null)).toBeNull();
  });
  it("separates unprocessable, QC and retryable failures", () => {
    expect(exclusionFor("FAIL", "fail_barcode_stripped")?.class).toBe("not_processable");
    expect(exclusionFor("HARD_FAIL", "fail_no_r2")?.class).toBe("not_processable");
    expect(exclusionFor("FAIL", "fail_qc_low_genes")?.class).toBe("qc");
    expect(exclusionFor("FAIL", "fail_runtime_fail")?.class).toBe("retry");
    expect(exclusionFor("FAIL", null)?.class).toBe("retry");
    expect(exclusionFor("PENDING", null)?.class).toBe("queued");
  });
});

describe("studyCompleteness", () => {
  it("is complete when every sample is processed and in the file", () => {
    const c = studyCompleteness({ ...base, nGsmTotal: 3, samples: [done, done, done], bundleSamples: 3, passedQc: 3 });
    expect(c.state).toBe("complete");
    expect(c.notes).toEqual([]);
  });

  it("flags processed samples with no file as file_pending", () => {
    const c = studyCompleteness({ ...base, nGsmTotal: 96, samples: Array(96).fill(done), hasFile: false, bundleSamples: null });
    expect(c.state).toBe("file_pending");
    expect(c.file_pending).toBe(96);
    expect(c.in_file).toBeNull();
  });

  it("counts samples missing from a stale file", () => {
    const c = studyCompleteness({ ...base, nGsmTotal: 56, samples: Array(56).fill(done), bundleSamples: 21 });
    expect(c.state).toBe("file_pending");
    expect(c.file_pending).toBe(35);
    expect(c.in_file).toBe(21);
  });

  it("accounts for every GEO sample exactly once", () => {
    const samples = [done, done, fail("fail_barcode_stripped"), fail("fail_runtime_fail"), fail("fail_qc_other"), { status: "PENDING", failure_category: null }];
    const c = studyCompleteness({ ...base, nGsmTotal: 10, samples, bundleSamples: 2 });
    expect(c.processed + c.not_processable + c.retry + c.failed_qc + c.queued + c.not_queued).toBe(c.geo_samples);
    expect(c.geo_samples).toBe(10);
    expect(c.not_queued).toBe(4);
    expect(c.state).toBe("partial");
    expect(c.reasons.map((r) => r.n)).toEqual([1, 1, 1]);
  });

  it("uses the row count when it exceeds GEO's recorded total", () => {
    const c = studyCompleteness({ ...base, nGsmTotal: 1, samples: [done, done], bundleSamples: 2 });
    expect(c.geo_samples).toBe(2);
    expect(c.not_queued).toBe(0);
  });

  it("reports none when nothing processed", () => {
    const c = studyCompleteness({ ...base, nGsmTotal: 2, samples: [fail("fail_barcode_stripped"), fail("fail_barcode_stripped")], hasFile: false, bundleSamples: null });
    expect(c.state).toBe("none");
    expect(c.not_processable).toBe(2);
  });
});

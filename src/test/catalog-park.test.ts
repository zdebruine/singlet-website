import { describe, expect, it } from "vitest";
import { parseZipSource, type BundleByteSource } from "../../functions/_shared/bundle-reader";
import { UNREADABLE_FILE_ERRORS, isUnreadableFileError } from "../../functions/_shared/catalog-refresh";

/**
 * refresh-next resolves a parked study's unassessed samples to usable = 0
 * without a read only when the park reason proves the file is a broken zip.
 * A transient park (5xx, timeout, subrequest budget, D1, index too large to
 * store) must not zero a study with a good file and drop it from search.
 */

function source(buf: Uint8Array): BundleByteSource {
  return { size: async () => buf.length, range: async (start: number, end: number) => buf.slice(start, end + 1) };
}

const EOCD_SIG = [0x50, 0x4b, 0x05, 0x06];
const ZIP64_LOCATOR_SIG = [0x50, 0x4b, 0x06, 0x07];

/** One archive per parseZipSource structural error, in UNREADABLE_FILE_ERRORS order. */
function brokenZips(): Uint8Array[] {
  const noEocd = new Uint8Array(100);
  const noLocator = new Uint8Array(100);
  noLocator.set(EOCD_SIG, 78);
  noLocator.set([0xff, 0xff], 88); // entry count 0xFFFF → needs zip64
  const noZip64Record = noLocator.slice();
  noZip64Record.set(ZIP64_LOCATOR_SIG, 58); // points at offset 0, which holds no zip64 EOCD record
  return [noEocd, noLocator, noZip64Record];
}

async function parkReason(buf: Uint8Array): Promise<string> {
  try {
    await parseZipSource(source(buf));
  } catch (e) {
    return String(e);
  }
  throw new Error("parseZipSource accepted a broken zip");
}

describe("park reasons that prove a file unreadable", () => {
  it("match what parseZipSource throws, as index-next and refresh-next store it", async () => {
    const reasons = await Promise.all(brokenZips().map(parkReason));
    expect(reasons.map((r) => UNREADABLE_FILE_ERRORS.find((s) => r.includes(s)))).toEqual([...UNREADABLE_FILE_ERRORS]);
    for (const r of reasons) {
      expect(isUnreadableFileError(r), r).toBe(true); // index-next parks String(e)
      expect(isUnreadableFileError(`manifest: ${r}`), r).toBe(true); // refresh-next phase (c)
    }
  });

  it("leave transient and unrelated parks alone", () => {
    for (const r of [
      "Error: HEAD 503 for https://data.singlet.bio/data/GSE1/GSE1.singlet",
      "Error: HEAD 404 for https://data.singlet.bio/data/GSE1/GSE1.singlet",
      "manifest: Error: Range 500 for https://data.singlet.bio/data/GSE1/GSE1.singlet",
      "Error: No content-length for https://data.singlet.bio/data/GSE1/GSE1.singlet",
      "Error: Too many subrequests.",
      "Error: D1_ERROR: Network connection lost.",
      "sample_qc written but bundle_index could not be stored",
      "no summary.json",
      "manifest: SyntaxError: Unexpected token < in JSON at position 0",
      "",
    ]) {
      expect(isUnreadableFileError(r), r).toBe(false);
    }
    expect(isUnreadableFileError(null)).toBe(false);
    expect(isUnreadableFileError(undefined)).toBe(false);
  });

  it("embed safely in the SQL twin (single-quoted literals)", () => {
    for (const s of UNREADABLE_FILE_ERRORS) expect(s).not.toMatch(/['\\]/);
  });
});

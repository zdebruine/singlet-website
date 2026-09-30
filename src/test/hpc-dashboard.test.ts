import { describe, expect, it } from "vitest";
import { hpcPath } from "../../functions/_shared/hpc-dashboard";
import { acceptedDigests } from "../../functions/_shared/ingest-auth";

/**
 * POST /api/ingest/hpc writes `?path=` straight into R2 as the object key and
 * GET /api/hpc/<path> reads it back (falling back to /data/hpc/<path>), so the
 * allowlist is the only thing between a request and the bucket layout.
 */
describe("hpcPath", () => {
  it("accepts the files the dashboard and the orchestrators use", () => {
    for (const p of [
      "latest.json",
      "timeseries.json",
      "history/20260930T18Z.json",
      "anvil/latest.json",
      "anvil/timeseries.json",
      "anvil/history/20260917T17Z.json",
    ]) {
      expect(hpcPath(p), p).toBe(p);
    }
  });

  it("refuses traversal, other folders and odd spellings", () => {
    for (const p of [
      "",
      "../latest.json",
      "history/../latest.json",
      "anvil/../latest.json",
      "anvil/..json",
      "/latest.json",
      "latest.json/",
      "anvil/x/y.json",
      "anvil_v2/latest.json",
      "other.json",
      "Latest.json",
      "latest.JSON",
      "history/2026-09-30.json",
      "history/20260930T18Z.json.bak",
      "latest.json\n",
      "anvil%2Flatest.json",
      "anvil\\latest.json",
    ]) {
      expect(hpcPath(p), JSON.stringify(p)).toBeNull();
    }
    expect(hpcPath(null)).toBeNull();
    expect(hpcPath(undefined)).toBeNull();
  });
});

describe("acceptedDigests", () => {
  const a = "a".repeat(64);
  const b = "B".repeat(64);

  it("falls back to the baked-in digest only when the variable is unset or blank", () => {
    expect(acceptedDigests({})).toHaveLength(1);
    expect(acceptedDigests({ INGEST_TOKEN_SHA256: "  " })).toEqual(acceptedDigests({}));
  });

  it("reads a comma-separated list, lowercased, and drops malformed entries", () => {
    expect(acceptedDigests({ INGEST_TOKEN_SHA256: ` ${a} , ${b} ,nope` })).toEqual([a, b.toLowerCase()]);
  });

  it("rejects every token when the variable holds no valid digest", () => {
    expect(acceptedDigests({ INGEST_TOKEN_SHA256: "not-a-digest" })).toEqual([]);
  });
});

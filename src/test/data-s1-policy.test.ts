// @vitest-environment node
import { describe, expect, it } from "vitest";
import { handle, type Deps } from "../../workers/data/src/handler";
import { isBlocked, POLICY_VERSION } from "../../workers/data/src/policy";

const HEX = "00112233445566778899aabbccddeeff";
const EXCLUDED_GSM = "GSM10000152"; // first excluded sample in policy/alpha-policy.json
const WITHHELD_GSE = "GSE145370";

describe("Research Alpha policy on /s1/*", () => {
  it("has a policy version", () => expect(POLICY_VERSION).toMatch(/^alpha-/));

  it("blocks withheld studies' manifests and cell tables", () => {
    expect(isBlocked(`s1/m/${WITHHELD_GSE}.json`)).toBe(true);
    expect(isBlocked(`/v2/m/${WITHHELD_GSE}.json`)).toBe(true);
    expect(isBlocked(`s1/cells/${WITHHELD_GSE}.cells`)).toBe(true);
    expect(isBlocked("s1/m/GSE1.json")).toBe(false);
  });

  it("blocks excluded samples' objects and label sidecars", () => {
    expect(isBlocked(`s1/s/${EXCLUDED_GSM}/${HEX}.s1`)).toBe(true);
    expect(isBlocked(`v2/s/${EXCLUDED_GSM}/${HEX}.s2`)).toBe(true);
    expect(isBlocked(`s1/a/${EXCLUDED_GSM}/${HEX}.parquet`)).toBe(true);
    expect(isBlocked(`s1/s/GSM1/${HEX}.s1`)).toBe(false);
    expect(isBlocked(`s1/ref/${HEX}.pack`)).toBe(false);
  });

  it("answers 404 without touching R2", async () => {
    let reads = 0;
    const deps: Deps = {
      bucket: { get: async () => (reads++, null), head: async () => (reads++, null) },
      cache: null,
      waitUntil: () => {},
    };
    for (const p of [`/s1/s/${EXCLUDED_GSM}/${HEX}.s1`, `/s1/m/${WITHHELD_GSE}.json`]) {
      for (const method of ["GET", "HEAD"]) {
        const r = await handle(new Request(`https://data.singlet.bio${p}`, { method }), deps);
        expect(r.status).toBe(404);
      }
    }
    expect(reads).toBe(0);
  });
});

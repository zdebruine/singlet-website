// @vitest-environment node
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_INDICES,
  PackError,
  clearPackCache,
  packIdOf,
  resolveBarcodeNames,
  resolveFeatureNames,
  resolvePackId,
  type PackFetcher,
  type PackIndexEntry,
} from "../../functions/_shared/s1-packs";

/**
 * Fixtures come from the Python reference (src/test/fixtures/s1/packs/make_pack_fixtures.py): every name below was
 * expanded by python/singlet/s1/packs.py, the TypeScript reader has to agree with it for every index.
 */
const DIR = "src/test/fixtures/s1/packs";
interface Expected {
  id: string;
  kind: string;
  build?: string;
  member?: string;
  n: number;
  k?: number;
  names: string[];
}
const expected = JSON.parse(readFileSync(`${DIR}/expected.json`, "utf8")) as Record<string, Expected> & { _derived_from: Record<string, string> };
const indexDoc = JSON.parse(readFileSync(`${DIR}/index.json`, "utf8")) as { packs: PackIndexEntry[] };

const bytesOf = (id: string) => new Uint8Array(readFileSync(`${DIR}/${id}.pack`));

function packs(extra: Record<string, Uint8Array> = {}) {
  const calls: string[] = [];
  const fetchPack: PackFetcher = async (id) => {
    calls.push(id);
    return extra[id] ?? bytesOf(id);
  };
  return { fetchPack, calls };
}

beforeEach(() => clearPackCache());

const VOCAB_PACKS = ["A.exon", "A.intron", "B.exon", "B.intron", "C.exon", "C.intron", "AB.exon", "AB.intron"] as const;

describe("feature names, against the Python reference", () => {
  for (const name of VOCAB_PACKS) {
    it(`${name}: every row, in order and shuffled`, async () => {
      const e = expected[name];
      const { fetchPack } = packs();
      const all = Array.from({ length: e.n }, (_, i) => i);
      const r = await resolveFeatureNames(fetchPack, e.id, all);
      expect(r.names).toEqual(e.names);
      expect(r.pack).toEqual({ id: e.id, kind: e.kind, build: e.build, member: e.member, n: e.n });
      const shuffled = [...all].reverse().concat(all.filter((i) => i % 2 === 0));
      const r2 = await resolveFeatureNames(fetchPack, e.id, shuffled);
      expect(r2.names).toEqual(shuffled.map((i) => e.names[i]));
    });
  }

  it("covers the grammar corners the fixtures were built for", () => {
    expect(expected["A.exon"].names).toContain("ENSG00000000005__chr1:1000-1100"); // empty symbol
    expect(expected["A.exon"].names).toContain("ENSG00000000457_ENSG00000000457_chrX:90-95"); // symbol == gene id
    expect(expected["A.exon"].names).toContain("ENSG00000000003_TSPAN6_chrX:300-450"); // explicit symbol
    expect(expected["B.intron"].n).toBe(0); // no introns at all: empty gap stream
    expect(expected["C.exon"].names[2]).toBe("FBgn12345678__3R:1-2"); // id longer than the pad width
    expect(expected["AB.exon"].names.some((n) => n.includes("_GRCm39___chr3:"))).toBe(true);
    expect(expected["AB.intron"].names.some((n) => n.includes("_intron_GRCh38___chrX:"))).toBe(true); // tag after intron_
  });

  it("gives null for an index past the end, never a wrong name", async () => {
    const { fetchPack } = packs();
    const e = expected["A.exon"];
    const r = await resolveFeatureNames(fetchPack, e.id, [0, e.n - 1, e.n, e.n + 1, 1e12, Number.MAX_SAFE_INTEGER]);
    expect(r.names).toEqual([e.names[0], e.names[e.n - 1], null, null, null, null]);
    const none = await resolveFeatureNames(fetchPack, expected["B.intron"].id, [0, 1]);
    expect(none.names).toEqual([null, null]);
    expect((await resolveFeatureNames(fetchPack, e.id, [])).names).toEqual([]);
  });

  it("numbers rows across the parts of a composite", async () => {
    const { fetchPack } = packs();
    const a = expected["A.exon"];
    const b = expected["B.exon"];
    const ab = expected["AB.exon"];
    expect(ab.n).toBe(a.n + b.n);
    const r = await resolveFeatureNames(fetchPack, ab.id, [a.n - 1, a.n]);
    expect(r.names).toEqual([ab.names[a.n - 1], ab.names[a.n]]);
    expect(r.names[0]).toBe("ENSG00000001084_GCLC_GRCh38___chr2:20-30");
    expect(r.names[1]).toBe("ENSMUSG00000000001_Gnai3_GRCm39___chr3:5000-5100");
  });
});

describe("fetching", () => {
  it("an SVP0 exon pack is one fetch; an SVPD intron pack fetches its exon pack through the fetcher", async () => {
    const s1 = packs();
    await resolveFeatureNames(s1.fetchPack, expected["A.exon"].id, [0]);
    expect(s1.calls).toEqual([expected["A.exon"].id]);
    clearPackCache();
    const s2 = packs();
    await resolveFeatureNames(s2.fetchPack, expected["A.intron"].id, [0]);
    expect(s2.calls).toEqual([expected["A.intron"].id, expected._derived_from["A.intron"]]);
  });

  it("a composite fetches itself and its components (and the exon packs of intron components)", async () => {
    const s1 = packs();
    await resolveFeatureNames(s1.fetchPack, expected["AB.exon"].id, [0]);
    expect(s1.calls).toEqual([expected["AB.exon"].id, expected["A.exon"].id, expected["B.exon"].id]);
    clearPackCache();
    const s2 = packs();
    await resolveFeatureNames(s2.fetchPack, expected["AB.intron"].id, [0]);
    expect(s2.calls).toEqual([expected["AB.intron"].id, expected["A.intron"].id, expected["A.exon"].id, expected["B.intron"].id, expected["B.exon"].id]);
  });

  it("a decoded pack is cached: the second call and a concurrent call fetch nothing more", async () => {
    const s = packs();
    const id = expected["A.intron"].id;
    await Promise.all([resolveFeatureNames(s.fetchPack, id, [0]), resolveFeatureNames(s.fetchPack, id, [1])]);
    expect(s.calls).toHaveLength(2); // intron + exon, once
    await resolveFeatureNames(s.fetchPack, id, [2]);
    expect(s.calls).toHaveLength(2);
    // the exon table decoded for the intron pack serves the exon pack too
    await resolveFeatureNames(s.fetchPack, expected["A.exon"].id, [0]);
    expect(s.calls).toHaveLength(3); // the exon pack is fetched once to read its header; the gene table is not decoded twice
  });

  it("keeps at most three decoded packs, oldest first", async () => {
    const s = packs();
    const ids = ["A.exon", "B.exon", "C.exon", "A.intron"].map((k) => expected[k].id);
    for (const id of ids.slice(0, 3)) await resolveFeatureNames(s.fetchPack, id, [0]);
    expect(s.calls).toHaveLength(3);
    await resolveFeatureNames(s.fetchPack, ids[0], [0]); // still cached
    expect(s.calls).toHaveLength(3);
    await resolveFeatureNames(s.fetchPack, ids[3], [0]); // a fourth pack evicts the oldest (A.exon)
    const before = s.calls.length;
    await resolveFeatureNames(s.fetchPack, ids[0], [0]);
    expect(s.calls.length).toBeGreaterThan(before);
  });

  it("does not cache a failure", async () => {
    let fail = true;
    const id = expected["A.exon"].id;
    const fetchPack: PackFetcher = async () => {
      if (fail) throw new Error("R2 said no");
      return bytesOf(id);
    };
    await expect(resolveFeatureNames(fetchPack, id, [0])).rejects.toThrow(/could not fetch pack .*R2 said no/);
    fail = false;
    expect((await resolveFeatureNames(fetchPack, id, [0])).names).toEqual([expected["A.exon"].names[0]]);
  });

  it("refuses a file that does not hash to the id it was fetched under", async () => {
    const wanted = expected["A.exon"].id;
    const s = packs({ [wanted]: bytesOf(expected["B.exon"].id) });
    const err = await resolveFeatureNames(s.fetchPack, wanted, [0]).catch((e) => e);
    expect(err).toBeInstanceOf(PackError);
    expect(String(err.message)).toMatch(/does not match its id/);
    // also for the exon pack an intron pack points at
    clearPackCache();
    const s2 = packs({ [expected._derived_from["A.intron"]]: bytesOf(expected["C.exon"].id) });
    await expect(resolveFeatureNames(s2.fetchPack, expected["A.intron"].id, [0])).rejects.toThrow(/does not match its id/);
  });

  it("rejects a malformed id before fetching anything", async () => {
    const s = packs();
    for (const bad of ["", "xyz", "8A52061D15063BEBC9F3FB8C17E3E28", "8a52061d15063bebc9f3fb8c17e3e287ff", "8a52061d15063beb"]) {
      await expect(resolveFeatureNames(s.fetchPack, bad, [0]), bad).rejects.toBeInstanceOf(PackError);
    }
    expect(s.calls).toHaveLength(0);
  });
});

describe("whitelists", () => {
  for (const name of ["W16", "W32"] as const) {
    it(`${name}: every index, unordered, with duplicates and out-of-range`, async () => {
      const e = expected[name];
      const { fetchPack } = packs();
      const all = Array.from({ length: e.n }, (_, i) => i);
      const r = await resolveBarcodeNames(fetchPack, e.id, all);
      expect(r.names).toEqual(e.names);
      expect(r.pack).toEqual({ id: e.id, kind: "whitelist", k: e.k, n: e.n, protocol: name === "W16" ? "fixture-16" : "fixture-32" });
      const odd = [e.n - 1, 0, 5, 5, e.n, e.n + 10, 3, e.n - 2];
      const r2 = await resolveBarcodeNames(fetchPack, e.id, odd);
      expect(r2.names).toEqual(odd.map((i) => e.names[i] ?? null));
    });
  }

  it("the names are sorted and the 32-mers use the whole 64-bit range", () => {
    for (const name of ["W16", "W32"] as const) {
      const names = expected[name].names;
      expect([...names].sort()).toEqual(names);
    }
    expect(expected.W32.names.some((b) => b.startsWith("T") || b.startsWith("G"))).toBe(true); // top bits set
  });

  it("a feature call on a whitelist and a barcode call on a vocabulary are refused", async () => {
    const { fetchPack } = packs();
    await expect(resolveFeatureNames(fetchPack, expected.W16.id, [0])).rejects.toThrow(/barcode whitelist/);
    await expect(resolveBarcodeNames(fetchPack, expected["A.exon"].id, [0])).rejects.toThrow(/not a barcode whitelist/);
  });
});

describe("the pack index", () => {
  it("resolves an 8-byte prefix or a full id to the unique full id", () => {
    for (const k of Object.keys(expected)) {
      if (k.startsWith("_")) continue;
      const id = expected[k].id;
      expect(resolvePackId(indexDoc, id.slice(0, 16))).toBe(id);
      expect(resolvePackId(indexDoc.packs, id)).toBe(id);
      expect(resolvePackId(indexDoc, id.slice(0, 16).toUpperCase())).toBe(id);
      expect(resolvePackId({ packs: indexDoc.packs }, id.slice(0, 24))).toBe(id);
    }
  });

  it("refuses unknown, ambiguous and malformed ids", () => {
    expect(() => resolvePackId(indexDoc, "0000000000000000")).toThrow(/not in the pack index/);
    expect(() => resolvePackId(indexDoc, expected["A.exon"].id.slice(0, 15))).toThrow(/16 to 32 hex/);
    expect(() => resolvePackId(indexDoc, "not hex at all!!!!")).toThrow(PackError);
    expect(() => resolvePackId({}, "8a52061d15063beb")).toThrow(/not in the pack index/);
    const twins: PackIndexEntry[] = [
      { id: "aaaaaaaaaaaaaaaa00000000000000aa", kind: "vocab" },
      { id: "aaaaaaaaaaaaaaaa11111111111111bb", kind: "vocab" },
    ];
    expect(() => resolvePackId(twins, "aaaaaaaaaaaaaaaa")).toThrow(/ambiguous/);
    expect(resolvePackId(twins, "aaaaaaaaaaaaaaaa0000")).toBe(twins[0].id);
    // the same id listed twice is not ambiguous
    expect(resolvePackId([twins[0], twins[0]], "aaaaaaaaaaaaaaaa")).toBe(twins[0].id);
    // a full id that is not listed is unknown even if it is well formed
    expect(() => resolvePackId(indexDoc, "ffffffffffffffffffffffffffffffff")).toThrow(/not in the pack index/);
  });
});

describe("bad input", () => {
  it("limits and validates the indices", async () => {
    const { fetchPack } = packs();
    const id = expected["A.exon"].id;
    const ok = Array.from({ length: MAX_INDICES }, (_, i) => i % 12);
    expect((await resolveFeatureNames(fetchPack, id, ok)).names).toHaveLength(MAX_INDICES);
    for (const bad of [[...ok, 0], [-1], [1.5], [NaN], [Infinity], [2 ** 53], ["1" as unknown as number], [null as unknown as number], "0" as unknown as number[]]) {
      await expect(resolveFeatureNames(fetchPack, id, bad), JSON.stringify(bad)?.slice(0, 40)).rejects.toBeInstanceOf(PackError);
    }
    await expect(resolveBarcodeNames(fetchPack, expected.W16.id, [-1])).rejects.toBeInstanceOf(PackError);
  });

  /** A fetcher serving crafted bytes under the id they hash to, so the id check passes and the parser has to cope. */
  async function serve(bytes: Uint8Array): Promise<{ id: string; fetchPack: PackFetcher }> {
    const id = await packIdOf(bytes);
    return { id, fetchPack: async () => bytes };
  }

  it("not a pack, truncated headers, other versions and kinds are PackErrors", async () => {
    const good = bytesOf(expected["A.exon"].id);
    const patched = (at: number, value: number) => {
      const b = good.slice();
      b[at] = value;
      return b;
    };
    const cases: [string, Uint8Array, RegExp][] = [
      ["empty", new Uint8Array(0), /not an SPK2 pack/],
      ["bad magic", patched(0, 0x58), /not an SPK2 pack/],
      ["too short", good.slice(0, 11), /not an SPK2 pack/],
      ["version 2", patched(4, 2), /unsupported pack version/],
      ["header longer than the file", good.slice(0, 30), /truncated pack header/],
      ["unknown kind", patched(6, 9), /unknown kind/],
    ];
    for (const [label, bytes, re] of cases) {
      const { id, fetchPack } = await serve(bytes);
      const err = await resolveFeatureNames(fetchPack, id, [0]).catch((e) => e);
      expect(err, label).toBeInstanceOf(PackError);
      expect(String(err.message), label).toMatch(re);
    }
  });

  /** Cut points: every length through the SPK2 header and the first body bytes, then a stride (each probe hashes the file). */
  const cuts = (n: number, stride: number) => Array.from({ length: n }, (_, i) => i).filter((i) => i < 40 || i % stride === 0 || i === n - 1);

  it("a truncated real pack is a PackError, never another exception", async () => {
    for (const name of ["A.exon", "AB.exon", "A.intron"] as const) {
      const good = bytesOf(expected[name].id);
      for (const len of cuts(good.length, 11)) {
        const { id, fetchPack } = await serve(good.slice(0, len));
        clearPackCache();
        const err = await resolveFeatureNames(fetchPack, id, [0]).catch((e) => e);
        expect(err, `${name} cut at ${len}`).toBeInstanceOf(PackError);
      }
    }
    for (const name of ["W16", "W32"] as const) {
      const good = bytesOf(expected[name].id);
      for (const len of cuts(good.length, 37)) {
        const { id, fetchPack } = await serve(good.slice(0, len));
        clearPackCache();
        const err = await resolveBarcodeNames(fetchPack, id, [0]).catch((e) => e);
        expect(err, `${name} cut at ${len}`).toBeInstanceOf(PackError);
      }
    }
  }, 60_000);

  it("a flipped byte either decodes or is a PackError (no other exception, no hang)", async () => {
    for (const name of ["A.exon", "C.exon"] as const) {
      const good = bytesOf(expected[name].id);
      for (let at = 0; at < good.length; at += 3) {
        const b = good.slice();
        b[at] ^= 0xff;
        const { id, fetchPack } = await serve(b);
        clearPackCache();
        try {
          await resolveFeatureNames(fetchPack, id, [0, 1, 2, 5, 11]);
        } catch (e) {
          expect(e, `${name} byte ${at}`).toBeInstanceOf(PackError);
        }
      }
    }
  }, 60_000);

  it("an SVPD pack whose body is not a digest is refused", async () => {
    const good = bytesOf(expected["A.intron"].id);
    const { id, fetchPack } = await serve(good.slice(0, good.length - 1));
    await expect(resolveFeatureNames(fetchPack, id, [0])).rejects.toThrow(/expected 16/);
  });
});

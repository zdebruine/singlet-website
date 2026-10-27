// @vitest-environment node
// Categorical (text) filters on the cells table: string columns (dtype 8, NUL-terminated UTF-8, raw or zstd) as find_cells reads them.
import { zstdCompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CellsError, DT_BOOL, DT_STR, DT_U32, filterCells, openCells, parseCellFilter } from "../../functions/_shared/s1-cells";
import { labelMaskFromTable, resolveLabels } from "../../functions/_shared/mcp-s1";
import { createTestD1 } from "./helpers/d1-sqlite";

const hasZstd = typeof zstdCompressSync === "function";
const NUL = String.fromCharCode(0);

type Col = { name: string; dtype: number; enc: number; body: Uint8Array };

/** A CEL2 table as singlet.s1.cells writes it: header, directory, bodies at multiples of 64. */
function cel2(nRows: number, cols: Col[]): Uint8Array {
  const enc = new TextEncoder();
  const names = cols.map((c) => enc.encode(c.name));
  let dirLen = 12;
  for (const n of names) dirLen += 2 + n.length + 18;
  const offs: number[] = [];
  let p = Math.ceil(dirLen / 64) * 64;
  for (const c of cols) {
    offs.push(p);
    p = Math.ceil((p + c.body.length) / 64) * 64;
  }
  const out = new Uint8Array(Math.max(p, dirLen));
  const dv = new DataView(out.buffer);
  out.set([0x43, 0x45, 0x4c, 0x32], 0);
  dv.setUint16(4, 1, true);
  dv.setUint16(6, cols.length, true);
  dv.setUint32(8, nRows, true);
  let q = 12;
  cols.forEach((c, i) => {
    dv.setUint16(q, names[i].length, true);
    out.set(names[i], q + 2);
    q += 2 + names[i].length;
    out[q] = c.dtype;
    out[q + 1] = c.enc;
    dv.setUint32(q + 2, offs[i], true);
    dv.setUint32(q + 10, c.body.length, true);
    q += 18;
    out.set(c.body, offs[i]);
  });
  return out;
}

const strBody = (vals: string[]) => new TextEncoder().encode(vals.join(NUL) + NUL);
const boolBody = (vals: number[]) => {
  const b = new Uint8Array(Math.ceil(vals.length / 8));
  vals.forEach((v, i) => (b[i >> 3] |= v ? 1 << (i & 7) : 0));
  return b;
};
const u32Body = (vals: number[]) => new Uint8Array(Uint32Array.from(vals).buffer);

const TYPES = ["T cell", "B cell", "t cell", "", "monocyte", "T cell"];
const SEX = ["female", "female", "male", "male", "female", "ambiguous"];
const CALLED = [1, 1, 1, 0, 1, 1];

function table(strEnc: 0 | 1 = 0) {
  const s = (v: string[]) => (strEnc === 1 ? new Uint8Array(zstdCompressSync(strBody(v))) : strBody(v));
  return cel2(6, [
    { name: "called", dtype: DT_BOOL, enc: 0, body: boolBody(CALLED) },
    { name: "n_umi_exon", dtype: DT_U32, enc: 0, body: u32Body([10, 20, 30, 40, 50, 60]) },
    { name: "cell_type", dtype: DT_STR, enc: strEnc, body: s(TYPES) },
    { name: "sex", dtype: DT_STR, enc: strEnc, body: s(SEX) },
  ]);
}
const open = (buf: Uint8Array) => openCells(async (off, len) => buf.slice(off, off + len), buf.length);
const rows = (runs: number[]) => {
  const out: number[] = [];
  for (let k = 0; k < runs.length; k += 2) for (let i = runs[k]; i < runs[k] + runs[k + 1]; i++) out.push(i);
  return out;
};

describe("text columns in the cells table", () => {
  for (const enc of hasZstd ? ([0, 1] as const) : ([0] as const)) {
    it(`decodes a string column (enc ${enc}) and filters it with in / not_in / == / !=, case-insensitively`, async () => {
      const t = await open(table(enc));
      expect(await t.strings("cell_type")).toEqual(TYPES);
      const f = (where: unknown) => {
        const p = parseCellFilter({ where });
        if ("error" in p) throw new Error(p.error);
        return p.filter;
      };
      // called cells only (row 3 is not called)
      expect(rows((await filterCells(t, f([{ column: "cell_type", op: "in", value: ["T CELL"] }]))).runs)).toEqual([0, 2, 5]);
      expect(rows((await filterCells(t, f([{ column: "cell_type", op: "==", value: "monocyte" }]))).runs)).toEqual([4]);
      expect(rows((await filterCells(t, f([{ column: "cell_type", op: "not_in", value: ["t cell", "b cell"] }]))).runs)).toEqual([4]);
      expect(rows((await filterCells(t, f([{ column: "sex", op: "!=", value: "female" }, { column: "n_umi_exon", op: ">=", value: 30 }]))).runs)).toEqual([2, 5]);
    });
  }

  it("ANDs an allow mask (the atlas cell index's labelled cells) with the filter", async () => {
    const t = await open(table());
    const allow = Uint8Array.from([0, 1, 1, 1, 1, 0]);
    const r = await filterCells(t, {}, { allow });
    expect(rows(r.runs)).toEqual([1, 2, 4]);
    expect(r.nMatch).toBe(3);
  });

  it("refuses a text value on a numeric column, a number on a text column, and bad clauses", async () => {
    const t = await open(table());
    await expect(filterCells(t, { where: [{ column: "n_umi_exon", op: "in", value: ["1"] }] })).rejects.toBeInstanceOf(CellsError);
    await expect(filterCells(t, { where: [{ column: "cell_type", op: ">=", value: 3 }, { column: "cell_type", op: "in", value: ["x"] }] })).rejects.toThrow(/text column/);
    expect(parseCellFilter({ where: [{ column: "cell_type", op: ">=", value: "T cell" }] })).toHaveProperty("error");
    expect(parseCellFilter({ where: [{ column: "cell_type", op: "==", value: ["a", "b"] }] })).toHaveProperty("error");
    expect(parseCellFilter({ where: [{ column: "cell_type", op: "in", value: [] }] })).toHaveProperty("error");
    expect(parseCellFilter({ where: [{ column: "cell_type", op: "in", value: Array(101).fill("x") }] })).toHaveProperty("error");
  });

  it("refuses a string column whose value count does not match the rows", async () => {
    const bad = cel2(6, [{ name: "cell_type", dtype: DT_STR, enc: 0, body: strBody(["a", "b"]) }]);
    const t = await open(bad);
    await expect(t.strings("cell_type")).rejects.toThrow(/holds 2 values, expected 6/);
  });
});

describe("label columns of the cells table (the transcode writes them into every object)", () => {
  // rows: CD4 T, CD8 T, B, no call, monocyte, CD4 T
  const PATH = ["CL:0000542>CL:0000084>CL:0000624", "CL:0000542>CL:0000084>CL:0000625", "CL:0000542>CL:0000236", "", "CL:0000576", "CL:0000542>CL:0000084>CL:0000624"];
  const LABEL = ["CD4-positive, alpha-beta T cell", "CD8-positive, alpha-beta T cell", "B cell", "", "monocyte", "CD4-positive, alpha-beta T cell"];
  const SEXC = ["female", "male", "female", "", "female", "female"];
  const ANC = ["HANCESTRO:0005", "HANCESTRO:0005", "HANCESTRO:0010", "", "HANCESTRO:0005", ""];
  const labelled = () =>
    cel2(6, [
      { name: "called", dtype: DT_BOOL, enc: 0, body: boolBody([1, 1, 1, 1, 1, 1]) },
      { name: "cell_type_cl", dtype: DT_STR, enc: 0, body: strBody(PATH.map((x) => x.split(">").pop() ?? "")) },
      { name: "cell_type_label", dtype: DT_STR, enc: 0, body: strBody(LABEL) },
      { name: "cell_type_path", dtype: DT_STR, enc: 0, body: strBody(PATH) },
      { name: "sex_chrom", dtype: DT_STR, enc: 0, body: strBody(SEXC) },
      { name: "ancestry_hancestro", dtype: DT_STR, enc: 0, body: strBody(ANC) },
    ]);
  const idx = (m: Uint8Array | null) => [...(m ?? [])].map((v, i) => (v ? i : -1)).filter((i) => i >= 0);

  it("matches a cell type at any level of the call (ids, or labels through label_term), sex and ancestry (ids or labels)", async () => {
    const db = createTestD1(readFileSync("schema/039_s1_labels.sql", "utf8"));
    db.raw.exec(`INSERT INTO label_term (term_id, subject, label) VALUES ('CL:0000084', 'cell_type', 'T cell'), ('CL:0000542', 'cell_type', 'lymphocyte')`);
    const t = await open(labelled());
    const run = async (labels: Parameters<typeof resolveLabels>[1]) => idx(await labelMaskFromTable(t, await resolveLabels(db as unknown as D1Database, labels), labels));
    expect(await run({ cell_type: ["T cell"] })).toEqual([0, 1, 5]);
    expect(await run({ cell_type: ["cl:0000624"] })).toEqual([0, 5]);
    expect(await run({ cell_type: ["lymphocyte"] })).toEqual([0, 1, 2, 5]);
    expect(await run({ cell_type: ["monocyte"] })).toEqual([4]); // not in label_term: the label as written
    expect(await run({ sex: ["female"], ancestry: ["European"] })).toEqual([0, 4]);
    expect(await run({ sex: ["unknown"] })).toEqual([3]);
    expect(await run({ cell_type: ["T cell"], ancestry: ["HANCESTRO:0005"] })).toEqual([0, 1]);
  });

  it("says null (ask the cell index) when the table has no label columns", async () => {
    const t = await open(table());
    const labels = { cell_type: ["T cell"] };
    expect(await labelMaskFromTable(t, { cellTypeIds: new Set(["CL:0000084"]), cellTypeLabels: new Set(), sexes: null, ancestryIds: null }, labels)).toBeNull();
  });

  it("a cells-table filter can name the label columns directly: contains on the path finds every subtype", async () => {
    const t = await open(labelled());
    const p = parseCellFilter({ where: [{ column: "cell_type_path", op: "contains", value: ["CL:0000084"] }, { column: "sex_chrom", op: "==", value: "female" }] });
    if ("error" in p) throw new Error(p.error);
    expect(rows((await filterCells(t, p.filter)).runs)).toEqual([0, 5]);
  });
});

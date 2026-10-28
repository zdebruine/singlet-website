// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { costOf, estimateSql, fmtUsd, splitStatements } from "../../functions/_shared/write-cost";
import { dailyBudget, reserveWrites, DEFAULT_DAILY_WRITE_ROWS } from "../../functions/_shared/write-budget";
import { onRequestPost } from "../../functions/api/ingest/[table]";
import { sha256Hex } from "../../functions/_shared/hash";
import { createTestD1 } from "./helpers/d1-sqlite";

const MIGRATION = readFileSync(fileURLToPath(new URL("../../schema/040_fts_trigger_scope.sql", import.meta.url)), "utf8");
const ROLLBACK = readFileSync(fileURLToPath(new URL("../../schema/040_fts_trigger_scope_rollback.sql", import.meta.url)), "utf8");

describe("write cost model", () => {
  it("splits on semicolons outside quotes and counts VALUES tuples", () => {
    const sql = `INSERT INTO gsm (gsm_id, characteristics) VALUES ('GSM1','a; b'),('GSM2','it''s;'),('GSM3',NULL);
      -- comment; with semicolon
      UPDATE gse SET r2_bundle_key = 'x' WHERE id = 'GSE1';`;
    expect(splitStatements(sql)).toHaveLength(2);
    const e = estimateSql(sql);
    expect(e.statements).toBe(2);
    expect(e.byTable.gsm).toBe(3 * 30);
    expect(e.byTable.gse).toBe(10);
    expect(e.guessed).toBe(true); // the UPDATE row count is a guess
  });

  it("does not count the tuples of an ON CONFLICT clause", () => {
    const e = estimateSql(`INSERT INTO sample_attr (a, b) VALUES (1, 2) ON CONFLICT(a) DO UPDATE SET b = (SELECT 3)`);
    expect(e.byTable.sample_attr).toBe(5);
  });

  it("prices the worst case at $1 per million rows", () => {
    expect(costOf(419_000_000).worstUsd).toBeCloseTo(419, 0);
    expect(fmtUsd(0.5)).toBe("$0.50");
    expect(costOf(10_000_000, 0).bestUsd).toBe(0); // inside the included 50M
    expect(costOf(10_000_000, 45_000_000).bestUsd).toBeCloseTo(5, 5);
  });
});

describe("daily write budget", () => {
  it("defaults to 1.5M rows and reads D1_DAILY_WRITE_ROWS", () => {
    expect(dailyBudget({})).toBe(DEFAULT_DAILY_WRITE_ROWS);
    expect(dailyBudget({ D1_DAILY_WRITE_ROWS: "abc" })).toBe(DEFAULT_DAILY_WRITE_ROWS);
    expect(dailyBudget({ D1_DAILY_WRITE_ROWS: "5000000" })).toBe(5_000_000);
  });

  it("counts reservations per UTC day and refuses once the day is over budget, with the cost in the message", async () => {
    const db = createTestD1();
    await db.exec(`CREATE TABLE meta_cache (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`);
    const env = { D1_DAILY_WRITE_ROWS: "1000" };
    const day = new Date("2026-10-27T10:00:00Z");
    expect(await reserveWrites(db as never, env, 600, day)).toMatchObject({ ok: true, used: 600 });
    const refused = await reserveWrites(db as never, env, 600, day);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toMatch(/costs? money.*approve it in Claude/s);
    // a refused call reserves nothing, and the next UTC day starts empty
    expect(await reserveWrites(db as never, env, 400, day)).toMatchObject({ ok: true, used: 1000 });
    expect(await reserveWrites(db as never, env, 900, new Date("2026-10-28T00:00:01Z"))).toMatchObject({ ok: true, used: 900 });
  });
});

const TOKEN = "t";
async function ingestEnv(over: Record<string, unknown> = {}) {
  const DB = createTestD1();
  await DB.exec(`CREATE TABLE meta_cache (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE study_card (gse_id TEXT PRIMARY KEY, card_json TEXT, summary_text TEXT, extractor_version TEXT, model TEXT, grounded INTEGER, updated_at TEXT)`);
  return { DB, INGEST_TOKEN_SHA256: await sha256Hex(TOKEN), ...over };
}
const post = (env: unknown, rows: unknown[]) =>
  onRequestPost({
    request: new Request("https://singlet.bio/api/ingest/study_card", {
      method: "POST",
      headers: { "X-Ingest-Token": TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    }),
    env,
    params: { table: "study_card" },
  } as never);

describe("POST /api/ingest/:table", () => {
  const row = { gse_id: "GSE1", card_json: "{}", extractor_version: "v1" };

  it("refuses with 429 before writing when the daily budget is spent", async () => {
    const env = await ingestEnv({ D1_DAILY_WRITE_ROWS: "2" });
    const res = await post(env, [row, { ...row, gse_id: "GSE2" }]); // 2 rows x 3 = 6 estimated
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toMatch(/Daily D1 write budget reached/);
    expect(await env.DB.prepare(`SELECT COUNT(*) AS c FROM study_card`).first("c")).toBe(0);
  });

  it("writes an unchanged row once: a re-post leaves the row and its stamp alone, a changed value updates it", async () => {
    vi.useFakeTimers();
    try {
      const env = await ingestEnv();
      vi.setSystemTime(new Date("2026-10-27T10:00:00Z"));
      expect((await post(env, [row])).status).toBe(200);
      const first = await env.DB.prepare(`SELECT updated_at FROM study_card WHERE gse_id = 'GSE1'`).first("updated_at");
      vi.setSystemTime(new Date("2026-10-27T11:00:00Z"));
      expect((await post(env, [row])).status).toBe(200);
      expect(await env.DB.prepare(`SELECT updated_at FROM study_card WHERE gse_id = 'GSE1'`).first("updated_at")).toBe(first);
      expect((await post(env, [{ ...row, card_json: '{"a":1}' }])).status).toBe(200);
      expect(await env.DB.prepare(`SELECT updated_at FROM study_card WHERE gse_id = 'GSE1'`).first("updated_at")).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("schema/040 scoped FTS triggers", () => {
  // The production shapes: external-content FTS5 tables and the pre-040 unscoped triggers (the rollback file is that exact text).
  const BASE = `
    CREATE TABLE gsm (gsm_id TEXT, gse_id TEXT, title TEXT, source TEXT, tissue TEXT, cell_type TEXT, organism TEXT, disease TEXT,
      characteristics TEXT, status TEXT, r2_note TEXT);
    CREATE VIRTUAL TABLE fts_gsm USING fts5(gsm_id, gse_id, title, source, tissue, cell_type, organism, disease, characteristics,
      content='gsm', content_rowid='rowid');
    CREATE TABLE gse (id TEXT, title TEXT, abstract TEXT, organism TEXT, r2_bundle_key TEXT);
    CREATE VIRTUAL TABLE fts_gse USING fts5(id, title, abstract, organism, content='gse', content_rowid='rowid');
    CREATE TRIGGER gsm_ai AFTER INSERT ON gsm BEGIN
      INSERT INTO fts_gsm(rowid, gsm_id, gse_id, title, source, tissue, cell_type, organism, disease, characteristics)
      VALUES (new.rowid, new.gsm_id, new.gse_id, new.title, new.source, new.tissue, new.cell_type, new.organism, new.disease, new.characteristics);
    END;
    CREATE TRIGGER gse_ai AFTER INSERT ON gse BEGIN
      INSERT INTO fts_gse(rowid, id, title, abstract, organism) VALUES (new.rowid, new.id, new.title, new.abstract, new.organism);
    END;`;

  function db(sql: string) {
    const raw = new DatabaseSync(":memory:");
    raw.exec(BASE);
    raw.exec(sql);
    return raw;
  }
  // A rewrite of an FTS5 row (delete + insert) adds a segment to the index: its data blocks change. A hash of them detects it.
  const fired = (raw: DatabaseSync) =>
    JSON.stringify(
      ["fts_gsm_data", "fts_gse_data"].map((t) => (raw.prepare(`SELECT id, hex(block) AS b FROM ${t} ORDER BY id`).all() as unknown[]))
    );
  const seed = `INSERT INTO gsm (gsm_id, gse_id, title, status) VALUES ('GSM1', 'GSE1', 'liver biopsy', 'DONE');
                INSERT INTO gse (id, title, abstract, organism) VALUES ('GSE1', 'liver atlas', 'abstract', 'Homo sapiens');`;
  const hit = (raw: DatabaseSync, q: string) => (raw.prepare(`SELECT COUNT(*) AS c FROM fts_gsm WHERE fts_gsm MATCH ?`).get(q) as { c: number }).c;

  it("before 040: a bookkeeping update rewrites the FTS row (the cost)", () => {
    const raw = db(ROLLBACK + seed);
    const before = fired(raw);
    raw.exec(`UPDATE gsm SET status = 'FAIL' WHERE gsm_id = 'GSM1'; UPDATE gse SET r2_bundle_key = 'k' WHERE id = 'GSE1'`);
    expect(fired(raw)).not.toBe(before);
  });

  it("after 040: bookkeeping updates leave FTS alone, text updates still reindex, search keeps working", () => {
    const raw = db(MIGRATION + seed);
    const before = fired(raw);
    raw.exec(`UPDATE gsm SET status = 'FAIL', r2_note = 'x' WHERE gsm_id = 'GSM1'; UPDATE gse SET r2_bundle_key = 'k' WHERE id = 'GSE1'`);
    expect(fired(raw)).toBe(before);
    expect(hit(raw, "liver")).toBe(1);
    raw.exec(`UPDATE gsm SET title = 'kidney biopsy' WHERE gsm_id = 'GSM1'; UPDATE gse SET abstract = 'new words' WHERE id = 'GSE1'`);
    expect(fired(raw)).not.toBe(before);
    expect(hit(raw, "kidney")).toBe(1);
    expect(hit(raw, "liver")).toBe(0);
    expect((raw.prepare(`SELECT COUNT(*) AS c FROM fts_gse WHERE fts_gse MATCH 'words'`).get() as { c: number }).c).toBe(1);
  });

  it("the migration only replaces the two update triggers", () => {
    expect(MIGRATION.match(/CREATE TRIGGER/g)).toHaveLength(2);
    expect(MIGRATION).toMatch(/gse_au AFTER UPDATE OF id, title, abstract, organism ON gse/);
    expect(MIGRATION).toMatch(/gsm_au AFTER UPDATE OF gsm_id, gse_id, title, source, tissue, cell_type, organism, disease, characteristics ON gsm/);
  });
});

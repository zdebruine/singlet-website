/**
 * A D1Database stand-in backed by node:sqlite, so tests run the real SQL
 * (upserts, WHERE-guarded conflicts, atomic counters) rather than a mock that
 * only repeats what the code under test already believes. Covers the subset of
 * the D1 API the Functions use: prepare/bind/run/first/all, batch, exec.
 * Tests that use it must run in the node environment:
 *   // @vitest-environment node
 */
import { DatabaseSync } from "node:sqlite";

type Bind = string | number | bigint | null | Uint8Array;

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    private readonly values: Bind[] = []
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(this.db, this.sql, values.map((v) => (v === undefined ? null : (v as Bind))));
  }

  async run() {
    const r = this.db.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }

  async all<T = Record<string, unknown>>() {
    const results = this.db.prepare(this.sql).all(...this.values) as T[];
    return { success: true, results, meta: { changes: 0 } };
  }

  async first<T = Record<string, unknown>>(col?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.values) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (col ? (row[col] ?? null) : row) as T | null;
  }
}

export interface TestD1 {
  prepare(sql: string): Statement;
  batch(stmts: Statement[]): Promise<unknown[]>;
  exec(sql: string): Promise<void>;
  raw: DatabaseSync;
}

export function createTestD1(schemaSql = ""): TestD1 & D1Database {
  const raw = new DatabaseSync(":memory:");
  if (schemaSql) raw.exec(schemaSql);
  const d1: TestD1 = {
    raw,
    prepare: (sql) => new Statement(raw, sql),
    async batch(stmts) {
      raw.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        raw.exec("COMMIT");
        return out;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
    async exec(sql) {
      raw.exec(sql);
    },
  };
  return d1 as TestD1 & D1Database;
}

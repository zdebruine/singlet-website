// @vitest-environment node
import { describe, expect, it } from "vitest";
import { rotateProjectToken } from "../../functions/_shared/product";
import { sha256Hex } from "../../functions/_shared/hash";
import { createTestD1 } from "./helpers/d1-sqlite";

const SCHEMA = `
CREATE TABLE projects (id TEXT PRIMARY KEY, owner_id TEXT, workspace_id TEXT, name TEXT, description TEXT, visibility TEXT,
                       read_token_hash TEXT, read_token_prefix TEXT, created_at TEXT, updated_at TEXT);
INSERT INTO projects (id, owner_id, name, read_token_hash, read_token_prefix, created_at, updated_at)
  VALUES ('p1', 'alice', 'Alice project', 'oldhash', 'spr_old', 't0', 't0');
`;
const ctx = (db: ReturnType<typeof createTestD1>) => ({ db, origin: "https://singlet.bio" });

describe("rotate_project_token", () => {
  it("replaces the stored hash, returns the new token once, and keeps only its hash", async () => {
    const db = createTestD1(SCHEMA);
    const out = (await rotateProjectToken(ctx(db), "alice", { project_id: "p1" })) as { read_token: string; project_id: string };
    expect(out.read_token).toMatch(/^spr_[0-9a-f]{48}$/);
    const row = await db.prepare(`SELECT read_token_hash, read_token_prefix FROM projects WHERE id = 'p1'`).first<{ read_token_hash: string; read_token_prefix: string }>();
    expect(row!.read_token_hash).toBe(await sha256Hex(out.read_token));
    expect(row!.read_token_hash).not.toBe("oldhash");
    expect(row!.read_token_prefix).toBe(out.read_token.slice(0, 12));
  });

  it("gives a different token every time", async () => {
    const db = createTestD1(SCHEMA);
    const a = (await rotateProjectToken(ctx(db), "alice", { project_id: "p1" })) as { read_token: string };
    const b = (await rotateProjectToken(ctx(db), "alice", { project_id: "p1" })) as { read_token: string };
    expect(a.read_token).not.toBe(b.read_token);
  });

  it("is for the owner only, and says not found rather than hinting the project exists", async () => {
    const db = createTestD1(SCHEMA);
    await expect(rotateProjectToken(ctx(db), "mallory", { project_id: "p1" })).rejects.toMatchObject({ status: 404 });
    const row = await db.prepare(`SELECT read_token_hash FROM projects WHERE id = 'p1'`).first<{ read_token_hash: string }>();
    expect(row!.read_token_hash).toBe("oldhash");
  });

  it("refuses a missing or unknown project id", async () => {
    const db = createTestD1(SCHEMA);
    await expect(rotateProjectToken(ctx(db), "alice", {})).rejects.toMatchObject({ status: 400 });
    await expect(rotateProjectToken(ctx(db), "alice", { project_id: "nope" })).rejects.toMatchObject({ status: 404 });
  });
});

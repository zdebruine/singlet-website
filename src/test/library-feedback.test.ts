// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestD1 } from "./helpers/d1-sqlite";
import { readFileSync } from "node:fs";
import {
  LibraryError,
  addItems,
  cleanIds,
  cleanName,
  createLibrary,
  deleteLibrary,
  listLibraries,
  removeItems,
  renameLibrary,
} from "../../functions/_shared/library";
import { HOURLY_LIMIT, cleanPage, parseFeedback, saveFeedback, underLimit } from "../../functions/_shared/feedback";

// The real migration, with the users table it references.
const SCHEMA =
  `CREATE TABLE users (id TEXT PRIMARY KEY);\nINSERT INTO users VALUES ('u1'), ('u2');\n` +
  readFileSync("schema/023_library_feedback.sql", "utf8");

const db = () => createTestD1(SCHEMA);

describe("library input", () => {
  it("cleans names and accessions", () => {
    expect(cleanName("  My   set ")).toBe("My set");
    expect(cleanName("")).toBeNull();
    expect(cleanName("x".repeat(61))).toBeNull();
    expect(cleanIds(["gse1", "GSE1", " GSE22 "])).toEqual(["GSE1", "GSE22"]);
    expect(cleanIds(["GSM1"])).toBeNull();
    expect(cleanIds("GSE1")).toBeNull();
  });
});

describe("library storage", () => {
  it("creates, adds, renames, removes and deletes", async () => {
    const d = db();
    const id = await createLibrary(d, "u1", "Brain", ["GSE1"]);
    expect(await addItems(d, "u1", id, ["GSE1", "GSE2", "GSE3"])).toBe(2);
    await renameLibrary(d, "u1", id, "Cortex");
    await removeItems(d, "u1", id, ["GSE2"]);
    const [lib] = await listLibraries(d, "u1");
    expect(lib.name).toBe("Cortex");
    expect([...lib.gse_ids].sort()).toEqual(["GSE1", "GSE3"]);
    await deleteLibrary(d, "u1", id);
    expect(await listLibraries(d, "u1")).toEqual([]);
    const left = await d.prepare("SELECT COUNT(*) AS n FROM library_items").first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it("never lets one user touch another user's library", async () => {
    const d = db();
    const id = await createLibrary(d, "u1", "Mine", ["GSE1"]);
    await expect(addItems(d, "u2", id, ["GSE9"])).rejects.toBeInstanceOf(LibraryError);
    await expect(renameLibrary(d, "u2", id, "Stolen")).rejects.toBeInstanceOf(LibraryError);
    await expect(deleteLibrary(d, "u2", id)).rejects.toBeInstanceOf(LibraryError);
    expect(await listLibraries(d, "u2")).toEqual([]);
    expect((await listLibraries(d, "u1"))[0].name).toBe("Mine");
  });
});

describe("feedback", () => {
  it("validates the form", () => {
    expect(parseFeedback({ message: "  " }).ok).toBe(false);
    expect(parseFeedback({ message: "x".repeat(4001) }).ok).toBe(false);
    expect(parseFeedback({ message: "hi", email: "nope" }).ok).toBe(false);
    const ok = parseFeedback({ message: "hi", category: "bug", email: "a@b.org", page: "/study/GSE1?x=1" });
    expect(ok.ok && ok.value).toEqual({ category: "bug", message: "hi", email: "a@b.org", page: "/study/GSE1" });
    const odd = parseFeedback({ message: "hi", category: "weird" });
    expect(odd.ok && odd.value.category).toBe("other");
  });

  it("keeps only a path from the page", () => {
    expect(cleanPage("/browse?q=secret#frag")).toBe("/browse");
    expect(cleanPage("https://evil.example/x")).toBeNull();
    expect(cleanPage(42)).toBeNull();
  });

  it("stores messages and throttles a sender", async () => {
    const d = db();
    const input = { category: "idea" as const, message: "more columns", email: null, page: "/browse" };
    for (let i = 0; i < HOURLY_LIMIT; i++) {
      expect(await underLimit(d, "anon-1")).toBe(true);
      await saveFeedback(d, { subject: "anon-1", userId: null, userAgent: "test" }, input);
    }
    expect(await underLimit(d, "anon-1")).toBe(false);
    expect(await underLimit(d, "anon-2")).toBe(true);
  });
});

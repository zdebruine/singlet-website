import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteQuotaSubject } from "@/components/auth/AuthProvider";

/**
 * The AI quota counter must be dropped whenever a different subject (a user,
 * or anonymous) is seen in this browser — including across the full page load
 * every sign-in ends with, which resets all in-memory state.
 */
describe("noteQuotaSubject", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("treats an unknown previous subject as a change", () => {
    expect(noteQuotaSubject(null)).toBe(true);
    expect(noteQuotaSubject(null)).toBe(false);
  });

  it("notices signing in across a page load (no in-memory fallback)", () => {
    noteQuotaSubject(null); // anonymous visit
    expect(noteQuotaSubject("u1")).toBe(true); // first check after the OAuth reload
    expect(noteQuotaSubject("u1")).toBe(false); // focus re-check, same user
  });

  it("notices a different user and signing out", () => {
    noteQuotaSubject("u1");
    expect(noteQuotaSubject("u2")).toBe(true);
    expect(noteQuotaSubject(null)).toBe(true);
    expect(noteQuotaSubject(null)).toBe(false);
  });

  it("prefers what this browser stored over the page's own memory", () => {
    noteQuotaSubject("u2"); // e.g. written by another tab
    expect(noteQuotaSubject("u2", "u1")).toBe(false);
  });

  it("falls back to the page's memory when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(noteQuotaSubject("u1", "u1")).toBe(false);
    expect(noteQuotaSubject("u1", null)).toBe(true);
    expect(noteQuotaSubject("u1")).toBe(true);
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SECURITY_HEADERS, isDataPath, onRequest, withSecurityHeaders } from "../../functions/_middleware";

describe("Function responses", () => {
  it("get the full security set without losing what the handler set", async () => {
    const res = withSecurityHeaders(new Response("{}", { status: 404, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }));
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    for (const name of Object.keys(SECURITY_HEADERS)) expect(res.headers.get(name), name).toBeTruthy();
    expect(res.headers.get("Strict-Transport-Security")).toMatch(/^max-age=\d{7,}; includeSubDomains$/);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("keeps a header the handler chose", () => {
    const res = withSecurityHeaders(new Response("x", { headers: { "Referrer-Policy": "no-referrer" } }));
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  const run = (path: string, body = "hello") =>
    (onRequest as unknown as (c: unknown) => Promise<Response>)({ request: new Request(`https://singlet.bio${path}`), next: async () => new Response(body) });

  it("wraps what the next handler returns for data paths, body included", async () => {
    for (const path of ["/api/stats", "/mcp", "/auth/github/callback", "/sitemap.xml"]) {
      const res = await run(path);
      expect(await res.text(), path).toBe("hello");
      expect(res.headers.get("X-Frame-Options"), path).toBe("DENY");
    }
  });

  it("never puts the data-only CSP on the app or static files, which would block their scripts", async () => {
    for (const path of ["/", "/browse", "/assets/index-abc.js", "/study/GSE1"]) {
      expect(isDataPath(path), path).toBe(false);
      expect((await run(path)).headers.get("Content-Security-Policy"), path).toBeNull();
    }
  });
});

describe("static headers file", () => {
  const text = readFileSync("public/_headers", "utf8");
  it("sets the same protections for pages", () => {
    for (const h of ["X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy", "Strict-Transport-Security", "Content-Security-Policy:"]) {
      expect(text, h).toContain(h);
    }
  });
  it("enforces only the safe CSP directives and reports the rest", () => {
    const enforced = /^\s*Content-Security-Policy: (.*)$/m.exec(text)?.[1] ?? "";
    expect(enforced).toContain("frame-ancestors 'none'");
    expect(enforced).not.toContain("script-src");
    expect(/^\s*Content-Security-Policy-Report-Only: .*script-src 'self'/m.test(text)).toBe(true);
  });
});

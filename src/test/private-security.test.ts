/**
 * Guards around private projects and sessions: the registered-URL SSRF check,
 * the header allowlist for URL-backed downloads, upload part sizing, and
 * cookie parsing that must never throw.
 */
import { describe, expect, it } from "vitest";
import { assertPublicBundleUrl } from "../../functions/_shared/private-indexer";
import { PART_BYTES, partLength, privateDownloadHeaders } from "../../functions/_shared/private-project";
import { readCookie, readSessionToken } from "../../functions/_shared/session";

const blocked = (host: string) => () => assertPublicBundleUrl(`https://${host}/study.singlet`);

describe("assertPublicBundleUrl", () => {
  it("accepts public hosts", () => {
    expect(assertPublicBundleUrl("https://example.org/a/b.singlet").hostname).toBe("example.org");
    expect(() => blocked("8.8.8.8")()).not.toThrow();
    expect(() => blocked("[2606:4700::1111]")()).not.toThrow();
    // Names that merely start like an IPv6 prefix are ordinary DNS names.
    expect(() => blocked("fcc.gov")()).not.toThrow();
    expect(() => blocked("fdic.gov")()).not.toThrow();
  });

  it("refuses non-https URLs and other file types", () => {
    expect(() => assertPublicBundleUrl("http://example.org/a.singlet")).toThrow();
    expect(() => assertPublicBundleUrl("https://example.org/a.zip")).toThrow();
    expect(() => assertPublicBundleUrl("https://user:pw@example.org/a.singlet")).toThrow();
  });

  it("refuses private and reserved IPv4, in any spelling", () => {
    for (const host of ["127.0.0.1", "2130706433", "0x7f.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.1.2.3", "0.0.0.0", "224.0.0.1", "255.255.255.255"]) {
      expect(blocked(host), host).toThrow();
    }
  });

  it("refuses non-global IPv6, including IPv4-mapped and NAT64", () => {
    for (const host of ["[::1]", "[::]", "[::ffff:127.0.0.1]", "[::ffff:a00:1]", "[64:ff9b::7f00:1]", "[fd00::1]", "[fc00::1]", "[fe80::1]", "[ff02::1]", "[2001:db8::1]", "[2002:7f00:1::1]", "[0:1::1]"]) {
      expect(blocked(host), host).toThrow();
    }
  });

  it("refuses local names", () => {
    for (const host of ["localhost", "localhost.", "app.localhost", "printer.local", "metadata.google.internal", "intranet"]) {
      expect(blocked(host), host).toThrow();
    }
  });
});

describe("privateDownloadHeaders", () => {
  const upstream = (h: Record<string, string>) => {
    const lower = new Map(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
    return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
  };

  it("never forwards cookies or other upstream headers", () => {
    const out = privateDownloadHeaders(
      upstream({
        "Set-Cookie": "__Host-singlet_session=evil; Path=/; Secure",
        "Clear-Site-Data": '"cookies"',
        "Access-Control-Allow-Origin": "*",
        Refresh: "0; url=https://evil.example",
        Link: "<https://evil.example>; rel=preload",
        "Content-Type": "text/html",
        "Content-Length": "10",
        "Content-Range": "bytes 0-9/100",
        "Accept-Ranges": "bytes",
        ETag: '"abc"',
        "Last-Modified": "Wed, 30 Sep 2026 00:00:00 GMT",
      }),
      "study.singlet",
    );
    expect(Object.keys(out).sort()).toEqual(
      ["Accept-Ranges", "Cache-Control", "Content-Disposition", "Content-Length", "Content-Range", "Content-Type", "ETag", "Last-Modified", "X-Content-Type-Options"].sort(),
    );
    expect(out["Content-Type"]).toBe("application/octet-stream");
    expect(out["Content-Disposition"]).toBe('attachment; filename="study.singlet"');
    expect(out["Cache-Control"]).toBe("private, no-store");
    expect(out["X-Content-Type-Options"]).toBe("nosniff");
    expect(out["Content-Length"]).toBe("10");
  });

  it("drops Content-Length when the body was content-encoded", () => {
    const out = privateDownloadHeaders(upstream({ "Content-Length": "10", "Content-Encoding": "gzip" }), "a.singlet");
    expect(out["Content-Length"]).toBeUndefined();
    expect(out["Content-Encoding"]).toBeUndefined();
  });

  it("keeps quotes and line breaks out of the filename", () => {
    expect(privateDownloadHeaders(upstream({}), 'a"b\r\nc.singlet')["Content-Disposition"]).toBe('attachment; filename="abc.singlet"');
  });
});

describe("partLength", () => {
  it("cuts a reservation into exact PART_BYTES pieces", () => {
    expect(partLength(1, 1)).toBe(1);
    expect(partLength(1, 2)).toBe(0);
    expect(partLength(PART_BYTES, 1)).toBe(PART_BYTES);
    expect(partLength(PART_BYTES, 2)).toBe(0);
    expect(partLength(PART_BYTES + 5, 1)).toBe(PART_BYTES);
    expect(partLength(PART_BYTES + 5, 2)).toBe(5);
    const twoGiB = 2 * 1024 ** 3;
    expect(partLength(twoGiB, 41)).toBe(twoGiB - 40 * PART_BYTES);
    expect(partLength(twoGiB, 42)).toBe(0);
  });

  it("rejects nonsense", () => {
    expect(partLength(0, 1)).toBe(0);
    expect(partLength(100, 0)).toBe(0);
    expect(partLength(100, 1.5)).toBe(0);
    expect(partLength(Number.NaN, 1)).toBe(0);
  });
});

describe("readCookie", () => {
  const req = (cookie: string | null) => ({ headers: { get: (n: string) => (n.toLowerCase() === "cookie" ? cookie : null) } }) as unknown as Request;

  it("decodes a value", () => {
    expect(readCookie(req("a=1; b=hello%20world"), "b")).toBe("hello world");
    expect(readCookie(req(null), "b")).toBeNull();
  });

  it("treats a malformed value as absent instead of throwing", () => {
    expect(() => readCookie(req("__Host-singlet_session=%ZZ"), "__Host-singlet_session")).not.toThrow();
    expect(readCookie(req("__Host-singlet_session=%ZZ"), "__Host-singlet_session")).toBeNull();
    expect(readSessionToken(req("__Host-singlet_session=%E0%A4%A"))).toBeNull();
  });
});

/**
 * Security headers for every Pages Function response (API, MCP, sign-in,
 * sitemap). Static files get theirs from public/_headers; keep the lists in
 * step. A header a handler already set is left alone.
 *
 * The CSP here is the strict one for responses that are data, not pages: they
 * load nothing, so `default-src 'none'` costs nothing and stops a response
 * that is ever rendered from running script.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Resource-Policy": "cross-origin", // public API: other origins may read it (CORS still decides)
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

export function withSecurityHeaders(res: Response): Response {
  // Redirects, upgrades and other immutable responses are passed through.
  if (res.status === 101) return res;
  const headers = new Headers(res.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) if (!headers.has(name)) headers.set(name, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Paths answered by Functions as data. Everything else (the SPA and static files) is left to public/_headers: the strict CSP above would block the app's own scripts. */
export function isDataPath(pathname: string): boolean {
  return pathname.startsWith("/api/") || pathname === "/mcp" || pathname.startsWith("/auth/") || pathname === "/sitemap.xml";
}

export const onRequest: PagesFunction = async ({ request, next }) => {
  const res = await next();
  return isDataPath(new URL(request.url).pathname) ? withSecurityHeaders(res) : res;
};

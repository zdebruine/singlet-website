import { useEffect } from "react";

const SITE = "https://singlet.bio";
const DEFAULT_TITLE = "singlet.bio — find single-cell data, load it in one line";
const DEFAULT_DESC =
  "Every public scRNA-seq study on GEO, reprocessed the same way, one .singlet file per study. Free, CC0, no account.";
const DEFAULT_IMAGE = `${SITE}/og-default.png`;

function setMeta(selector: string, attr: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    const [k, v] = selector.replace(/^meta\[/, "").replace(/\]$/, "").split("=");
    el.setAttribute(k, v.replace(/"/g, ""));
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/**
 * Per-route head metadata (client-side). Sets title, description, canonical and
 * the og:/twitter: equivalents. `path` should be the route path, e.g. "/docs".
 */
export function usePageMeta(opts: {
  title?: string;
  description?: string;
  path?: string;
  noindex?: boolean;
  /** Structured data for this route (schema.org). Removed when the route unmounts. */
  jsonLd?: Record<string, unknown> | null;
}) {
  const { title, description, path, noindex, jsonLd } = opts;
  const jsonLdText = jsonLd ? JSON.stringify(jsonLd) : null;
  useEffect(() => {
    const id = "route-jsonld";
    let el = document.getElementById(id) as HTMLScriptElement | null;
    if (!jsonLdText) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement("script");
      el.id = id;
      el.type = "application/ld+json";
      document.head.appendChild(el);
    }
    el.textContent = jsonLdText;
    return () => {
      document.getElementById(id)?.remove();
    };
  }, [jsonLdText]);
  useEffect(() => {
    const fullTitle = title ? `${title} · singlet.bio` : DEFAULT_TITLE;
    const desc = description ?? DEFAULT_DESC;
    const url = `${SITE}${path ?? window.location.pathname}`;
    document.title = fullTitle;
    setMeta('meta[name="description"]', "content", desc);
    setMeta('meta[property="og:title"]', "content", fullTitle);
    setMeta('meta[property="og:description"]', "content", desc);
    setMeta('meta[property="og:url"]', "content", url);
    setMeta('meta[property="og:site_name"]', "content", "singlet.bio");
    // TODO: switch study pages to /og/:gse.png once a Pages-compatible PNG renderer is available.
    setMeta('meta[property="og:image"]', "content", DEFAULT_IMAGE);
    setMeta('meta[name="twitter:title"]', "content", fullTitle);
    setMeta('meta[name="twitter:description"]', "content", desc);
    setMeta('meta[name="twitter:image"]', "content", DEFAULT_IMAGE);
    setCanonical(url);
    const robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (noindex) {
      setMeta('meta[name="robots"]', "content", "noindex, follow");
    } else if (robots) {
      robots.remove();
    }
  }, [title, description, path, noindex]);
}

export default usePageMeta;

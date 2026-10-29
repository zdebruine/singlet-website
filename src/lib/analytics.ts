/**
 * First-party website analytics: beacons to POST /api/v, stored in Workers
 * Analytics Engine (functions/_shared/web-analytics.ts), read on
 * /admin/analytics. No third party and no cookies.
 *
 * A random visitor id lives in localStorage, so a return visit is recognised;
 * a session ends after 30 minutes without a page event. Each route change
 * sends a "view" (the first one of a session carries the external referrer
 * and any utm_* tags); the time the page was visible and how far it was
 * scrolled go in "leave" events whenever the tab is hidden or the route
 * changes. Nothing is sent from localhost or by browsers that ask not to be
 * tracked (Do Not Track, Global Privacy Control). Described in /privacy section 10.
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const ENDPOINT = "/api/v";
const VISITOR_KEY = "singlet:a:visitor";
const SESSION_KEY = "singlet:a:session";
const SESSION_IDLE_MS = 30 * 60_000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

interface Visitor { id: string; firstSession: string }
interface Session { id: string; last: number; views: number }
interface Page { id: string; path: string; visibleMs: number; visibleSince: number | null; maxScroll: number }

let signedIn = false;
let page: Page | null = null;
let listening = false;
let memSession: Session | null = null;
let memVisitor: Visitor | null = null;

function optedOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true || nav.webdriver === true;
}

export function analyticsEnabled(): boolean {
  return typeof window !== "undefined" && !LOCAL_HOSTS.has(window.location.hostname) && !optedOut();
}

function rid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function read<T>(key: string): T | null {
  try {
    const v = window.localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: ids last for this page load only */
  }
}

function currentSession(now: number): Session {
  const s = read<Session>(SESSION_KEY) ?? memSession;
  const live = s && typeof s.id === "string" && now - s.last < SESSION_IDLE_MS ? s : { id: rid(), last: now, views: 0 };
  memSession = live;
  return live;
}

function saveSession(s: Session): void {
  memSession = s;
  write(SESSION_KEY, s);
}

function currentVisitor(sessionId: string): Visitor {
  const v = read<Visitor>(VISITOR_KEY) ?? memVisitor;
  if (v && typeof v.id === "string") return (memVisitor = v);
  const fresh = { id: rid(), firstSession: sessionId };
  memVisitor = fresh;
  write(VISITOR_KEY, fresh);
  return fresh;
}

function ids(now: number): { s: Session; v: Visitor } {
  const s = currentSession(now);
  return { s, v: currentVisitor(s.id) };
}

function send(payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon?.(ENDPOINT, body)) return;
  } catch {
    /* fall through */
  }
  void fetch(ENDPOINT, { method: "POST", body, keepalive: true, credentials: "omit" }).catch(() => undefined);
}

function externalReferrer(): string {
  try {
    const host = document.referrer ? new URL(document.referrer).hostname : "";
    return host && host !== window.location.hostname ? host : "";
  } catch {
    return "";
  }
}

function scrollPct(): number {
  const total = document.documentElement.scrollHeight;
  return total > 0 ? Math.min(100, Math.round(((window.scrollY + window.innerHeight) / total) * 100)) : 100;
}

/** Send the visible time and scroll depth gathered since the last flush. */
function flush(): void {
  if (!page) return;
  const now = Date.now();
  if (page.visibleSince !== null) {
    page.visibleMs += now - page.visibleSince;
    page.visibleSince = document.visibilityState === "visible" ? now : null;
  }
  if (page.visibleMs < 500) return;
  const { s, v } = ids(now);
  saveSession({ ...s, last: now });
  send({ e: "leave", p: page.path, pv: page.id, s: s.id, v: v.id, ms: page.visibleMs, sc: page.maxScroll, ret: v.firstSession !== s.id, si: signedIn, w: window.innerWidth });
  page.visibleMs = 0;
}

function listen(): void {
  if (listening) return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (!page) return;
    if (document.visibilityState === "hidden") flush();
    else page.visibleSince = Date.now();
  });
  window.addEventListener("pagehide", flush);
  let queued = false;
  window.addEventListener(
    "scroll",
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (page) page.maxScroll = Math.max(page.maxScroll, scrollPct());
      });
    },
    { passive: true },
  );
}

export function trackPageView(path: string): void {
  if (!analyticsEnabled()) return;
  listen();
  flush();
  const now = Date.now();
  const { s, v } = ids(now);
  const landing = s.views === 0;
  const params = new URLSearchParams(window.location.search);
  page = { id: rid(), path, visibleMs: 0, visibleSince: document.visibilityState === "visible" ? now : null, maxScroll: scrollPct() };
  saveSession({ id: s.id, last: now, views: s.views + 1 });
  send({
    e: "view",
    p: path,
    pv: page.id,
    s: s.id,
    v: v.id,
    land: landing,
    ret: v.firstSession !== s.id,
    si: signedIn,
    w: window.innerWidth,
    ...(landing ? { r: externalReferrer(), us: params.get("utm_source") ?? "", um: params.get("utm_medium") ?? "", uc: params.get("utm_campaign") ?? "" } : {}),
  });
}

/** AuthProvider keeps this current, so reports can count signed-in visitors (never who they are). */
export function setAnalyticsSignedIn(value: boolean): void {
  signedIn = value;
}

/** Sends a page view on every route change (path only: query-string changes on one page are not new views). */
export function usePageTracking(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    trackPageView(pathname);
  }, [pathname]);
}

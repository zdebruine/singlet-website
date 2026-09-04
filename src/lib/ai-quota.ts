/**
 * Last-known AI budgets for this visitor, per feature. Written whenever the
 * API reports one (the X-Singlet-Quota header on fresh AI searches, the
 * `quota` field on explanations) and kept in localStorage so the counter
 * survives reloads. Cleared on sign-in / sign-out (the subject changes) and
 * once `resets_at` has passed.
 */
import { useSyncExternalStore } from "react";

export interface AiQuota {
  /** Who the budget belongs to — anonymous (per network) or a signed-in user. */
  kind: "anon" | "user";
  used: number;
  limit: number;
  resets_at: string;
  exceeded: boolean;
}

export type QuotaFeature = "search" | "explain";
export type AiQuotas = Record<QuotaFeature, AiQuota | null>;

const KEY = "singlet:ai-quota:v1";
const EMPTY: AiQuotas = { search: null, explain: null };

const listeners = new Set<() => void>();
let cache: AiQuotas | null = null;

function isQuota(v: unknown): v is AiQuota {
  const q = v as AiQuota | null;
  return !!q && typeof q === "object" && typeof q.used === "number" && typeof q.limit === "number" && typeof q.resets_at === "string";
}

function fresh(q: AiQuota | null): AiQuota | null {
  if (!q) return null;
  const t = Date.parse(q.resets_at);
  return Number.isFinite(t) && t <= Date.now() ? null : q;
}

function load(): AiQuotas {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Record<QuotaFeature, unknown>>;
    return {
      search: fresh(isQuota(parsed.search) ? parsed.search : null),
      explain: fresh(isQuota(parsed.explain) ? parsed.explain : null),
    };
  } catch {
    return EMPTY;
  }
}

function persist(next: AiQuotas) {
  cache = next;
  try {
    if (!next.search && !next.explain) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota full — in-memory copy still works */
  }
  for (const fn of listeners) fn();
}

export const aiQuotaStore = {
  get(): AiQuotas {
    if (!cache) cache = load();
    // Expire lazily without writing.
    const s = fresh(cache.search);
    const e = fresh(cache.explain);
    if (s !== cache.search || e !== cache.explain) cache = { search: s, explain: e };
    return cache;
  },
  set(feature: QuotaFeature, quota: AiQuota | null) {
    const cur = aiQuotaStore.get();
    if (quota === cur[feature]) return;
    persist({ ...cur, [feature]: quota });
  },
  /** Called when the visitor signs in or out — a new subject, a new budget. */
  clear() {
    persist({ search: null, explain: null });
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export function parseQuota(v: unknown): AiQuota | null {
  if (typeof v === "string") {
    try {
      return parseQuota(JSON.parse(v));
    } catch {
      return null;
    }
  }
  if (!isQuota(v)) return null;
  return {
    kind: v.kind === "user" ? "user" : "anon",
    used: v.used,
    limit: v.limit,
    resets_at: v.resets_at,
    exceeded: v.exceeded === true || v.used >= v.limit,
  };
}

export function useAiQuota(feature: QuotaFeature): AiQuota | null {
  return useSyncExternalStore(
    aiQuotaStore.subscribe,
    () => aiQuotaStore.get()[feature],
    () => null,
  );
}

/** "resets at 00:00 UTC" / "resets in 3 h" — whichever reads better. */
export function resetsLabel(resets_at: string): string {
  const t = Date.parse(resets_at);
  if (!Number.isFinite(t)) return "resets tomorrow";
  const mins = Math.max(0, Math.round((t - Date.now()) / 60000));
  if (mins < 60) return `resets in ${Math.max(1, mins)} min`;
  const h = Math.round(mins / 60);
  return `resets in ${h} h`;
}

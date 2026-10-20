/**
 * Read-only client for the public singlet.bio API, shared by the enrichment scripts.
 * Concurrency is capped at 4 and failed requests are retried with backoff; nothing here writes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StudyInput } from "../../functions/_shared/study-card";

export const BASE = process.env.SINGLET_BASE ?? "https://singlet.bio";
export const MAX_CONCURRENCY = 4;

export function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
export const flag = (name: string) => process.argv.includes(`--${name}`);

export async function getJson<T>(path: string, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" } });
      if (r.ok) return (await r.json()) as T;
      last = new Error(`${r.status} ${path}`);
      if (r.status === 404) break;
    } catch (e) {
      last = e;
    }
    await new Promise((res) => setTimeout(res, 500 * 2 ** i));
  }
  throw last;
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order, failures become null. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, MAX_CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i], i);
      } catch (e) {
        console.error(`  skipped ${i}: ${(e as Error).message}`);
      }
    }
  });
  await Promise.all(workers);
  return out;
}

/** Every downloadable study id (the default search is on the DOWNLOADABLE_SQL basis), 200 per page. */
export async function listDownloadableStudies(): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 1; ; page++) {
    const r = await getJson<{ total: number; limit: number; data: { gse_id: string }[] }>(`/api/search?limit=200&page=${page}`);
    ids.push(...r.data.map((d) => d.gse_id));
    if (!r.data.length || ids.length >= r.total) break;
  }
  return ids;
}

/** mulberry32: a seeded generator so the "random" 200 are reproducible. */
export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleIds(ids: string[], n: number, seed: number): string[] {
  const r = rng(seed);
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n).sort();
}

/** One study as the card builder wants it: /api/gse/<id> plus the file index (layers). Cached on disk when `cache` is set. */
export async function loadStudyInput(gse: string, cache?: string): Promise<StudyInput> {
  const file = cache ? join(cache, `${gse}.json`) : null;
  if (file && existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as StudyInput;
  const g = await getJson<{
    series: StudyInput["series"];
    meta: StudyInput["meta"];
    samples: StudyInput["samples"];
  }>(`/api/gse/${gse}`);
  let layerPaths: string[] = [];
  try {
    const idx = await getJson<{ samples: { files: { path: string }[] }[]; study_files?: { path: string }[] }>(`/api/bundle/${gse}/index`);
    layerPaths = [...idx.samples.flatMap((s) => s.files.map((f) => f.path)), ...(idx.study_files ?? []).map((f) => f.path)];
  } catch {
    /* a study without a readable index just has no file facts */
  }
  const trimmed: StudyInput = {
    series: g.series,
    meta: g.meta,
    samples: g.samples.map((s) => ({
      gsm_id: s.gsm_id,
      gse_id: s.gse_id,
      organism_primary: s.organism_primary,
      protocol: s.protocol,
      assay_family: s.assay_family,
      modality: s.modality,
      n_cells: s.n_cells,
      status: s.status,
      title: s.title,
      source: s.source,
      characteristics_raw: s.characteristics_raw,
      low_qc: s.low_qc,
    })),
    file_paths: [...new Set(layerPaths.map((p) => p.replace(/^samples\/[^/]+\//, "")))],
  };
  if (file) {
    mkdirSync(cache!, { recursive: true });
    writeFileSync(file, JSON.stringify(trimmed));
  }
  return trimmed;
}

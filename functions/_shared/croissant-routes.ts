/**
 * Handlers behind the Croissant routes (./croissant): one place for the 404 rules and cache lifetimes, so /croissant.json and
 * /api/croissant answer the same document. Withheld, unknown or not-downloadable studies, and samples a study does not serve,
 * answer 404 like /api/gse/:id.
 */
import { cachedJson } from "./cache";
import { corsErr } from "./cors";
import { serverError } from "./errors";
import { computeStats } from "./stats-core";
import { ensureCatalogColumns } from "./catalog-refresh";
import { configureS1, s1Origin, s1PackUrl } from "./s1-urls";
import { PackError, geneTable, type PackFetcher } from "./s1-packs";
import {
  buildAtlasCroissant,
  buildStudyCroissant,
  croissantUrls,
  csvResponse,
  featuresCsv,
  httpManifestFetcher,
  jsonLd,
  loadAtlasInput,
  loadStudyInput,
  oneSample,
  samplesCsv,
  studiesCsv,
} from "./croissant";

export interface CroissantEnv {
  DB: D1Database;
  S1_ORIGIN?: string;
  V2_ORIGIN?: string;
}

/** The atlas changes when a study is added or the release policy changes (a few times a day at most). */
export const ATLAS_TTL = 3600;
/** As /api/gse/:id: a study's manifest is mutable with max-age 300. */
export const STUDY_TTL = 300;
/** A features CSV is a function of an immutable pack. */
export const FEATURES_TTL = 86_400;

const GSE_RE = /^GSE\d+$/;
const GSM_RE = /^GSM\d+$/;
const PACK_RE = /^([0-9a-f]{32})(?:\.csv)?$/;

interface Ctx {
  request: Request;
  env: CroissantEnv;
  waitUntil: (p: Promise<unknown>) => void;
}

function urls(env: CroissantEnv) {
  configureS1(env);
  return croissantUrls(undefined, s1Origin());
}

export function atlasDocument({ request, env, waitUntil }: Ctx): Promise<Response> {
  return cachedJson(
    request,
    waitUntil,
    async () => {
      try {
        await ensureCatalogColumns(env.DB);
        const stats = await computeStats(env.DB);
        if (!stats) return corsErr("No stats available", 404);
        return jsonLd(buildAtlasCroissant(await loadAtlasInput(env.DB, stats), urls(env)));
      } catch (e) {
        return serverError(e, "croissant/atlas");
      }
    },
    ATLAS_TTL
  );
}

export function atlasStudiesCsv({ request, env, waitUntil }: Ctx): Promise<Response> {
  return cachedJson(
    request,
    waitUntil,
    async () => {
      try {
        const input = await loadAtlasInput(env.DB, { studies_with_files: 0, samples_in_files: 0, cells_in_files: 0, geo_samples_known: 0, species_count: 0 });
        return csvResponse(studiesCsv(input.studies, urls(env)), "studies.csv");
      } catch (e) {
        return serverError(e, "croissant/studies.csv");
      }
    },
    ATLAS_TTL
  );
}

export type StudyWhat = { kind: "study" } | { kind: "sample"; gsm: string } | { kind: "samples.csv" };

/** The document of a study, of one of its samples, or its samples.csv. */
export function studyResource({ request, env, waitUntil }: Ctx, rawGse: string, what: StudyWhat): Promise<Response> {
  return cachedJson(
    request,
    waitUntil,
    async () => {
      try {
        const gse = rawGse.trim().toUpperCase();
        if (!GSE_RE.test(gse)) return corsErr("Invalid series id", 400);
        let gsm = "";
        if (what.kind === "sample") {
          gsm = what.gsm.trim().toUpperCase();
          if (!GSM_RE.test(gsm)) return corsErr("Invalid sample id", 400);
        }
        const u = urls(env);
        const input = await loadStudyInput(env.DB, gse, httpManifestFetcher(u.data));
        if (!input) return corsErr(`Series ${gse} not found`, 404);
        if (what.kind === "samples.csv") return csvResponse(samplesCsv(input, u), `${gse}-samples.csv`);
        if (what.kind === "study") return jsonLd(buildStudyCroissant(input, u));
        const one = oneSample(input, gsm);
        if (!one) return corsErr(`Sample ${gsm} not found in ${gse}`, 404);
        return jsonLd(buildStudyCroissant(one, u, { single: true }));
      } catch (e) {
        return serverError(e, "croissant/study");
      }
    },
    STUDY_TTL
  );
}

const fetchPack: PackFetcher = async (id32) => {
  const res = await fetch(s1PackUrl(id32), { cf: { cacheEverything: true, cacheTtl: 86400 } } as RequestInit);
  if (!res.ok) throw new PackError(`pack ${id32} answered ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

export function featuresResource({ request, env, waitUntil }: Ctx, rawPack: string): Promise<Response> {
  return cachedJson(
    request,
    waitUntil,
    async () => {
      const m = PACK_RE.exec(rawPack.trim().toLowerCase());
      if (!m) return corsErr("A features file is named by an exon pack id: /api/croissant/features/<32 hex>.csv", 400);
      try {
        configureS1(env);
        const { build, genes } = await geneTable(fetchPack, m[1]);
        return csvResponse(featuresCsv(build, genes), `features-${m[1]}.csv`);
      } catch (e) {
        if (e instanceof PackError) return corsErr(`No gene table for pack ${m[1]}: ${e.message}`, 404);
        return serverError(e, "croissant/features");
      }
    },
    FEATURES_TTL
  );
}

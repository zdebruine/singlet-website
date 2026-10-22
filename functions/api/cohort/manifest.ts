/**
 * GET|POST /api/cohort/manifest — the fetch plan for a cohort: per sample, the study file on data.singlet.bio,
 * zip entry offsets from bundle_index, chunk byte ranges where pz_chunk_index rows exist, and with `max_cells`
 * the columns to keep per sample (deterministic, stratified by sample; see ../../_shared/cohort-manifest).
 *
 * Same query parameters as /api/cohort/resolve, plus max_cells, seed, min_cells_per_sample, files
 * (comma list of file names, default exon_counts.1pz,intron_counts.1pz), offset, limit (samples per page, max 500)
 * and indices=none to leave out the column lists. Data is never read here; the client fetches the ranges.
 */
import { corsOk, handleOptions } from "../../_shared/cors";
import { resolveIdentity } from "../../_shared/identity";
import { sha256Hex } from "../../_shared/hash";
import { canonicalCohort, cohortMask, CohortError } from "../../_shared/cohort-core";
import { cohortFailure, numOpt, readCohortRequest } from "../../_shared/cohort-http";
import { getBitIndex, type CohortEnv } from "../../_shared/cohort-index";
import { DEFAULT_FILES, DEFAULT_MIN_CELLS_PER_SAMPLE, loadChunkRows, loadEntries, loadV2Plan, planManifest } from "../../_shared/cohort-manifest";
import { configureV2 } from "../../_shared/v2-urls";

async function manifest(env: CohortEnv, request: Request): Promise<Response> {
  try {
    const { query, opts } = await readCohortRequest(request);
    const maxCells = numOpt(opts, "max_cells", null);
    if (maxCells != null && maxCells < 1) throw new CohortError("max_cells must be at least 1", "max_cells");
    const seed = opts.get("seed") ?? "0";
    if (seed.length > 64) throw new CohortError("seed is at most 64 characters", "seed");
    const minPer = numOpt(opts, "min_cells_per_sample", DEFAULT_MIN_CELLS_PER_SAMPLE)!;
    const files = (opts.get("files") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (files.some((f) => !/^[\w.-]+$/.test(f))) throw new CohortError("files takes plain file names", "files");
    const offset = numOpt(opts, "offset", 0)!;
    const limit = numOpt(opts, "limit", 100)!;

    const index = await getBitIndex(env);
    const { mask, summary } = cohortMask(index, query);
    const selected = Array.from(index.indices(mask), (i) => ({ gsm_id: index.gsmId(i), gse_id: index.gseOf(i), n_cells: index.cellsOf(i) }));

    // Plan once without I/O to learn which samples sit on this page, then read only those studies.
    const base = { selected, maxCells, seed, minCellsPerSample: minPer, files, offset, limit };
    const probe = planManifest({ ...base, entries: new Map(), chunks: new Map(), indices: false });
    configureV2(env);
    // Studies served from v2 are planned from the v2 catalog; only the others need the legacy member index and chunk maps.
    const v2 = await loadV2Plan(env.DB, probe.studies.map((s) => ({ gse_id: s.gse_id, gsms: s.samples.map((x) => x.gsm_id) })));
    const legacy = probe.studies.filter((s) => !v2.has(s.gse_id));
    const pageGsms = legacy.flatMap((s) => s.samples.map((x) => x.gsm_id));
    const [entries, chunks] = await Promise.all([loadEntries(env.DB, legacy.map((s) => s.gse_id)), loadChunkRows(env.DB, pageGsms)]);
    const plan = planManifest({ ...base, entries, chunks, v2, indices: opts.get("indices") !== "none" });

    const hash = (await sha256Hex(`${canonicalCohort(query)}|${index.version}|${maxCells ?? ""}|${seed}|${minPer}`)).slice(0, 16);
    return corsOk({
      cohort: {
        hash,
        index_version: index.version,
        query: JSON.parse(canonicalCohort(query)),
        totals: { studies: summary.studies, samples: summary.samples, cells: summary.cells, basis: "file" },
      },
      files: files.length ? files : DEFAULT_FILES,
      downsample: plan.downsample,
      page: plan.page,
      studies: plan.studies,
      warnings: plan.warnings,
      notes: [
        ...(v2.size
          ? [
              "Studies with format singlet-v2 (studies[].format): one immutable object per sample. files[].range is an absolute byte range inside samples[].object.url; chunk_index.range is the chunk index of a matrix. The MCP tool slice_cells turns column runs into chunk ranges.",
            ]
          : []),
        "Chunk offsets are relative to the first payload byte of the zip entry. data_offset is exact when present; otherwise read the 30-byte local header at local_header_offset and add 30 + name length + extra length.",
        "Column indices are positions in the stored matrix (after the file's permutation), 0-based.",
      ],
    });
  } catch (e) {
    return cohortFailure(e, "cohort/manifest");
  }
}

export const onRequestGet: PagesFunction<CohortEnv> = async ({ env, request, waitUntil }) => {
  const id = await resolveIdentity(request, env, waitUntil);
  if (!id.ok) return id.response;
  return manifest(env, request);
};

export const onRequestPost: PagesFunction<CohortEnv> = async ({ env, request, waitUntil }) => {
  const id = await resolveIdentity(request, env, waitUntil);
  if (!id.ok) return id.response;
  return manifest(env, request);
};

export const onRequestOptions: PagesFunction<CohortEnv> = async () => handleOptions();

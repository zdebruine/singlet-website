/**
 * HPC dashboard snapshots (the /hpc page). The cluster orchestrators upload
 * JSON with POST /api/ingest/hpc?path=… into the R2 bucket
 * `singlet-hpc-dashboard` (binding HPC_DASHBOARD), keyed by that path, and the
 * page reads them back through GET /api/hpc/<path>.
 *
 * Accepted paths (the same list for upload and read):
 *   latest.json · timeseries.json · history/<YYYYMMDDTHHZ>.json   (Clipper)
 *   anvil/<name>.json · anvil/history/<YYYYMMDDTHHZ>.json          (ANVIL)
 * A name is lowercase letters, digits, "_" and "-", so no path can contain
 * "..", a leading "/", a backslash or an encoded character.
 */

export const HPC_PATH_RE =
  /^(?:latest\.json|timeseries\.json|history\/\d{8}T\d{2}Z\.json|anvil\/(?:[a-z0-9][a-z0-9_-]{0,63}\.json|history\/\d{8}T\d{2}Z\.json))$/;

/** Largest accepted upload (bytes). */
export const HPC_MAX_BODY_BYTES = 2 * 1024 * 1024;

/** The path when it is on the allowlist, else null. */
export function hpcPath(raw: string | null | undefined): string | null {
  const p = String(raw ?? "");
  return p.length <= 128 && HPC_PATH_RE.test(p) ? p : null;
}

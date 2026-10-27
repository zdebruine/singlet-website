// Research Alpha release policy for /s1/* (and /v2/*): withheld studies and excluded samples are not served. The catalog never
// lists them; this is the second line, for anyone who requests a key directly. policy/alpha-policy.json is the same file the
// data-guard Worker (workers/data-guard) uses: update both together.
import policy from "../policy/alpha-policy.json";

export const POLICY_VERSION: string = policy.version;
const WITHHELD = new Set<string>(policy.withheld_studies);
const EXCLUDED = new Set<string>(policy.excluded_samples);

const STUDY_RE = /^\/?(?:s1|v2)\/(?:m|cells)\/(GSE\d+)\.(?:json|cells)$/;
const SAMPLE_RE = /^\/?(?:s1|v2)\/[sa]\/(GSM\d+)\//;

/** True when a path or R2 key names a withheld study's manifest or cell table, or an excluded sample's object or label sidecar. */
export function isBlocked(path: string): boolean {
  const s = STUDY_RE.exec(path);
  if (s) return WITHHELD.has(s[1]);
  const m = SAMPLE_RE.exec(path);
  return m ? EXCLUDED.has(m[1]) : false;
}

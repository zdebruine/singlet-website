/**
 * Release channels. One codebase serves singlet.bio (Research Alpha) and beta.singlet.bio (Research Beta); what differs is configuration only:
 * the Pages project, its D1 database and R2 bucket bindings, the data Worker, and the `CHANNEL` and `S1_ORIGIN` variables
 * (wrangler.toml for Alpha, wrangler.beta.toml for Beta; docs/BETA-CHANNEL.md).
 *
 * `alpha_exclusions` / `alpha_withheld` are D1 tables, so each channel has its own lists by virtue of having its own database.
 *
 * Rolling ingest (api/ingest/s1-object, s1-publish) writes objects to the bucket bound as SINGLET_DATA. It answers only on the beta channel, so
 * a misdirected call can never write into the production bucket.
 */
import { SAMPLE_KEY_RE } from "./s1-catalog";
import { isPrivateKey } from "./restricted";

export interface ChannelEnv {
  CHANNEL?: string;
}

export const isBeta = (env: ChannelEnv) => (env.CHANNEL ?? "").trim().toLowerCase() === "beta";

export type ObjectClass =
  | { ok: true; kind: "sample" | "label" | "pack" | "cells"; digest: string | null }
  | { ok: false; error: string };

const LABEL_KEY_RE = /^s1\/a\/GSM\d+\/([0-9a-f]{32})\.parquet$/;
const PACK_KEY_RE = /^s1\/ref\/([0-9a-f]{32})\.pack$/;
const CELLS_KEY_RE = /^s1\/cells\/GSE\d+\.cells$/;

/**
 * Which objects the rolling ingest may write. Content-addressed keys carry the first 16 bytes of the object's SHA-256 (docs/format-s1.md
 * section 2), so the digest of the bytes must match the key. Manifests are written by s1-publish only, after their objects. Anything under
 * `private/` (the restricted sidecar: genotypes, reads) is refused: it never goes into the public bucket.
 */
export function classifyObjectKey(key: string): ObjectClass {
  if (isPrivateKey(key)) return { ok: false, error: "private/* is the restricted sidecar and is never written to the public bucket" };
  const s = SAMPLE_KEY_RE.exec(key);
  if (s && key.startsWith("s1/")) return { ok: true, kind: "sample", digest: s[2] };
  const l = LABEL_KEY_RE.exec(key);
  if (l) return { ok: true, kind: "label", digest: l[1] };
  const p = PACK_KEY_RE.exec(key);
  if (p) return { ok: true, kind: "pack", digest: p[1] };
  if (CELLS_KEY_RE.test(key)) return { ok: true, kind: "cells", digest: null };
  return { ok: false, error: "key is not an s1 sample, label, pack or cells object (manifests go through s1-publish)" };
}

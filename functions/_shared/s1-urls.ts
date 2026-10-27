/**
 * Where the sample objects are served from. Keys are the R2 keys of docs/format-s1.md section 2 (`s1/s/<GSM>/<digest>.s1`,
 * `s1/m/<GSE>.json`, `s1/ref/<pack>.pack`), so the URL of an object is origin + "/" + key.
 *
 * The default origin is the R2 custom domain data.singlet.bio, where the data Worker (workers/data) answers `/s1/*`. If that
 * route cannot sit in front of the custom domain, the Worker is deployed on another hostname (README of workers/data) and the
 * Pages variable `S1_ORIGIN` points the site at it; nothing else in the code names the host.
 */
export const S1_ORIGIN_DEFAULT = "https://data.singlet.bio";

let origin = S1_ORIGIN_DEFAULT;

/** Read `S1_ORIGIN` from the environment (call at the start of a request; idempotent). Anything but an https origin is ignored. */
export function configureS1(env: { S1_ORIGIN?: string; V2_ORIGIN?: string } | null | undefined): void {
  // DUAL: V2_ORIGIN is the old name of the variable (removed in the cleanup).
  const v = (env?.S1_ORIGIN ?? env?.V2_ORIGIN)?.trim().replace(/\/+$/, "");
  if (v && /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(v)) origin = v;
  else origin = S1_ORIGIN_DEFAULT;
}

export const s1Origin = () => origin;

/** Public URL of an object key such as `s1/s/GSM1/<digest>.s1`. */
export const s1Url = (key: string) => `${origin}/${key.replace(/^\/+/, "")}`;
export const s1ManifestUrl = (gse: string) => s1Url(`s1/m/${gse}.json`);
export const s1PackUrl = (id32: string) => s1Url(`s1/ref/${id32}.pack`);
export const s1PackIndexUrl = () => s1Url("s1/ref/index.json");

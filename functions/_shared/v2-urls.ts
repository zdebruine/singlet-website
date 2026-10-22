/**
 * Where the v2 objects are served from. Keys are the R2 keys of docs/format-v2.md section 2 (`v2/s/<GSM>/<digest>.s2`,
 * `v2/m/<GSE>.json`, `v2/ref/<pack>.pack`), so the URL of an object is origin + "/" + key.
 *
 * The default origin is the R2 custom domain data.singlet.bio, where the data Worker (workers/data-v2) answers `/v2/*`. If that
 * route cannot sit in front of the custom domain, the Worker is deployed on another hostname (README of workers/data-v2) and the
 * Pages variable `V2_ORIGIN` points the site at it; nothing else in the code names the host.
 */
export const V2_ORIGIN_DEFAULT = "https://data.singlet.bio";

let origin = V2_ORIGIN_DEFAULT;

/** Read `V2_ORIGIN` from the environment (call at the start of a request; idempotent). Anything but an https origin is ignored. */
export function configureV2(env: { V2_ORIGIN?: string } | null | undefined): void {
  const v = env?.V2_ORIGIN?.trim().replace(/\/+$/, "");
  if (v && /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(v)) origin = v;
  else origin = V2_ORIGIN_DEFAULT;
}

export const v2Origin = () => origin;

/** Public URL of an object key such as `v2/s/GSM1/<digest>.s2`. */
export const v2Url = (key: string) => `${origin}/${key.replace(/^\/+/, "")}`;
export const v2ManifestUrl = (gse: string) => v2Url(`v2/m/${gse}.json`);
export const v2PackUrl = (id32: string) => v2Url(`v2/ref/${id32}.pack`);
export const v2PackIndexUrl = () => v2Url("v2/ref/index.json");

/**
 * Where the sample objects are served from. Keys are the R2 keys of docs/format-store.md section 2 (`store/s/<GSM>/<digest>.s1`,
 * `store/m/<GSE>.json`, `store/ref/<pack>.pack`), so the URL of an object is origin + "/" + key.
 *
 * The default origin is the R2 custom domain data.singlet.bio, where the data Worker (workers/data) answers `/store/*`. If that
 * route cannot sit in front of the custom domain, the Worker is deployed on another hostname (README of workers/data) and the
 * Pages variable `STORE_ORIGIN` points the site at it; nothing else in the code names the host.
 */
export const STORE_ORIGIN_DEFAULT = "https://data.singlet.bio";

let origin = STORE_ORIGIN_DEFAULT;

/** Read `STORE_ORIGIN` from the environment (call at the start of a request; idempotent). Anything but an https origin is ignored. */
export function configureStore(env: { STORE_ORIGIN?: string; V2_ORIGIN?: string } | null | undefined): void {
  // DUAL: V2_ORIGIN is the old name of the variable (removed in the cleanup).
  const v = (env?.STORE_ORIGIN ?? env?.V2_ORIGIN)?.trim().replace(/\/+$/, "");
  if (v && /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(v)) origin = v;
  else origin = STORE_ORIGIN_DEFAULT;
}

export const storeOrigin = () => origin;

/** Public URL of an object key such as `store/s/GSM1/<digest>.s1`. */
export const storeUrl = (key: string) => `${origin}/${key.replace(/^\/+/, "")}`;
export const storeManifestUrl = (gse: string) => storeUrl(`store/m/${gse}.json`);
export const storePackUrl = (id32: string) => storeUrl(`store/ref/${id32}.pack`);
export const storePackIndexUrl = () => storeUrl("store/ref/index.json");

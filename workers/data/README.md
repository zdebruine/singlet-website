# singlet-data: Worker for `data.singlet.bio/s1/*`

Read-only front for the per-sample objects in the R2 bucket `singlet-data` (layout: `docs/format-s1.md` in singlet-bio, section 2).

It exists because our API token cannot edit zone cache rules but can deploy Workers routes (migration decision D9).
It does not touch the legacy `data/<GSE>/<GSE>.singlet` objects: those stay on the R2 custom domain behind the data-guard Worker (`workers/data-guard`), which refuses them for every study with a verified .s1 migration once `s1_flags.legacy_bundles` is `retired` (D1 schema/038).

Transition: the handler serves the same keys under `/s1/*` and the old `/v2/*` (sample objects `.s1` or `.s2`), and the cell-index POST endpoints answer under both prefixes. wrangler.toml routes only `/s1/*`; `/v2/*` stays on the old deployed script `singlet-data-v2` until a later cleanup.

## What it serves

| URL | content | `Cache-Control` sent |
|---|---|---|
| `/s1/s/<GSM>/<32 hex>.s1` | sample object, key contains its digest | `public, max-age=31536000, immutable` |
| `/s1/ref/<32 hex>.pack` | side-information pack, key contains its digest | `public, max-age=31536000, immutable` |
| `/s1/ref/index.json` | list of packs | `public, max-age=300` |
| `/s1/m/<GSE>.json` | study manifest (mutable) | `public, max-age=300` |
| `/s1/cells/<GSE>.cells` | study-level cell tables (replaced per rev) | `public, max-age=300` |

| `/s1/cidx/current.json` | pointer to the current cell-index version | `public, max-age=60` |
| `/s1/cidx/v/<version>.json`, `/s1/cidx/obj/<32 hex>.(scx\|json\|parquet)` | cell-index directory and objects | `public, max-age=31536000, immutable` |
| `/s1/a/<GSM>/<32 hex>.parquet` | per-cell label sidecar | `public, max-age=31536000, immutable` |

Anything else is a JSON 404 (`Cache-Control: no-store`, so an object uploaded a moment later is visible at once). Methods
GET, HEAD and OPTIONS only; everything else is 405. The query string is ignored. Keys are matched by anchored regexes on the
normalised path and are never built from raw input.

Every response carries `Access-Control-Allow-Origin: *`, `Access-Control-Expose-Headers` (Content-Length, Content-Range,
Accept-Ranges, ETag, Content-Type, Last-Modified), `X-Content-Type-Options: nosniff`, `Timing-Allow-Origin: *`,
`X-Served-By: singlet-data` and, for objects, `X-Cache: HIT|MISS|BYPASS`. No `Vary`.

## HTTP behaviour

* **ETag** is R2's `httpEtag` (quoted, strong). For a multipart upload it is `"<md5 of part md5s>-<n>"`: a change detector, not a content hash.
* **Range**: one range (`bytes=a-b`, `bytes=a-`, `bytes=-n`) gives 206 with `Content-Range`; the end is clamped. A start past the end,
  `bytes=-0`, or any range on a zero-length object gives 416 with `Content-Range: bytes */<size>`. A multi-range request, another
  unit, bad syntax or `last < first` is ignored and the object is served whole with 200 (never multipart, never buffered).
* **If-Match** (strong comparison, list, `*`): mismatch gives 412 with the current `ETag`. The website's stale-index guard sends it on
  ranged reads and treats 412 as "reindex".
* **If-None-Match** (weak comparison, list, `*`) gives 304; `If-Modified-Since` / `If-Unmodified-Since` are honoured when the ETag
  validators are absent. Order: If-Match, If-Unmodified-Since, If-None-Match, If-Modified-Since, then Range.
* **If-Range**: strong ETag form only. A mismatch, a weak tag or a date means "ignore Range", so the client gets the whole object.
* **HEAD** answers from R2 metadata (`head()`), or from the cache on a hit; it never fills the cache. With `Range` it answers the 206 headers.

## Edge cache (Cache API, `caches.default`)

Cache key: `https://data.singlet.bio/<key>` (no query, no Range), so all clients share one full-object entry. Objects up to
`CACHE_MAX_BYTES` (500 MiB, under the 512 MB per-object limit) are cached; larger ones are always served from R2. Samples are at most
132 MB today, so everything is cacheable.

| request | cache state | served from | what else happens |
|---|---|---|---|
| any GET/HEAD | hit | cache (a Range is sliced by the platform: 206) | conditionals and 416 are decided by the Worker against the cached ETag |
| full GET, object <= 8 MiB | miss | R2, one read | the body is teed into the cache (`waitUntil`) |
| full GET, object > 8 MiB | miss | R2 | a second R2 read fills the cache in the background (a tee would hold a slow client's backlog in memory; isolates have 128 MB) |
| GET with Range, object <= 32 MiB | miss | R2, ranged read, 206 | a background full read fills the cache, unless a fill for that key is already running in this isolate |
| GET with Range, object > 32 MiB | miss | R2, ranged read, 206 | no fill the first time: the key is remembered in the isolate (at most 256 keys). The second miss of the same key starts the fill (a full GET always does) |
| GET revalidation (304/412/416), object <= 32 MiB | miss | R2 | also starts the background fill |
| GET revalidation (304/412), object > 32 MiB | miss | R2 | counted like a ranged miss: remembered the first time, filled the second |
| HEAD | miss | R2 `head()` | nothing |
| any | cache unavailable | R2 | `X-Cache: BYPASS` |

Why the 32 MiB rule (`RANGE_FILL_MAX_BYTES`): a fill reads the whole object from R2 and holds a stream into the Cache API, which for a 130 MB
sample is far more than the few KB a ranged read asked for, and most ranged reads of a big sample are one-offs (the website's stale-index
check, a cell slice). Samples are mostly far smaller than 32 MiB; the big ones are cached when they are read twice in the same isolate or
once in full. The memory of first misses is per isolate, so a key that is read once in each of many isolates is never filled; that is
intended.

Cost of the fill: one extra R2 read (Class B, $0.36 per million) per cold object per data centre. The Cache API is local to a data
center (no tiered cache). Cache TTL comes from `Cache-Control`: a mutable manifest can be up to 5 minutes stale at the edge.

What was verified about the Cache API (Cloudflare docs, and a probe Worker under `wrangler dev --local` on workerd):
`cache.match` honours `Range` on a cached 200 that has `Content-Length` (206 with `Content-Range`), returns a bare 416 without
`ETag` for an unsatisfiable range, answers 304 to `If-None-Match`, ignores `If-Match`, ignores `If-Range`, serves a multi-range request as a
multipart 206 (and answers 416 for syntactically odd ranges such as `bytes=5-2`), never matches a HEAD request, and `put` refuses a 206.
The handler therefore forwards to `match` only a single valid `Range`, evaluates every conditional itself, and falls back to a ranged
R2 read if a platform returns the whole entry for a Range.

## Cell index endpoints (POST)

`POST /s1/cidx/query` (counts and grouped counts; cell answers as a seeded uniform sample of at most 10,000 cells from the 10 most
relevant studies, paged with a cursor) and `POST /s1/cidx/gather` (those cells, or any list of at most 10,000 cells from at most 10
studies, from many samples in one streamed `application/x-singlet-gather` answer). Every request is planned first and refused with a
413 and a client-side plan if its worst-case cost (every read missing the cache) would exceed $0.01 or a cap; `dry_run: true` returns the
plan and its estimate. Answers carry `estimate` and `cost`. Specification: `docs/format-s1-cell-index.md` in singlet-bio (sections 6-8); costs:
`docs/format-s1-cell-index-costs.md`. Code: `src/routes.ts` (routing, identity, limits), `src/cidx.ts` (directory, shard reads, query
planning and execution), `src/gather.ts` (plan, stream, fan-out), `src/scx.ts` (shard decoder), `src/limits.ts` (tiers, rate limits,
the `CidxQuota` Durable Object). Every internal read goes through `handle()`, so it shares the Cache API copy and the R2 fallback of
public GETs; gather passes `rangeFillMax: 0` so sample objects are filled into the cache on their second ranged miss, not the first.

Bindings (all optional; without one its layer is off and the per-request caps in `src/limits.ts` still bound every request):

| binding | what for |
|---|---|
| `DB` (D1 `singlet-catalog`) | API keys, read only (`SELECT ... FROM api_keys WHERE key_hash = ?`) |
| `CIDX_RL_ANON`, `CIDX_RL_KEY` (Rate Limiting) | requests per minute per subject |
| `CIDX_QUOTA` (Durable Object `CidxQuota`, SQLite) | daily cells, bytes, scanned rows and worst-case dollars per subject ($0.05 anonymous, $1.00 per API key) |
| `SELF` (service binding to this Worker) + secret `CIDX_INTERNAL_SECRET` | big gathers split across sub-invocations (`POST /s1/cidx/_part`, refused without the secret) |
| `CIDX_LIMITS` (var, JSON) | overrides of the tier limits, e.g. `{"anon": {"maxCellsPerRequest": 5000, "usdPerDay": 0.02}}` |

### Cell export (`POST /s1/cidx/export`)

The cells of a gather, decoded in the Worker into files any tool reads: `src/export.ts`, with `src/pz2.ts` (a TypeScript port of the pz2
read side: the scalar codec-1 lane-rANS decoder of `include/singlet/pz2/detail/rans1_dec.h` and codec 2) and `src/zipstream.ts`. The body is a
gather body (`cells` or `query`, `version`) plus `genes`, `modality` (`counts` = spliced + unspliced, `spliced`, `unspliced`; no other
member is ever exported), `format` (`mtx`: a streamed zip of `matrix.mtx.gz`, `features.tsv.gz`, `barcodes.tsv.gz`, `obs.tsv.gz`,
`manifest.json`, `README.txt` in the 10x layout; `summary`: per cell type, the mean, mean per 10k and fraction expressing of up to 50
genes) and `samples` (per-sample columns for `obs.tsv.gz`). Exon and intron rows are summed into genes through the feature packs, as
`singlet.s1.atlas.gather` does; `dry_run: true` returns the plan. Caps: the gather caps, at most 10,000 cells, 64 MiB of planned sample
bytes and 30 million gene-level values (`EXPORT_LIMITS`). The website's `GET /api/cells/export` and the MCP tool `export_cells` call it.

Checks against the reference (`pip install singlet`):

```
python workers/data/scripts/pz2_truth.py <dir> GSE138867:2 GSE202371:1     # decode with singlet._pz2, write truth.json
node workers/data/scripts/pz2-check.ts <dir>                                # the TS decoder must give identical arrays
npx esbuild workers/data/scripts/export-live.ts --bundle --platform=node --format=esm --outfile=<tmp>/export-live.mjs
node <tmp>/export-live.mjs '{"cell_type":"T cell","tissue":"lung"}' out.zip 2000   # the route in Node, on the live objects
```

With the Worker's `CIDX_INTERNAL_SECRET` also set as a Pages secret, the website forwards who asked (`x-cidx-subject: acct:<id>` for an
MCP call, `x-cidx-client-ip` for someone opening a link), so the daily allowance is the downloader's, not the site's. `[limits] cpu_ms`
in wrangler.toml is raised to 120 s for the decode.

### Deploy the cell index (owner)

1. `npx wrangler secret put CIDX_INTERNAL_SECRET` (any random 32+ character string).
2. Check that the rate-limit `namespace_id`s 7301/7302 are unused in the account.
3. `npx wrangler deploy` (adds the Durable Object migration `cidx-quota-v1`).
4. Upload an index built by `scripts/s1_cidx_build.py` (objects first, `s1/cidx/current.json` last), then
   `curl -s -X POST https://data.singlet.bio/s1/cidx/query -d '{"where":{}}'` must return the cell total.
5. Measure: `python -P bench/cidx/measure.py https://data.singlet.bio` (singlet-bio) and tune `FANOUT_MAX_PARTS` if R2 latency differs
   from the assumed 40 ms.

### Local run (workerd + seeded R2)

```
npx esbuild workers/data/src/index.ts --bundle --format=esm --outfile=workers/singlet-data/.local/worker.mjs
node workers/data/scripts/local.mjs <dir laid out like the bucket: s1/m, s1/s, s1/ref, s1/cidx> 8799
```

`scripts/local.mjs` runs the bundle in Miniflare (the runtime of `wrangler dev --local`) with the R2 bucket seeded from the directory, the
quota Durable Object and the SELF fan-out (`--no-self` turns it off, `CIDX_FANOUT_MIN_READS=4` forces it). It exists because
`wrangler r2 object put --local` fails intermittently on Windows ("Network connection lost").

## Files

* `src/handler.ts`: all behaviour, runtime-neutral (`handle(request, { bucket, cache, waitUntil })`).
* `src/index.ts`: the Worker entry; wires `env.DATA` and `caches.default`.
* `wrangler.toml`: route, R2 binding (read only: the code only calls `get` and `head`), observability.
* `src/routes.ts`, `src/cidx.ts`, `src/gather.ts`, `src/scx.ts`, `src/limits.ts`: the cell index (above).
* Tests: `src/test/data-s1-worker.test.ts` and `src/test/data-s1-cidx.test.ts` (golden answers from singlet-bio in `src/test/fixtures/cidx`) in the repository root (runs in `npm test`; the types are checked by `npm run check`).

## Deploy (owner, once)

1. `cd workers/data && npx wrangler deploy` (account `2f8a8cc95b6bc0be84ac611fe2e5c3c2`, as for `workers/alpha-proxy`).
2. Check the route really wins over the R2 custom domain, which is a proxied record for the same hostname:
   `curl -sI https://data.singlet.bio/s1/ref/index.json | grep -i x-served-by` must print `x-served-by: singlet-data`
   (a 404 JSON body is expected until the first object is uploaded). Also check that
   `https://data.singlet.bio/data/GSE138867/GSE138867.singlet` is unchanged (no `x-served-by`).
3. If the route does not take precedence, remove the route from `wrangler.toml`, set
   `routes = [{ pattern = "ds1.singlet.bio", custom_domain = true }]`, deploy, and point clients at `https://ds1.singlet.bio/s1/`.

Roll back by removing the route (`npx wrangler delete` or delete the route in the dashboard): the R2 custom domain serves the
bucket exactly as before. The Worker never writes to the bucket.

## Local test

```
cd workers/data
npx wrangler r2 object put singlet-data/s1/s/GSM1/00112233445566778899aabbccddeeff.s1 --file some.bin --local
npx wrangler dev --local --port 8799 --compatibility-date <newest date your wrangler supports>
curl -si -H "Range: bytes=0-9" http://127.0.0.1:8799/s1/s/GSM1/00112233445566778899aabbccddeeff.s1
```

`wrangler.toml` pins `compatibility_date = "2026-10-01"`; a wrangler older than that date refuses to start locally, hence the flag.
The code uses nothing date-dependent.

/**
 * Renders Croissant documents with the same code the Pages Functions run (functions/_shared/croissant.ts), from production data,
 * read-only: D1 through `wrangler d1 execute singlet-catalog --remote` (SELECT statements only; anything else is refused before
 * wrangler runs) and the manifests and packs from data.singlet.bio. Used to make docs/croissant/ and to validate with mlcroissant
 * before a deploy.
 *
 *   npm run croissant:render -- --out docs/croissant GSE138867 GSE133773 GSE221988
 *   npm run croissant:render -- --out <dir> --atlas --local GSE138867
 *
 * Writes <GSE>.json (the study), <GSE>.<first GSM>.json (its first sample) and, with --atlas, atlas.json. With --local it also writes
 * the function-served CSVs next to the documents (samples, features, studies) and a copy of each document under local/ whose CSV
 * URLs are those relative files, so `mlcroissant load` can iterate the record sets before the routes are deployed.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAtlasCroissant,
  buildStudyCroissant,
  croissantUrls,
  featuresCsv,
  httpManifestFetcher,
  loadAtlasInput,
  loadStudyInput,
  oneSample,
  samplesCsv,
  studiesCsv,
  type CroissantUrls,
} from "../../functions/_shared/croissant";
import { computeStats } from "../../functions/_shared/stats-core";
import { geneTable, type PackFetcher } from "../../functions/_shared/s1-packs";

const DB_NAME = "singlet-catalog";

type Bind = string | number | null;

function literal(v: Bind): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("non-finite parameter");
    return String(v);
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Inlines ?N / ? parameters (wrangler's --command takes none). Placeholders inside string literals are left alone. */
export function inline(sql: string, values: Bind[]): string {
  let out = "";
  let next = 0;
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") inStr = !inStr;
    if (c === "?" && !inStr) {
      let j = i + 1;
      while (j < sql.length && /[0-9]/.test(sql[j])) j++;
      const n = j > i + 1 ? Number(sql.slice(i + 1, j)) - 1 : next++;
      if (n < 0 || n >= values.length) throw new Error(`no value for parameter ${n + 1}`);
      out += literal(values[n]);
      i = j - 1;
      continue;
    }
    out += c;
  }
  return out;
}

const READ_ONLY = /^\s*(SELECT|WITH)\b/i;
const WRITE_WORD = /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA|ATTACH|DETACH|VACUUM|REINDEX)\b/i;

let queries = 0;

function runRemote(sql: string): Record<string, unknown>[] {
  // Refuse anything that is not a single read. Words inside string literals are blanked before the write check.
  const bare = sql.replace(/'(?:[^']|'')*'/g, "''");
  if (!READ_ONLY.test(bare) || WRITE_WORD.test(bare) || bare.replace(/;\s*$/, "").includes(";")) throw new Error(`refusing a non-SELECT statement: ${sql.slice(0, 80)}`);
  queries++;
  let out = "";
  for (let attempt = 1; ; attempt++) {
    try {
      out = execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", DB_NAME, "--remote", "--json", "--command", sql], {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      break;
    } catch (e) {
      // a transient "fetch failed" from the D1 API: try again, three times at most
      if (attempt >= 3) throw e;
    }
  }
  const start = out.indexOf("[");
  const parsed = JSON.parse(out.slice(start)) as { results?: Record<string, unknown>[] }[];
  return parsed[0]?.results ?? [];
}

class Stmt {
  constructor(
    readonly sql: string,
    readonly values: Bind[] = []
  ) {}
  bind(...values: unknown[]): Stmt {
    return new Stmt(this.sql, values.map((v) => (v === undefined ? null : (v as Bind))));
  }
  async all<T>() {
    return { success: true, results: runRemote(inline(this.sql, this.values)) as T[], meta: {} };
  }
  async first<T>(col?: string): Promise<T | null> {
    const rows = runRemote(inline(this.sql, this.values));
    if (!rows.length) return null;
    return (col ? (rows[0][col] ?? null) : rows[0]) as T;
  }
  async run(): Promise<never> {
    throw new Error("read-only");
  }
}

/** The subset of D1Database the loaders use, over wrangler, read-only. */
const remoteDb = {
  prepare: (sql: string) => new Stmt(sql),
  batch: async () => {
    throw new Error("read-only");
  },
  exec: async () => {
    throw new Error("read-only");
  },
} as unknown as D1Database;

const fetchPack: PackFetcher = async (id) => {
  const res = await fetch(`https://data.singlet.bio/s1/ref/${id}.pack`);
  if (!res.ok) throw new Error(`pack ${id}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

const write = (path: string, body: string) => {
  writeFileSync(path, body);
  console.log(`wrote ${path} (${body.length.toLocaleString()} bytes)`);
};
const json = (doc: unknown) => JSON.stringify(doc, null, 1) + "\n";

function localUrls(): CroissantUrls {
  const prod = croissantUrls();
  return { ...prod, studiesCsv: "studies.csv", samplesCsv: (gse) => `${gse}.samples.csv`, featuresCsv: (id) => `features-${id}.csv` };
}

async function main() {
  const args = process.argv.slice(2);
  let out = "docs/croissant";
  let atlas = false;
  let local = false;
  const studies: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") out = args[++i];
    else if (args[i] === "--atlas") atlas = true;
    else if (args[i] === "--local") local = true;
    else studies.push(args[i].toUpperCase());
  }
  mkdirSync(out, { recursive: true });
  if (local) mkdirSync(join(out, "local"), { recursive: true });
  const prod = croissantUrls();
  const packsDone = new Set<string>();

  for (const gse of studies) {
    const input = await loadStudyInput(remoteDb, gse, httpManifestFetcher());
    if (!input) {
      console.error(`${gse}: not found (withheld, not downloadable or not .s1)`);
      process.exitCode = 1;
      continue;
    }
    write(join(out, `${gse}.json`), json(buildStudyCroissant(input, prod)));
    const first = oneSample(input, input.samples[0].gsm)!;
    write(join(out, `${gse}.${first.samples[0].gsm}.json`), json(buildStudyCroissant(first, prod, { single: true })));
    if (local) {
      const lu = localUrls();
      write(join(out, "local", `${gse}.json`), json(buildStudyCroissant(input, lu)));
      write(join(out, "local", `${gse}.${first.samples[0].gsm}.json`), json(buildStudyCroissant(first, lu, { single: true })));
      write(join(out, "local", `${gse}.samples.csv`), samplesCsv(input, prod));
      const pack = input.manifest.packs?.exon;
      if (pack && !packsDone.has(pack)) {
        packsDone.add(pack);
        const { build, genes } = await geneTable(fetchPack, pack);
        write(join(out, "local", `features-${pack}.csv`), featuresCsv(build, genes));
      }
    }
  }

  if (atlas) {
    const stats = await computeStats(remoteDb);
    if (!stats) throw new Error("no stats");
    const input = await loadAtlasInput(remoteDb, stats);
    write(join(out, "atlas.json"), json(buildAtlasCroissant(input, prod)));
    if (local) {
      write(join(out, "local", "atlas.json"), json(buildAtlasCroissant(input, localUrls())));
      write(join(out, "local", "studies.csv"), studiesCsv(input.studies, prod));
    }
  }
  console.log(`${queries} read-only D1 queries`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

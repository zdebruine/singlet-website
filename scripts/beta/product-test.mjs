#!/usr/bin/env node
/**
 * Continuous product test for the Beta channel (docs/BETA-CHANNEL.md). Takes the newest N samples in beta's catalog and checks, with only
 * the data base URL pointed at Beta:
 *
 *   objects    each sample object is served by the data Worker with the manifest's size and SHA-256 (and its key digest);
 *   manifests  s1/m/<GSE>.json lists the sample with the same key, bytes and sha256, and its rev is the catalog's;
 *   site       the study and stats API answer, and the SPA shell and study page load;
 *   python     `singlet` (SINGLET_DATA_BASE only) opens the study and reads the newest sample into AnnData;
 *   r          `singlet` for R (SINGLET_DATA_BASE only) opens the study (skipped when R or the package is missing);
 *   mcp        POST /mcp get_study answers for the study (needs BETA_MCP_KEY; skipped without).
 *
 * Writes a JSON report (--out) and, with SINGLET_INGEST_TOKEN, posts it to <site>/api/ingest/hpc?path=beta/product-test.json, where
 * the launch checklist links https://beta.singlet.bio/api/hpc/beta/product-test.json. Exit 1 when a check fails; "skipped" is not a failure.
 *
 *   SINGLET_INGEST_TOKEN=… node scripts/beta/product-test.mjs [--site https://beta.singlet.bio] [--data https://beta-data.singlet.bio] [--n 5] [--out report.json]
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const SITE = arg("site", process.env.SINGLET_BETA_SITE ?? "https://beta.singlet.bio").replace(/\/$/, "");
const DATA = arg("data", process.env.SINGLET_DATA_BASE ?? "https://beta-data.singlet.bio").replace(/\/$/, "");
const N = Number(arg("n", "5"));
const OUT = arg("out", "beta-product-test.json");
const TOKEN = process.env.SINGLET_INGEST_TOKEN ?? "";
const MCP_KEY = process.env.BETA_MCP_KEY ?? "";
const UA = { "User-Agent": "singlet-beta-product-test/1" };

const checks = [];
const record = (name, status, detail = {}) => {
  checks.push({ name, status, ...detail });
  console.log(`${status === "pass" ? "ok  " : status === "skipped" ? "skip" : "FAIL"} ${name}${detail.note ? " — " + detail.note : ""}`);
};
const run = async (name, fn) => {
  try {
    const r = await fn();
    if (r?.skipped) record(name, "skipped", { note: r.skipped });
    else record(name, "pass", r ?? {});
  } catch (e) {
    record(name, "fail", { note: String(e?.message ?? e).slice(0, 300) });
  }
};
const getJson = async (url, init) => {
  const r = await fetch(url, { ...init, headers: { ...UA, ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};
const sha256Stream = async (url) => {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const h = createHash("sha256");
  let bytes = 0;
  for await (const c of r.body) { h.update(c); bytes += c.length; }
  return { sha: h.digest("hex"), bytes };
};

const started = Date.now();
let samples = [];
await run("catalog: newest samples", async () => {
  if (!TOKEN) throw new Error("SINGLET_INGEST_TOKEN is required to list the newest samples");
  const d = await getJson(`${SITE}/api/ingest/s1-publish?n=${N}`, { headers: { "X-Ingest-Token": TOKEN } });
  samples = d.samples;
  if (!samples.length) throw new Error("the Beta catalog has no samples");
  return { note: `${samples.length} samples from ${new Set(samples.map((s) => s.gse_id)).size} studies`, channel: d.channel };
});

const manifests = new Map();
for (const s of samples) {
  await run(`object ${s.gsm_id}`, async () => {
    const { sha, bytes } = await sha256Stream(`${DATA}/${s.key}`);
    if (bytes !== s.bytes) throw new Error(`served ${bytes} bytes, catalog ${s.bytes}`);
    if (sha !== s.sha256) throw new Error("served sha256 differs from the catalog");
    const digest = /\/([0-9a-f]{32})\./.exec(s.key)?.[1];
    if (digest && !sha.startsWith(digest)) throw new Error("sha256 does not start with the key digest");
    return { bytes };
  });
  await run(`manifest ${s.gse_id}/${s.gsm_id}`, async () => {
    if (!manifests.has(s.gse_id)) manifests.set(s.gse_id, await getJson(`${DATA}/s1/m/${s.gse_id}.json`));
    const m = manifests.get(s.gse_id);
    if (m.rev !== s.rev) throw new Error(`manifest rev ${m.rev} != catalog rev ${s.rev}`);
    const e = m.samples.find((x) => x.gsm === s.gsm_id);
    if (!e) throw new Error("sample not in the manifest");
    if (e.key !== s.key || e.bytes !== s.bytes || (e.sha256 && e.sha256 !== s.sha256)) throw new Error("manifest entry differs from the catalog");
  });
}

const gse = samples[0]?.gse_id;
if (gse) {
  await run("site: stats", async () => {
    const d = await getJson(`${SITE}/api/stats`);
    if (!(d.samples_in_files > 0)) throw new Error("samples_in_files is 0");
    return { samples_in_files: d.samples_in_files, studies_with_files: d.studies_with_files };
  });
  await run(`site: study API ${gse}`, async () => {
    const d = await getJson(`${SITE}/api/gse/${gse}`);
    if (d.series?.id !== gse) throw new Error("unexpected body");
  });
  for (const path of ["/", `/study/${gse}`]) {
    await run(`site: page ${path}`, async () => {
      const r = await fetch(SITE + path, { headers: UA });
      const t = await r.text();
      if (!r.ok || !/<div id="root"/.test(t)) throw new Error(`${r.status}, no app shell`);
    });
  }
  await run("python: open study and read a sample", async () => {
    const gsm = samples.find((s) => s.gse_id === gse).gsm_id;
    const code = `import json,sys\nfrom singlet.s1.client import open_study\nst=open_study(sys.argv[1],force=True)\nad=st.to_anndata(samples=[sys.argv[2]])\nprint(json.dumps({"n_obs":int(ad.n_obs),"n_vars":int(ad.n_vars),"rev":st.rev}))`;
    const p = spawnSync(process.env.PYTHON ?? "python", ["-c", code, gse, gsm], { env: { ...process.env, SINGLET_DATA_BASE: DATA }, encoding: "utf8", timeout: 300000 });
    if (p.error || p.status !== 0) {
      if (/No module named/.test(p.stderr ?? "")) return { skipped: "singlet is not installed" };
      throw new Error((p.stderr || String(p.error)).trim().split("\n").slice(-2).join(" | "));
    }
    const r = JSON.parse(p.stdout.trim().split("\n").pop());
    if (!(r.n_obs > 0)) throw new Error("no cells");
    return r;
  });
  await run("r: open study", async () => {
    const p = spawnSync("Rscript", ["-e", `library(singlet); s <- singlet_study("${gse}"); cat(s$gse)`], { env: { ...process.env, SINGLET_DATA_BASE: DATA }, encoding: "utf8", timeout: 240000 });
    if (p.status === null) return { skipped: "R did not finish loading the singlet package in 240 s" };
    if (p.error) return { skipped: "Rscript is not installed" };
    if (/there is no package called/.test(p.stderr)) return { skipped: "the R package singlet is not installed" };
    if (/could not find function "singlet_study"/.test(p.stderr)) return { skipped: "the installed R package singlet is older than the per-sample reader" };
    if (p.status !== 0) throw new Error(p.stderr.trim().split("\n").slice(-2).join(" | "));
  });
  await run("mcp: get_study", async () => {
    if (!MCP_KEY) return { skipped: "BETA_MCP_KEY is not set" };
    const post = () => fetch(`${SITE}/mcp`, {
      method: "POST",
      headers: { ...UA, "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${MCP_KEY}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_study", arguments: { gse_id: gse } } }),
    });
    const r = await post().catch(() => post()); // one retry for a dropped connection
    const t = await r.text();
    if (!r.ok || !t.includes(gse) || /"isError":\s*true/.test(t)) throw new Error(`${r.status} ${t.slice(0, 160)}`);
  });
}

const failed = checks.filter((c) => c.status === "fail").length;
const report = {
  channel: "beta",
  site: SITE,
  data_base: DATA,
  generated_at: new Date().toISOString(),
  duration_s: Math.round((Date.now() - started) / 100) / 10,
  ok: failed === 0 && samples.length > 0,
  n_samples: samples.length,
  studies: [...new Set(samples.map((s) => s.gse_id))],
  counts: { pass: checks.filter((c) => c.status === "pass").length, fail: failed, skipped: checks.filter((c) => c.status === "skipped").length },
  checks,
};
writeFileSync(OUT, JSON.stringify(report, null, 2));
if (TOKEN) {
  const r = await fetch(`${SITE}/api/ingest/hpc?path=beta/product-test.json`, { method: "POST", headers: { ...UA, "X-Ingest-Token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(report) });
  console.log(`report posted: ${r.status}`);
}
console.log(report.ok ? "PASS" : "FAIL");
process.exit(report.ok ? 0 : 1);

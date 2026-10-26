/**
 * Rebuild public/data/benchmarks/index.json from the result files next to it (results contract 1.x).
 *   node scripts/benchmarks/build-index.mjs
 * The status roll-up is the same as docStatus() in src/lib/benchmarks.ts: only a final document whose gating
 * metrics all pass is "pass"; any failing gating metric is "fail"; anything else is "incomplete"; no file is "missing".
 * Owners and the capability order come from the previous index, so capabilities with no file stay listed.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "public/data/benchmarks";
const prev = JSON.parse(readFileSync(join(DIR, "index.json"), "utf8"));
const owners = new Map(prev.capabilities.map((c) => [c.capability, c.owner]));
const order = prev.capabilities.map((c) => c.capability);

const files = readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "index.json");
const docs = new Map();
for (const f of files) {
  const raw = readFileSync(join(DIR, f));
  const d = JSON.parse(raw.toString("utf8"));
  if (d.schema !== "singlet.benchmark.capability") continue;
  docs.set(d.capability, { d, file: f, sha256: createHash("sha256").update(raw).digest("hex") });
  if (!order.includes(d.capability)) order.push(d.capability);
}

const gating = (m) => m.rule?.type !== "informational";

const capabilities = order.map((capability) => {
  const hit = docs.get(capability);
  const owner = owners.get(capability) ?? hit?.d.owner ?? "unknown";
  if (!hit) return { capability, title: null, file: null, owner, status: "missing", n_metrics: 0, n_pass: 0, n_fail: 0, n_na: 0 };
  const { d, file, sha256 } = hit;
  const g = d.metrics.filter(gating);
  const n_pass = g.filter((m) => m.pass === "pass").length;
  const n_fail = g.filter((m) => m.pass === "fail").length;
  const status = n_fail > 0 ? "fail" : d.status === "final" && g.length > 0 && n_pass === g.length ? "pass" : "incomplete";
  const ids = new Set(d.metrics.map((m) => m.id));
  const unresolved = [...new Set(d.metrics.flatMap((m) => m.corroborated_by ?? []).filter((id) => !ids.has(id)))];
  return {
    capability,
    title: d.title,
    file,
    sha256,
    owner,
    doc_status: d.status,
    valid: true,
    generated_at: d.generated_at,
    conclusion: d.conclusion,
    n_caveats: (d.caveats ?? []).length,
    status,
    n_metrics: g.length,
    n_pass,
    n_fail,
    n_na: d.metrics.length - g.length,
    ...(unresolved.length ? { unresolved_corroboration: unresolved } : {}),
  };
});

const commits = new Map();
for (const { d } of docs.values()) commits.set(d.singlet.commit, d.singlet.version);
const n_pass = capabilities.filter((c) => c.status === "pass").length;
const latest = [...docs.values()].map(({ d }) => d.generated_at).sort().pop() ?? new Date().toISOString();

const index = {
  schema: "singlet.benchmark.index",
  schema_version: prev.schema_version ?? "1.1.0",
  generated_at: latest,
  singlet: [...commits].map(([commit, version]) => ({ commit, version })),
  overall: n_pass === capabilities.length ? "pass" : capabilities.some((c) => c.status === "fail") ? "fail" : "incomplete",
  n_capabilities: capabilities.length,
  n_pass,
  capabilities,
};
writeFileSync(join(DIR, "index.json"), JSON.stringify(index, null, 1) + "\n");
console.log(`index.json: ${capabilities.length} capabilities, ${docs.size} with results, ${n_pass} passing`);

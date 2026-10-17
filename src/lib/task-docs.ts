/**
 * Task documentation (alpha). Static content exported by tasks/_tools/build_site_content.py lives under
 * /task-docs: index.json, <area>/<task>.md, mcp/<tool>.json, benchmarks/ and recipes/.
 */
export const TASK_DOCS_BASE = "/task-docs";

export type TaskTier = "P0" | "P1" | "P2" | "P3";

export interface TaskMeta {
  id: string;
  title: string;
  area: string;
  scope: "core" | "extended";
  paradigm?: string | null;
  status?: string | null;
  priority?: TaskTier | "unassigned" | null;
  summary?: string;
  question?: string;
  depends_on?: string[];
  feeds?: string[];
  reads?: string[];
  writes?: string[];
  devices?: string[];
  mcp_tool?: string;
  doc?: string;
  mcp?: string | null;
  benchmarks?: { id: string; title: string }[];
  n_refs?: number;
  n_verified?: number;
  n_partial?: number;
  n_unverified?: number;
  repos?: string[];
  documented: boolean;
  engine_tools?: string[];
}

export interface TaskArea {
  slug: string;
  name: string;
  scope: "core" | "extended";
  count: number;
}

export interface TaskIndex {
  version: number;
  generated: string;
  areas: TaskArea[];
  tasks: TaskMeta[];
  stats: { documented: number; planned: number; total: number };
}

export const TIER_LABEL: Record<string, string> = {
  P0: "Core workflow",
  P1: "Widely used",
  P2: "Specialised",
  P3: "Emerging",
};

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${TASK_DOCS_BASE}/${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

export const fetchTaskIndex = () => getJson<TaskIndex>("index.json");

export async function fetchTaskDoc(path: string): Promise<string> {
  const r = await fetch(`${TASK_DOCS_BASE}/${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  const text = await r.text();
  // The SPA fallback answers unknown paths with index.html; refuse it so a missing document is a clear error.
  if (/^\s*<!doctype html/i.test(text)) throw new Error(`${path}: not found`);
  return text;
}

export const fetchTaskMcp = (path: string) => getJson<Record<string, unknown>>(path);

/** Split a document into its front matter (flat key: value / inline [a, b] lists) and body. */
export function splitFrontMatter(md: string): { fm: Record<string, string | string[]>; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: {}, body: md };
  const fm: Record<string, string | string[]> = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).replace(/\s+#.*$/, "").trim();
    fm[k] = v.startsWith("[") && v.endsWith("]")
      ? v.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
      : v.replace(/^["']|["']$/g, "");
  }
  return { fm, body: md.slice(m[0].length) };
}

/** Drop the leading `# Title` heading (the page prints the title itself). */
export function stripTitle(body: string): string {
  return body.replace(/^\s*#\s+.*\r?\n/, "");
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `## 3. Theory and insight` headings, for the table of contents. */
export function extractHeadings(body: string): { level: 2 | 3; text: string; id: string }[] {
  const out: { level: 2 | 3; text: string; id: string }[] = [];
  let fence = false;
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("```")) fence = !fence;
    if (fence) continue;
    const m = line.match(/^(#{2,3})\s+(.+?)\s*$/);
    if (m) out.push({ level: m[1].length as 2 | 3, text: m[2].replace(/[`*]/g, ""), id: slugify(m[2]) });
  }
  return out;
}

export const TASK_ID_RE = /^[a-z0-9-]+\.[a-z0-9_]+$/;

export function taskPath(id: string): string {
  const [area, ...rest] = id.split(".");
  return `/tasks/${area}/${rest.join(".")}`;
}

export interface ToolMeta {
  name: string;
  tool: string;
  title: string;
  task_id: string;
  description: string;
  params: string[];
  required: string[];
  reads: string[];
  writes: string[];
  doc: string;
  mcp: string;
  has_notes: boolean;
}

export interface ToolIndex {
  version: number;
  status: string;
  tools: ToolMeta[];
}

export const fetchToolIndex = () => getJson<ToolIndex>("tools/index.json");
export const toolPath = (name: string) => `/tools/${name}`;

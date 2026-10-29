import { Link } from "react-router-dom";
import { Logo } from "@/components/Logo";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { CodeBlock } from "@/components/CodeBlock";
import { usePageMeta } from "@/hooks/usePageMeta";
import { GITHUB_ISSUES } from "@/lib/install-snippets";
import { MCP_URL } from "@/lib/mcp-snippets";

// The AI-readable twin of this page is public/docs/claude-api.md; keep the two in step.
const MD_URL = "/docs/claude-api.md";
const CONNECTOR_DOCS = "https://platform.claude.com/docs/en/agents-and-tools/mcp-connector";

const PYTHON = `import os
import anthropic

client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY
SINGLET_KEY = open(os.path.expanduser("~/.singlet/api_key")).read().strip()

MCP = dict(
    betas=["mcp-client-2025-11-20"],
    mcp_servers=[{
        "type": "url",
        "url": "${MCP_URL}",
        "name": "singlet",
        "authorization_token": SINGLET_KEY,
    }],
    tools=[{
        "type": "mcp_toolset",
        "mcp_server_name": "singlet",
        "configs": {"save_cohort": {"enabled": False}},  # the one write tool
    }],
)

messages = [{"role": "user", "content": "How many called cells does GSE270225 contain in the Singlet atlas?"}]
while True:
    r = client.beta.messages.create(model="claude-opus-5-5", max_tokens=16000, messages=messages, **MCP)
    messages.append({"role": "assistant", "content": r.content})
    for b in r.content:
        if b.type == "mcp_tool_use":
            print("tool:", b.name, b.input)
    if r.stop_reason != "pause_turn":  # a long server-side tool loop can pause; send the turn back to continue
        break
print(next(b.text for b in reversed(r.content) if b.type == "text"))`;

const ALLOWLIST = `{
  "type": "mcp_toolset",
  "mcp_server_name": "singlet",
  "default_config": {"enabled": false},
  "configs": {
    "search_cells": {"enabled": true},
    "get_sample_qc": {"enabled": true},
    "find_matched_controls": {"enabled": true}
  }
}`;

const TOOLS: { name: string; use: string; input: string }[] = [
  { name: "search_datasets", use: "Find studies (or samples) from plain English or a GEO accession; filters by organism, tissue, disease, assay and by the per-cell labels cell_type_label, sex_genetic, ancestry_genetic", input: "query*, level, limit (≤50), page, organism, tissue, disease, assay, min_cells, sex_genetic, ancestry_genetic, cell_type_label, include_unbuilt, include_low_qc" },
  { name: "get_study", use: "Everything about one study: title, abstract, groups, conditions, first 60 samples, completeness, loaders", input: "gse_id*, known_rev" },
  { name: "assess_study", use: "Deterministic usability report; with purpose, fit checks (velocity, aging …)", input: "gse_id*, purpose" },
  { name: "get_sample_qc", use: "Per-sample QC read from the files: cells called, median UMI and genes, mapping, mito, input reads", input: "gse_id*, gsm_ids, known_rev" },
  { name: "get_modalities", use: "What the file carries beyond gene counts, with Python and R readers. Check before promising a modality", input: "gse_id*, gsm_id, modalities" },
  { name: "list_bundle_files", use: "Every member of every sample object, with sizes and byte ranges", input: "gse_id*, gsm_id, detail, modalities, limit (≤500), after" },
  { name: "get_download_url", use: "The study manifest URL, size and loaders; optionally the sample objects", input: "gse_id*, include_samples, modalities, limit (≤200), after" },
  { name: "get_partial_download", use: "Byte range, curl and Python for one member of one sample", input: "gse_id*, gsm_id*, file, modalities" },
  { name: "export_manifest", use: "TSV, JSON, curl, wget, Python or R manifest for up to 2,000 studies", input: "query / filters / gse_ids, format*" },
  { name: "find_matched_controls", use: "Candidate control studies: same organism and tissue group, no disease label, each with a why and caveats", input: "gse_id*, min_samples, same_assay" },
  { name: "compare_studies", use: "2–8 studies side by side plus a differences list", input: "gse_ids*" },
  { name: "get_atlas_stats", use: "Live atlas size (studies, usable samples, cells in published files)", input: "—" },
  { name: "search_cells", use: "Count and locate cells across the atlas by cell type, sex, ancestry, UMIs, genes, tissue, disease, stage, age, assay, study …; AND/OR/NOT; ontology terms match descendants", input: "where or question, include_low_qc, limit (≤200), offset" },
  { name: "get_cells_page", use: "One page (≤10,000 cells, ≤10 studies) of the cells a search_cells filter matches, with matrix byte ranges and a one-POST gather body", input: "where or question, page_cells, cursor, modalities" },
  { name: "find_cells", use: "Cells in chosen samples by per-cell statistics and labels, as [start, length] column runs", input: "gse_ids / gsm_ids / sample_filter, cell_filter, cell_labels, limit_samples (≤25), max_runs_per_sample, after" },
  { name: "slice_cells", use: "Byte ranges to read only some cells of one sample's matrices (a prefix once, then chunk runs)", input: "gse_id*, gsm_id*, runs / indices / range, file or modalities, max_ranges (≤200)" },
  { name: "resolve_features", use: "Matrix row numbers to feature names (or column numbers to barcodes), up to 500", input: "indices*, pack or gse_id + gsm_id + file, axis" },
  { name: "get_cohort", use: "A saved, version-pinned cohort", input: "id*, token" },
  { name: "save_cohort", use: "Save up to 2,000 studies as a cohort on your account. The only write tool", input: "name*, gse_ids*, notes, visibility, workspace_id" },
];

const PILOT: { arm: string; correct: string; spend: string; latency: string; calls: string }[] = [
  { arm: "No tools", correct: "0/6", spend: "$0.07", latency: "9 s", calls: "0" },
  { arm: "Raw files + Python", correct: "3/6", spend: "$1.57", latency: "109 s", calls: "12" },
  { arm: "MCP + raw files + Python", correct: "6/6", spend: "$0.63", latency: "72 s", calls: "3" },
];

/** Copied from bench/agent-readiness/results/transcripts/pilot/mcp/claude-opus-5-5/*.json in singlet-agents. Never invent results. */
const EXAMPLES: { id: string; title: string; question: string; blocks: { label: string; code: string }[]; after: React.ReactNode }[] = [
  {
    id: "ex-ontology-count",
    title: "1. Atlas-wide ontology cell count",
    question:
      "How many cells labelled T cell (CL:0000084, including subtypes) are there from samples of lung tissue (or any part of the lung) from donors with cancer whose cells the atlas labels chromosomally male?",
    blocks: [
      {
        label: "mcp tool call → result",
        code: `search_cells {"where": {"cell_type": "CL:0000084", "tissue": ["UBERON:0002048"], "disease": "MONDO:0004992", "sex": "male"}, "limit": 5}
→ 18,496 cells in 9 samples of 2 studies. Most: GSE144945 (13,931), GSE198896 (4,565).`,
      },
    ],
    after: (
      <>
        The agent re-ran it with labels (<code className="code-inline">"cell_type": "T cell", "tissue": ["lung"], "disease": "cancer"</code>) and with{" "}
        <code className="code-inline">"disease_group": "Cancer"</code>; all three gave 18,496. Correct; 3 tool calls, 37 s, $0.09. Without the MCP
        server the same agent spent 26 tool calls and $0.59 on the raw files, hit the 15-minute deadline and never answered: it could not tell which
        samples are lung tumour.
      </>
    ),
  },
  {
    id: "ex-study-count",
    title: "2. One cell type in one study",
    question: "How many called cells in GSE200253 are labelled CD8-positive, alpha-beta T cell (CL:0000625), including its subtypes?",
    blocks: [
      {
        label: "mcp tool call → result",
        code: `search_cells {"where": {"study": "GSE200253", "cell_type": "CL:0000625"}, "limit": 5}
→ 2,626 cells in 6 samples of 1 studies. Most: GSE200253 (2,626).`,
      },
    ],
    after: (
      <>
        The agent then counted from each sample's cells table in Python (called cells whose <code className="code-inline">cell_type_path</code>{" "}
        contains CL:0000625): 896 + 187 + 323 + 418 + 427 + 375 = 2,626. Correct; 4 tool calls, $0.11.
      </>
    ),
  },
  {
    id: "ex-controls",
    title: "3. Matched controls",
    question:
      "GSE299340 is a human Liver study (Cancer). Propose 3 to 5 candidate control studies: same organism, same tissue group, no disease label other than healthy/control.",
    blocks: [
      {
        label: "mcp tool call → result (first two of ten)",
        code: `find_matched_controls {"gse_id": "GSE299340"}
→ 10 candidate control studies for GSE299340 (Human, Liver).
- GSE299043 — Multimodal profiling reveals tissue-directed signatures of human immune cells altered with age
  why: same organism (Human), tissue Liver, assay 10x 3', same reference GRCh38-2024-A, 310 samples in file, no disease label
- GSE206325 — Intratumoral mregDC and Tfh-like niches enable local reinvigoration of CD8 T cells following PD-1 blockade
  why: same organism (Human), tissue Liver, assay 10x 3', same reference GRCh38-2024-A, 195 samples in file, no disease label
…`,
      },
    ],
    after: (
      <>
        The agent read the titles and proposed GSE299043, GSE223581, GSE194189 and GSE168933. It left out six candidates whose titles suggest diseased
        tissue although the catalog gives them no disease label (GSE206325, GSE203608 and GSE306201 are tumour studies, GSE289173 is MASH). Correct; 1
        tool call, 19 s, $0.10. A missing disease label is not proof of healthy tissue: read the titles or <code className="code-inline">get_study</code>.
      </>
    ),
  },
  {
    id: "ex-slice",
    title: "4. The cells of one type in one sample, then slice them",
    question:
      "List the matrix column indices (0-based) of the called cells in sample GSM7518425 (study GSE236111) whose cell-type label is exactly 'endothelial cell of artery'.",
    blocks: [
      {
        label: "python (the agent's run_python call)",
        code: `import requests
from singlet.s1 import cells
m = requests.get("https://data.singlet.bio/s1/m/GSE236111.json").json()
s = [x for x in m['samples'] if x['gsm'] == 'GSM7518425'][0]
url = "https://data.singlet.bio/" + s['key']; c = s['members']['cells']
blob = requests.get(url, headers={"Range": f"bytes={c['off']}-{c['off']+c['len']-1}"}).content
r = cells.CellsReader(lambda o, l: blob[o:o+l], len(blob))
called = list(r.column('called')); lab = list(r.column('cell_type_label'))
idx = [i for i in range(r.n_rows) if called[i] and lab[i] == 'endothelial cell of artery']
# → 2886 called cells; idx = [395, 461, 474, 565, 730, 745, 755, 856, 1117, 1238, 1274, 1526, 1827, 2016,
#    2058, 2060, 2408, 2422, 2469, 2475, 2790, 2944, 3101, 3205]`,
      },
      {
        label: "next step: slice_cells (live call made while writing this guide, 2026-10-28; not part of the benchmark)",
        code: `slice_cells {"gse_id": "GSE236111", "gsm_id": "GSM7518425", "indices": [395, 461, …, 3205]}
→ url https://data.singlet.bio/s1/s/GSM7518425/583976d2030e045f23a69fbe5c3484bf.s1 (immutable)
  exon_counts.1pz:   prefix bytes=690304-787629 (97,326 B) + 13 chunk ranges (707,258 B); 19 of 129 chunks; member 3,647,846 B
  intron_counts.1pz: prefix bytes=4338176-4405511 (67,336 B) + 1 chunk range (247,132 B); 4 of 20 chunks; member 706,561 B`,
      },
    ],
    after: (
      <>
        The Python answer was correct ($0.10); the agent noted that 'endothelial cell of artery' is a cell-type-level label (per-study accuracy about
        0.43), so a preview. Through the API connector Claude sees only the summary line of the slice_cells result (<a href="#pitfalls">pitfall 1</a>); the
        ranges shown are from its structured content. To read only those 24 cells' counts, GET the prefix once and the chunk ranges with a Range header on the object URL; the
        chunks decode independently, and <code className="code-inline">singlet.load(gse, samples=[gsm])</code> does it for you. For gene names, pass
        the <code className="code-inline">pack</code> id from the result to <code className="code-inline">resolve_features</code>.
      </>
    ),
  },
  {
    id: "ex-mcp-python",
    title: "5. MCP to find the samples, Python on the .s1 files to rank them",
    question:
      "Among the atlas samples of lung tissue from donors with cancer, which sample contains the most CD8-positive, alpha-beta T cells (CL:0000625, including subtypes)?",
    blocks: [
      {
        label: "mcp tool calls → results",
        code: `search_cells {"where": {"cell_type": "CL:0000625", "tissue": ["UBERON:0002048"], "disease": "MONDO:0004992"}, "limit": 5}
→ 14,435 cells in 15 samples of 3 studies. Most: GSE144945 (12,022), GSE198896 (2,396), GSE184242 (17).
find_cells {"gse_ids": ["GSE144945"], "cell_labels": {"cell_type": ["CL:0000625"]}, "limit_samples": 25, "max_runs_per_sample": 1}
→ 12,022 cells match in 10 of 10 samples scanned (10 reads of the data host).`,
      },
      {
        label: "python (the agent's run_python call)",
        code: `import requests
from singlet.s1 import cells
for g in ["GSE144945", "GSE198896", "GSE184242"]:
    m = requests.get(f"https://data.singlet.bio/s1/m/{g}.json").json()
    for s in m["samples"]:
        mem = s["members"]["cells"]; off = mem["off"]; url = "https://data.singlet.bio/" + s["key"]
        def fetch(o, l, off=off, url=url):
            return requests.get(url, headers={"Range": f"bytes={off+o}-{off+o+l-1}"}).content
        r = cells.CellsReader(fetch, mem["len"])
        called = r.column("called"); path = r.column("cell_type_path")
        n = sum(1 for c, p in zip(called, path) if c and p is not None and "CL:0000625" in str(p))
        print(g, s["gsm"], n)
# GSE144945 GSM4301254 2283   (top; GSM4301255 2071, GSM4301258 1590; the ten GSE144945 samples sum to 12,022)`,
      },
    ],
    after: (
      <>
        The text did not list samples (see <a href="#pitfalls">pitfall 1</a>), so the agent counted per sample from the cells tables. Answer
        GSM4301254, correct; 7 tool calls, 212 s, $0.15. A shorter path: the same filter on{" "}
        <code className="code-inline">GET https://singlet.bio/api/cells</code> returns the sample list directly (first row{" "}
        <code className="code-inline">{`{"gsm_id": "GSM4301254", "gse_id": "GSE144945", "cells": 2283}`}</code>).
      </>
    ),
  },
  {
    id: "ex-qc",
    title: "6. A study's cell total",
    question: "How many called cells does GSE270225 contain in total?",
    blocks: [
      {
        label: "mcp tool call → result",
        code: `get_sample_qc {"gse_id": "GSE270225"}
→ GSE270225 — per-sample QC for 6 samples (read from the .singlet file itself).
  Totals: 36,857 cells called · median 514 UMI and 381.5 genes per cell · 80.71% uniquely mapped · reference GRCh38-2024-A · 10xv3.`,
      },
    ],
    after: <>Correct; 1 tool call, 33 s, $0.08.</>,
  },
];

/**
 * Worked examples from the 10-question showcase panel (singlet-agents), to be added. Same shape and rules as EXAMPLES:
 * real tool calls and real results copied from the transcripts. Mirror them in public/docs/claude-api.md (SHOWCASE-EXAMPLES).
 */
const SHOWCASE: typeof EXAMPLES = [];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="pb-12 mb-12 border-b border-border scroll-mt-20">
      <h2 className="mb-4">{title}</h2>
      {children}
    </section>
  );
}

function Example({ e }: { e: (typeof EXAMPLES)[number] }) {
  return (
    <div id={e.id} className="mb-10 scroll-mt-20">
      <h3>{e.title}</h3>
      <p>
        <strong>Question:</strong> {e.question}
      </p>
      {e.blocks.map((b) => (
        <CodeBlock key={b.label} className="mb-3" label={b.label} code={b.code} />
      ))}
      <p>{e.after}</p>
    </div>
  );
}

export default function DocsClaudeApi() {
  usePageMeta({
    title: "Use singlet.bio with Claude: API user guide",
    description:
      "Connect Claude to the singlet.bio single-cell atlas: API keys, the Claude connector, the Anthropic API MCP connector in Python, every tool and the order to call them, limits, worked examples from real benchmark transcripts and known pitfalls.",
    path: "/docs/claude-api",
  });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="container-site flex-1 py-10 md:py-14">
        <article className="prose-doc max-w-[760px]">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            <Link to="/docs" className="hover:underline">
              Docs
            </Link>{" "}
            / Claude API
          </p>
          <Logo variant="mark" height={28} link={false} className="docs-brand-mark mb-4" />
          <h1 className="text-[36px] md:text-[42px] mb-3">Use singlet.bio with Claude</h1>
          <p className="text-lg text-muted-foreground">
            Give Claude the atlas through its public MCP server: as a connector in Claude.ai and Claude Desktop, or from your own code with the Anthropic
            API's MCP connector.
          </p>
          <p className="text-sm text-muted-foreground">
            For agents: the same guide as markdown at <a href={MD_URL}>{`https://singlet.bio${MD_URL}`}</a> (listed in{" "}
            <a href="/llms.txt">llms.txt</a>). Checked against the live <code className="code-inline">tools/list</code> and the{" "}
            <a href={CONNECTOR_DOCS} target="_blank" rel="noopener noreferrer">
              MCP connector docs
            </a>{" "}
            on 2026-10-28. Other clients (Claude Code, Cursor, VS Code, ChatGPT): <Link to="/docs/mcp">MCP setup</Link>.
          </p>

          <Section id="server" title="What the server is">
            <ul>
              <li>
                <code className="code-inline">{MCP_URL}</code>: MCP over Streamable HTTP, stateless. Claude's MCP connector uses tools only, which is all
                this server needs.
              </li>
              <li>
                Data: Research Alpha, public GEO single-cell RNA-seq studies reprocessed from raw reads with one pipeline, CC0. One immutable{" "}
                <code className="code-inline">.s1</code> object per sample (HTTP Range supported) plus a study manifest at{" "}
                <code className="code-inline">https://data.singlet.bio/s1/m/&lt;GSE&gt;.json</code>.
              </li>
              <li>
                Per-cell labels: Cell Ontology cell type, chromosomal sex, genetic ancestry (HANCESTRO). Sample metadata is mapped to UBERON tissue, MONDO
                disease, HsapDv/MmusDv stage and PATO sex. Live atlas size: <code className="code-inline">get_atlas_stats</code>.
              </li>
              <li>Every number and every "why" string a tool returns is computed, not generated. Quote them; don't paraphrase.</li>
            </ul>
          </Section>

          <Section id="key" title="1. Get an API key">
            <ol>
              <li>
                Sign in at <Link to="/account">your account</Link> with GitHub or Google (free).
              </li>
              <li>
                Under API keys, choose Create key. The key starts <code className="code-inline">sk_live_</code> and is shown once; store it like a password,
                for example in <code className="code-inline">~/.singlet/api_key</code>.
              </li>
              <li>
                Send it as <code className="code-inline">Authorization: Bearer &lt;key&gt;</code>. With the Anthropic API it goes in{" "}
                <code className="code-inline">authorization_token</code>.
              </li>
            </ol>
            <p className="text-sm text-muted-foreground">
              Without a key or a sign-in, <code className="code-inline">initialize</code> and every <code className="code-inline">tools/call</code> answer
              HTTP 401 <code className="code-inline">sign_in_required</code>. Downloads from <code className="code-inline">data.singlet.bio</code> never need
              a key.
            </p>
          </Section>

          <Section id="connect" title="2. Connect">
            <h3>Claude.ai, Claude Desktop, Claude mobile</h3>
            <p>
              Settings → Connectors → Add custom connector → <code className="code-inline">{MCP_URL}</code> → Connect, then sign in to singlet.bio with
              GitHub or Google. No key to copy. Disconnect from <Link to="/account#connectors">your account</Link>.
            </p>

            <h3 id="api" className="scroll-mt-20">
              Anthropic API (Python, MCP connector)
            </h3>
            <p>The Messages API calls the MCP server for you. Three parts:</p>
            <ul>
              <li>
                the beta header <code className="code-inline">mcp-client-2025-11-20</code> (<code className="code-inline">betas=[…]</code> on{" "}
                <code className="code-inline">client.beta.messages.create</code>);
              </li>
              <li>
                <code className="code-inline">mcp_servers</code>: one entry with <code className="code-inline">type</code> "url", the URL, a{" "}
                <code className="code-inline">name</code> and your singlet.bio key as <code className="code-inline">authorization_token</code>;
              </li>
              <li>
                an <code className="code-inline">mcp_toolset</code> in <code className="code-inline">tools</code> that names the server, with{" "}
                <code className="code-inline">configs</code> to turn tools off. <code className="code-inline">save_cohort</code> is the only tool that writes
                (it saves a cohort to your account); disable it for a read-only agent.
              </li>
            </ul>
            <CodeBlock label="python" code={PYTHON} />
            <ul className="mt-4">
              <li>
                To allowlist instead, turn everything off in <code className="code-inline">default_config</code> and enable what you want:
                <CodeBlock className="mt-2" label="tools[0]" code={ALLOWLIST} />
              </li>
              <li>
                Responses carry <code className="code-inline">mcp_tool_use</code> blocks (<code className="code-inline">id</code>,{" "}
                <code className="code-inline">name</code>, <code className="code-inline">server_name</code>, <code className="code-inline">input</code>) and{" "}
                <code className="code-inline">mcp_tool_result</code> blocks (<code className="code-inline">tool_use_id</code>,{" "}
                <code className="code-inline">is_error</code>, <code className="code-inline">content</code>). Only the content text reaches Claude, not the
                server's <code className="code-inline">structuredContent</code> (<a href="#pitfalls">pitfall 1</a>).
              </li>
              <li>
                MCP tools run on Anthropic's side. Your own client tools (a Python sandbox, say) can sit in the same <code className="code-inline">tools</code>{" "}
                list and run in the usual tool-use loop.
              </li>
              <li>
                The toolset takes <code className="code-inline">cache_control</code>; with the tool list cached, repeated questions cost less.
              </li>
              <li>
                Anthropic also documents a newer beta header, <code className="code-inline">mcp-client-2026-09-15</code>, which includes everything in{" "}
                <code className="code-inline">mcp-client-2025-11-20</code> and adds pinning of a server's tool list. The examples below ran with{" "}
                <code className="code-inline">mcp-client-2025-11-20</code>.
              </li>
            </ul>
          </Section>

          <Section id="tools" title="3. The tools and the order to call them">
            <p>
              <strong>Studies:</strong> <code className="code-inline">search_datasets</code> → <code className="code-inline">assess_study</code> or{" "}
              <code className="code-inline">get_study</code> → <code className="code-inline">get_sample_qc</code> →{" "}
              <code className="code-inline">get_modalities</code> → <code className="code-inline">get_download_url</code> (whole study) or{" "}
              <code className="code-inline">get_partial_download</code> (one sample's matrix) → <code className="code-inline">export_manifest</code> for a
              cohort. <code className="code-inline">find_matched_controls</code> and <code className="code-inline">compare_studies</code> help pick
              controls.
            </p>
            <p>
              <strong>Cells:</strong> <code className="code-inline">search_cells</code> (count and locate cells atlas-wide) →{" "}
              <code className="code-inline">get_cells_page</code> (the cells and their matrix byte ranges) or <code className="code-inline">find_cells</code>{" "}
              (cells in named samples) → <code className="code-inline">slice_cells</code> (byte ranges for some cells of one sample) →{" "}
              <code className="code-inline">resolve_features</code> (row numbers to gene names).
            </p>
            <table>
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Use it for</th>
                  <th>Main inputs</th>
                </tr>
              </thead>
              <tbody>
                {TOOLS.map((t) => (
                  <tr key={t.name}>
                    <td>
                      <code className="code-inline">{t.name}</code>
                    </td>
                    <td className="text-sm">{t.use}</td>
                    <td className="text-sm">{t.input}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-sm text-muted-foreground">
              * required. Answers about a study carry a <code className="code-inline">rev</code>; send it back as{" "}
              <code className="code-inline">known_rev</code> to get <code className="code-inline">{"{unchanged: true}"}</code>. A{" "}
              <code className="code-inline">search_cells</code> filter takes ids or labels: flat{" "}
              <code className="code-inline">{`{"cell_type": "T cell", "sex": "female", "tissue": ["lung"], "not": {"disease": "cancer"}}`}</code> (fields
              AND-ed, list values OR-ed) or a tree of <code className="code-inline">and</code> / <code className="code-inline">or</code> /{" "}
              <code className="code-inline">not</code>. The full field list is in the tool's own description and in the{" "}
              <a href={MD_URL}>markdown version</a>.
            </p>
          </Section>

          <Section id="limits" title="4. Limits and costs">
            <ul>
              <li>
                singlet.bio does not charge for tool calls. Calls are counted per account and limited to 60 MCP calls a minute per key; there is no daily
                or monthly cap on calls.
              </li>
              <li>
                <strong>AI allowance.</strong> Only plain-English readings the built-in vocabulary cannot place call a language model (
                <code className="code-inline">search_datasets</code>, and <code className="code-inline">question</code> in{" "}
                <code className="code-inline">search_cells</code> and <code className="code-inline">get_cells_page</code>). Those count against 200 AI
                readings a day per account (reset 00:00 UTC) and a monthly AI token allowance, reported in{" "}
                <code className="code-inline">_meta.quota</code>. When either is used up the question is still answered from the vocabulary alone (
                <code className="code-inline">quota_exceeded: true</code>). Structured filters never use the allowance.
              </li>
              <li>
                <strong>Per-call caps.</strong> <code className="code-inline">find_cells</code> reads at most 25 samples and 40 reads of the data host per
                call (continue with <code className="code-inline">after</code>). <code className="code-inline">slice_cells</code> takes up to 50,000
                indices or 2,000 runs and joins chunk runs to at most <code className="code-inline">max_ranges</code> (default 64, at most 200).{" "}
                <code className="code-inline">get_cells_page</code> returns up to 10,000 cells and 10 studies a page (continue with{" "}
                <code className="code-inline">cursor</code>). <code className="code-inline">search_cells</code> lists up to 200 rows;{" "}
                <code className="code-inline">export_manifest</code> and <code className="code-inline">save_cohort</code> take up to 2,000 studies.
              </li>
              <li>
                Downloads from <code className="code-inline">data.singlet.bio</code> need no account. The cell gather endpoint has a per-day cell allowance
                (2 M cells a day with an API key; a smaller anonymous one).
              </li>
              <li>
                Your Anthropic bill: the 19 tool definitions are written to the prompt cache on the first turn. In the pilot below (claude-opus-5-5, effort
                medium) a question cost $0.08–$0.15 with the MCP server.
              </li>
            </ul>
          </Section>

          <Section id="examples" title="5. Worked examples">
            <p>
              From real benchmark transcripts: singlet-agents <code className="code-inline">bench/agent-readiness</code>, pilot of 2026-10-28, model{" "}
              <code className="code-inline">claude-opus-5-5</code>, effort medium, the MCP connector as above with{" "}
              <code className="code-inline">save_cohort</code> disabled, plus a <code className="code-inline">run_python</code> tool with network access to{" "}
              <code className="code-inline">data.singlet.bio</code>. Tool calls and results are copied from the transcripts. All six were graded correct.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Arm</th>
                  <th>Correct</th>
                  <th>Spend</th>
                  <th>Median latency</th>
                  <th>Tool calls / question</th>
                </tr>
              </thead>
              <tbody>
                {PILOT.map((p) => (
                  <tr key={p.arm}>
                    <td>{p.arm}</td>
                    <td>{p.correct}</td>
                    <td>{p.spend}</td>
                    <td>{p.latency}</td>
                    <td>{p.calls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {EXAMPLES.map((e) => (
              <Example key={e.id} e={e} />
            ))}

            <h3 id="showcase" className="scroll-mt-20">
              More examples: showcase panel
            </h3>
            {SHOWCASE.length ? (
              SHOWCASE.map((e) => <Example key={e.id} e={e} />)
            ) : (
              <p className="text-sm text-muted-foreground">To be added from the 10-question showcase panel. Not yet published.</p>
            )}
          </Section>

          <Section id="pitfalls" title="6. Pitfalls">
            <ol>
              <li>
                <strong>
                  The cell tools' details are in <code className="code-inline">structuredContent</code>; Claude through the API connector sees only the
                  text.
                </strong>{" "}
                Today (2026-10-28) a text-only client sees one summary line from <code className="code-inline">search_cells</code>,{" "}
                <code className="code-inline">find_cells</code>, <code className="code-inline">slice_cells</code> and{" "}
                <code className="code-inline">get_cells_page</code>, such as "14,435 cells in 15 samples of 3 studies. Most: …". The per-sample lists, facet
                breakdowns, matched descendant terms, column runs and byte ranges are in <code className="code-inline">structuredContent</code>, which the
                connector does not pass on. In example 5 the agent called <code className="code-inline">search_cells</code> three times looking for the
                sample list. A server fix is pending (not deployed): every tool will also send its structured result as compact JSON text, and{" "}
                <code className="code-inline">search_cells</code> / <code className="code-inline">get_cells_page</code> will render full readable text.
                Until then: give the agent a
                Python tool and <code className="code-inline">GET|POST https://singlet.bio/api/cells</code> (same <code className="code-inline">where</code>,{" "}
                <code className="code-inline">limit</code>, <code className="code-inline">offset</code>; full JSON, no key needed), or use{" "}
                <code className="code-inline">find_cells</code> per study, or <code className="code-inline">get_cells_page</code>.
              </li>
              <li>
                <strong>Catalog metadata has gaps, and they look like wrong answers.</strong> In the pilot, five healthy-donor liver studies (GSE286615,
                GSE286728, GSE286734, GSE286744, GSE286853) are served but have no tissue group, so <code className="code-inline">find_matched_controls</code>{" "}
                does not offer them; and GSM5608037, a lung-cancer tumour sample whose metadata never says "lung", is outside an ontology lung cohort. A
                missing label is not a negative, and "no disease label" does not mean healthy (example 3).
              </li>
              <li>
                <strong>Cell-type labels below lineage level are previews.</strong> Per-study accuracy: compartment 0.84, lineage 0.75, cell type 0.43,
                subtype 0.32. Lineage counts (T cell, B cell, myeloid) are solid; finer counts are estimates. Prefer the broadest CL term that answers the
                question; ontology filters include descendants.
              </li>
              <li>
                <strong>The file is the truth.</strong> Catalog cell counts can differ from a file's own QC; <code className="code-inline">get_sample_qc</code>{" "}
                reads the file.
              </li>
              <li>
                <strong>Low-QC samples are left out by default.</strong> Pass <code className="code-inline">include_low_qc: true</code> only if you mean it.
              </li>
              <li>
                <strong>Check modalities.</strong> Genotypes, mitochondrial allele data, ambient-RNA and doublet calls are not offered. Call{" "}
                <code className="code-inline">get_modalities</code> before promising one.
              </li>
            </ol>
          </Section>

          <Section id="support" title="Support">
            <p>
              <a href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer">
                GitHub Issues
              </a>{" "}
              for wrong answers, connector problems or requests; include the tool name and its arguments. Data CC0, code MIT. Cite the original GEO study
              and "Singlet Research Alpha (October 2026)".
            </p>
          </Section>
        </article>
      </main>
      <Footer />
    </div>
  );
}

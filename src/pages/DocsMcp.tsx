import { Link } from "react-router-dom";
import { Logo } from "@/components/Logo";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { CodeBlock } from "@/components/CodeBlock";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageMeta } from "@/hooks/usePageMeta";
import { GITHUB_ISSUES } from "@/lib/install-snippets";
import {
  MCP_URL,
  claudeCodeConfig,
  claudeCodeConfigNoKey,
  cursorConfig,
  vscodeConfig,
} from "@/lib/mcp-snippets";

const KEY = "sk_live_…";

const EXAMPLES: { ask: string; tools: string; gets: string }[] = [
  {
    ask: "Find mouse brain studies with at least 20,000 cells.",
    tools: "search_datasets",
    gets: "A ranked list of studies with a one-line reason each and the loader command.",
  },
  {
    ask: "Is GSE296768 usable for an RNA velocity analysis?",
    tools: "assess_study",
    gets: "What is in the file, sample counts, QC, missing metadata and a yes/no on intron-aware layers.",
  },
  {
    ask: "What does the QC look like for GSE200901?",
    tools: "get_sample_qc",
    gets: "Per-sample cells, UMI, genes, mapping and mito for the approved samples.",
  },
  {
    ask: "What files are inside GSE296768, and how big are they?",
    tools: "list_bundle_files",
    gets: "Every per-sample and study-level file with its size.",
  },
  {
    ask: "Does GSE296768 have splice junctions? How do I read them in R?",
    tools: "get_modalities",
    gets: "Every layer in the file, such as splicing and immune receptor genes, with the Python and R line that reads each one.",
  },
  {
    ask: "Get me just GSM8976273's counts matrix from GSE296768 — I don't want the whole 1.5 GB study.",
    tools: "get_partial_download",
    gets: "A byte range, a curl command and a Python snippet that fetch that one file (count matrices need no inflate step).",
  },
  {
    ask: "Which cells in GSE296768 have more than 5,000 UMIs? Give me just their counts.",
    tools: "find_cells, slice_cells",
    gets: "Studies stored per sample only: the matching cells as column runs per sample, then the byte ranges that cover just those cells' matrix chunks.",
  },
  {
    ask: "What are rows 10, 11 and 12 of that matrix?",
    tools: "resolve_features",
    gets: "Studies stored per sample only: the feature names for row numbers, from the reference pack the matrix names.",
  },
  {
    ask: "Find healthy control studies that match GSE200901.",
    tools: "find_matched_controls",
    gets: "Candidate studies with the reason they match, plus honest caveats about study-level labels.",
  },
  {
    ask: "Compare GSE296768 and GSE200901 — what would confound merging them?",
    tools: "compare_studies",
    gets: "A side-by-side table and an explicit list of the fields where they disagree.",
  },
  {
    ask: "Give me a curl script that downloads every human PBMC study in the atlas.",
    tools: "export_manifest",
    gets: "A ready-to-run script (or TSV/JSON/Python/R), the study count and the total download size.",
  },
];

const TOOLS: { name: string; input: string; returns: string; note?: string }[] = [
  { name: "search_datasets", input: "query, interpret?, level?, limit?, page?, organism?, tissue?, disease?, assay?, min_cells?, cell_type_label?, sex_genetic?, ancestry_genetic?, include_unbuilt?, include_low_qc?, include_unclassified?", returns: "Matching studies or samples with a reason for each match. The only tool that can call a language model, and only when the built-in vocabulary cannot read the question", note: "Fresh AI readings are metered (see Limits)" },
  { name: "get_study", input: "gse_id, known_rev?", returns: "Title, abstract, groups, conditions, samples (first 60), file URL, and a rev" },
  { name: "get_download_url", input: "gse_id, include_samples?, limit?, after?, modalities?", returns: "The study's .s1 manifest URL, size and loader lines, and optionally its sample objects" },
  { name: "get_atlas_stats", input: "—", returns: "Studies, usable samples and cells in published files (the site's headline numbers), plus catalog metadata: samples processed, cells recorded, species, failure reasons" },
  { name: "get_sample_qc", input: "gse_id, gsm_ids?, known_rev?", returns: "Per-sample QC from the file itself, totals and warnings" },
  { name: "list_bundle_files", input: "gse_id, gsm_id?, detail?, limit?, after?, modalities?, known_rev?", returns: "Everything inside the file, with sizes; for a study stored per sample, a grouped summary and one sample's files with their byte ranges" },
  { name: "get_modalities", input: "gse_id, gsm_id?, modalities?, known_rev?", returns: "Which modalities the file carries, with Python and R readers for each" },
  { name: "get_partial_download", input: "gse_id, gsm_id, file, modalities?, known_rev?", returns: "Byte range, curl and Python for one file; for a study stored per sample, the member's range inside the sample's immutable object" },
  { name: "export_manifest", input: "query? / filters? / gse_ids?, include_low_qc?, format", returns: "TSV, JSON, curl, wget, Python or R manifest" },
  { name: "find_matched_controls", input: "gse_id, min_samples?, same_assay?, tissue?, include_unclassified?", returns: "Candidate control studies with reasons and caveats" },
  { name: "compare_studies", input: "gse_ids (2–8)", returns: "Side-by-side fields and their differences" },
  { name: "assess_study", input: "gse_id, purpose?", returns: "Deterministic usability report and fit checks" },
  { name: "get_cohort", input: "id, token?", returns: "A saved, version-pinned cohort and its studies", note: "Private and workspace cohorts need access from your account; a share-link token (sco_…) opens a link cohort" },
  { name: "save_cohort", input: "name, gse_ids, notes?, visibility?, workspace_id?", returns: "Saves up to 2,000 studies as a cohort pinned to the current catalogue", note: "Saved to your account" },
  { name: "find_cells", input: "gse_ids? / gsm_ids? / sample_filter?, cell_filter?, cell_labels?, limit_samples?, max_runs_per_sample?, after?", returns: "Per sample, the cells matching a filter on called status, UMIs, features, labels or any numeric cells-table column, as column runs. Reads at most 25 samples a call" },
  { name: "slice_cells", input: "gse_id, gsm_id, file?, runs? / indices? / range?, max_ranges?, modalities?", returns: "The byte ranges that cover just those cells in a sample's count matrices (a prefix once, then chunk runs)" },
  { name: "resolve_features", input: "indices, pack? / gse_id, gsm_id, file?", returns: "Feature names for matrix row numbers (or barcodes for whitelist column numbers)" },
  { name: "search_cells", input: "where? / question?, include_low_qc?, limit?, offset?", returns: "Counts and locates cells across the whole atlas by cell type, sex, ancestry, tissue, disease, stage, assay and more; ontology terms match their descendants", note: "A plain-English question uses the built-in vocabulary only" },
  { name: "get_cells_page", input: "where? / question?, include_low_qc?, page_cells?, cursor?, modalities?", returns: "One page (up to 10,000 cells) of the cells a search_cells filter matches, with the byte ranges of their matrix chunks; singlet.s1.atlas.gather(page[\"cells\"]) turns it into AnnData" },
  { name: "list_cell_fields", input: "fields?", returns: "Every field search_cells accepts, with its ontology, coverage and most common values" },
];

function Section({ id, title, children, collapsible }: { id: string; title: string; children: React.ReactNode; collapsible?: boolean }) {
  if (collapsible) {
    return (
      <details id={id} className="pb-6 mb-6 border-b border-border scroll-mt-20">
        <summary className="cursor-pointer text-[20px] font-semibold">{title}</summary>
        <div className="mt-4">{children}</div>
      </details>
    );
  }
  return (
    <section id={id} className="pb-12 mb-12 border-b border-border scroll-mt-20">
      <h2 className="mb-4">{title}</h2>
      {children}
    </section>
  );
}

export default function DocsMcp() {
  usePageMeta({
    title: "Use singlet from Claude, Cursor or ChatGPT",
    description:
      "Connect an AI assistant to the singlet.bio atlas: search public single-cell studies, read their QC, download one sample by byte range and export a cohort manifest — tool calls need a free account; downloads need none.",
    path: "/docs/mcp",
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
            / MCP
          </p>
          <Logo variant="mark" height={28} link={false} className="docs-brand-mark mb-4" />
          <h1 className="text-[36px] md:text-[42px] mb-3">Ask your AI assistant for single-cell data</h1>
          <p className="text-lg text-muted-foreground">
            Connect singlet.bio to Claude, Cursor, ChatGPT or VS Code. It searches the atlas, checks QC and writes the loading code.
          </p>
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">Contact:</strong>{" "}
            <a href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer">
              GitHub Issues
            </a>{" "}
            for support, bugs and questions about the connector · <Link to="/privacy">Privacy policy</Link>
          </p>

          <Section id="ask" title="What you can ask">
            <table>
              <thead>
                <tr>
                  <th>Ask</th>
                  <th>Tool</th>
                  <th>You get back</th>
                </tr>
              </thead>
              <tbody>
                {EXAMPLES.map((e) => (
                  <tr key={e.ask}>
                    <td>{e.ask}</td>
                    <td>
                      <code className="code-inline">{e.tools}</code>
                    </td>
                    <td>{e.gets}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-sm text-muted-foreground">
              The server also ships three guided workflows your assistant can pick up as prompts:{" "}
              <code className="code-inline">assemble_cohort</code>, <code className="code-inline">qc_review</code> and{" "}
              <code className="code-inline">load_and_summarise</code>.
            </p>
          </Section>

          <Section id="setup" title="Set it up">
            <p>
              Hosted at <code className="code-inline">{MCP_URL}</code>. Tools need a free singlet.bio account: add the URL to your
              client and sign in with GitHub or Google when it asks. Clients that only take a header can send a personal API key from{" "}
              <Link to="/account">your account</Link> instead. Without either, <code className="code-inline">initialize</code> and every{" "}
              <code className="code-inline">tools/call</code> answer HTTP 401 with <code className="code-inline">sign_in_required</code>, which is
              what makes a client start sign-in; <code className="code-inline">tools/list</code> and <code className="code-inline">ping</code> stay
              open. Downloads from <code className="code-inline">data.singlet.bio</code> never need an account.
            </p>
            <Tabs defaultValue="claude">
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="claude">Claude</TabsTrigger>
                <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
                <TabsTrigger value="cursor">Cursor</TabsTrigger>
                <TabsTrigger value="chatgpt">ChatGPT</TabsTrigger>
                <TabsTrigger value="vscode">VS Code</TabsTrigger>
              </TabsList>
              <TabsContent value="claude" className="mt-4">
                <p className="text-sm text-muted-foreground">
                  Claude on the web, Desktop or mobile: Settings → Connectors → Add custom connector, paste the URL, then Connect and sign in
                  to singlet.bio with GitHub or Google. No key to copy; disconnect any time from <Link to="/account#connectors">your account</Link>.
                </p>
                <CodeBlock label="connector url" code={MCP_URL} />
              </TabsContent>
              <TabsContent value="claude-code" className="mt-4">
                <p className="text-sm text-muted-foreground">
                  Add the server, then run <code className="code-inline">/mcp</code> in Claude Code and choose singlet to sign in.
                </p>
                <CodeBlock label="terminal" code={claudeCodeConfigNoKey} />
                <p className="text-sm text-muted-foreground">Or, for scripts and CI, with an API key:</p>
                <CodeBlock label="terminal" code={claudeCodeConfig(KEY)} />
              </TabsContent>
              <TabsContent value="cursor" className="mt-4">
                <p className="text-sm text-muted-foreground">
                  <code className="code-inline">.cursor/mcp.json</code> in your project, or <code className="code-inline">~/.cursor/mcp.json</code>.
                </p>
                <CodeBlock label=".cursor/mcp.json" code={cursorConfig(KEY)} />
              </TabsContent>
              <TabsContent value="chatgpt" className="mt-4">
                <p className="text-sm text-muted-foreground">
                  Developer mode → Settings → Connectors → Create (HTTP), authentication OAuth, then sign in. Or add{" "}
                  <code className="code-inline">Authorization: Bearer {KEY}</code>.
                </p>
                <CodeBlock label="connector url" code={MCP_URL} />
              </TabsContent>
              <TabsContent value="vscode" className="mt-4">
                <CodeBlock label=".vscode/mcp.json" code={vscodeConfig(KEY)} />
              </TabsContent>
            </Tabs>

            <h3 className="mt-8">Check it is reachable</h3>
            <p className="text-sm text-muted-foreground">Listing the tools needs no sign-in; calling one does.</p>
            <CodeBlock
              label="bash"
              code={`curl -sX POST ${MCP_URL} -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 400`}
            />
          </Section>

          <Section id="tools" title="Tool reference">
            <table>
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Input</th>
                  <th>Returns</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {TOOLS.map((t) => (
                  <tr key={t.name}>
                    <td>
                      <code className="code-inline">{t.name}</code>
                    </td>
                    <td className="text-sm">{t.input}</td>
                    <td className="text-sm">{t.returns}</td>
                    <td className="text-sm">{t.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-sm text-muted-foreground">
              Every tool needs sign-in or a personal API key. Every tool also returns the machine-readable version of its answer, so an assistant can act on the numbers
              rather than re-typing them.
            </p>
          </Section>

          <Section id="limits" title="Limits" collapsible>
            <ul>
              <li>
                Tool calls are counted per account and month, and limited to 60 a minute per account. There is no cap on
                the number of calls in a day or a month.
              </li>
              <li>
                Only <code className="code-inline">search_datasets</code> calls a language model, to turn your question
                into filters when the built-in vocabulary cannot. Vocabulary-only and repeated questions cost nothing. A
                fresh AI reading counts against two limits: 200 AI readings a day per account (reset at 00:00 UTC) and a
                monthly AI token allowance (renewed on the first of the month, UTC). What is left of the monthly allowance
                comes back with every tool result in <code className="code-inline">_meta.quota</code> (
                <code className="code-inline">used</code>, <code className="code-inline">limit</code>,{" "}
                <code className="code-inline">remaining</code>, <code className="code-inline">resets_at</code>). When either
                limit is reached the question is still answered, read with the built-in vocabulary only, and the answer says
                so (<code className="code-inline">quota_exceeded: true</code>).
              </li>
              <li>
                Every number, every match reason and every caveat is computed from the catalog or read out of the study's
                own file — quote them, don't paraphrase them.
              </li>
              <li>
                Cell counts in the catalog come from the processing database; the counts in the file's QC come from the
                file. Where they differ, the file is the truth, and the tools say so.
              </li>
              <li>
                Input is capped at 30,000,000 reads per sample (most samples hit it), so absolute read counts are not
                comparable to the raw FASTQs. <code className="code-inline">get_sample_qc</code> and{" "}
                <code className="code-inline">assess_study</code> report the cap when it applies.
              </li>
              <li>
                Disease and tissue labels are study-level, taken from GEO text. Matched controls are candidates to check,
                not drop-in replacements.
              </li>
              <li>Data is CC0 and downloads from <code className="code-inline">data.singlet.bio</code> never need a key or an account.</li>
            </ul>
          </Section>

          <Section id="troubleshooting" title="If something goes wrong" collapsible>
            <ul>
              <li>
                <strong>"Unknown API key", or a key that "was revoked" or "has expired"</strong> — the whole request is
                refused (HTTP 401) while a bad key is sent. Create a new key in <Link to="/account">your account</Link>.
              </li>
              <li>
                <strong>Claude shows Connect, or asks you to sign in again</strong> — the server answers HTTP 401 to a client
                with no valid sign-in. Connect and sign in; a connection disconnected from{" "}
                <Link to="/account#connectors">your account</Link> needs a new sign-in.
              </li>
              <li>
                <strong>The AI reading is used up for today or this month</strong> — the search still answers, read with the
                built-in vocabulary only. The daily count resets at 00:00 UTC; the monthly allowance renews on the date in{" "}
                <code className="code-inline">_meta.quota.resets_at</code>.
              </li>
              <li>
                <strong>A first call on a very large study is slow</strong> — the file's directory is read over the
                network and then remembered. Ask again and it is fast.
              </li>
              <li>
                <strong>Claude Desktop shows no tools</strong> — check the JSON parses, that{" "}
                <code className="code-inline">npx</code> is on your PATH, and restart the app completely.
              </li>
            </ul>
            <p>
              Still stuck? Open an issue on GitHub (see <a href="#support">Support</a> below), or read the rest of the{" "}
              <Link to="/docs">documentation</Link>.
            </p>
          </Section>

          <Section id="support" title="Support">
            <p>
              <strong>Contact:</strong>{" "}
              <a href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer">
                GitHub Issues
              </a>{" "}
              (<code className="code-inline">{GITHUB_ISSUES.replace(/^https:\/\//, "")}</code>). Use it for connector
              problems, wrong answers from a tool, a study that looks wrong, or feature requests; include the tool name
              and its arguments if you can. The connector is maintained by Singlet Bio, and what it stores is described in
              the <Link to="/privacy">privacy policy</Link>.
            </p>
          </Section>
        </article>
      </main>
      <Footer />
    </div>
  );
}

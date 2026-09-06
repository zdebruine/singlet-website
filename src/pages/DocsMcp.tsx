import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { CodeBlock } from "@/components/CodeBlock";
import { usePageMeta } from "@/hooks/usePageMeta";
import {
  MCP_URL,
  claudeCodeConfig,
  claudeCodeConfigNoKey,
  claudeDesktopConfig,
  claudeDesktopConfigNoKey,
  cursorConfig,
  cursorConfigNoKey,
  vscodeConfig,
} from "@/lib/mcp-snippets";

const KEY = "sk_live_…";

const EXAMPLES: { ask: string; tools: string; gets: string }[] = [
  {
    ask: "Find mouse brain studies with at least 20,000 cells that are already packed.",
    tools: "search_datasets",
    gets: "A ranked list of studies with a one-line reason each and the loader command.",
  },
  {
    ask: "Is GSE296768 usable for an RNA velocity analysis?",
    tools: "assess_study",
    gets: "What is in the file, sample counts, QC, missing metadata and a yes/no on intron-aware layers.",
  },
  {
    ask: "How good is the QC on GSE200901? Any samples I should drop?",
    tools: "get_sample_qc",
    gets: "Per-sample cells, UMI, genes, mapping and mito, plus samples flagged below 500 cells or 60% mapping.",
  },
  {
    ask: "What files are inside GSE296768, and how big are they?",
    tools: "list_bundle_files",
    gets: "Every per-sample and study-level file with its size.",
  },
  {
    ask: "Get me just GSM8976273's counts matrix — I don't want the whole 9 GB study.",
    tools: "get_partial_download",
    gets: "A byte range, a curl command and a Python snippet that fetches and inflates that one file.",
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

const TOOLS: { name: string; input: string; returns: string; metered: string }[] = [
  { name: "search_datasets", input: "query, level, filters, limit", returns: "Matching studies or samples with a reason for each match", metered: "Yes — AI search budget" },
  { name: "get_study", input: "gse_id", returns: "Title, abstract, groups, conditions, samples, file URL", metered: "No" },
  { name: "get_download_url", input: "gse_id", returns: "The .singlet URL, size and loader lines", metered: "No" },
  { name: "get_atlas_stats", input: "—", returns: "Live studies, samples, cells, species", metered: "No" },
  { name: "get_sample_qc", input: "gse_id, gsm_ids?", returns: "Per-sample QC from the file itself, totals and warnings", metered: "No" },
  { name: "list_bundle_files", input: "gse_id, gsm_id?", returns: "Everything inside the file, with sizes", metered: "No" },
  { name: "get_partial_download", input: "gse_id, gsm_id, file", returns: "Byte range, curl and Python for one file", metered: "No" },
  { name: "export_manifest", input: "query / filters / gse_ids, format", returns: "TSV, JSON, curl, wget, Python or R manifest", metered: "No" },
  { name: "find_matched_controls", input: "gse_id, min_samples?, same_assay?", returns: "Candidate control studies with reasons and caveats", metered: "No — but needs a key" },
  { name: "compare_studies", input: "gse_ids (2–8)", returns: "Side-by-side fields and their differences", metered: "No" },
  { name: "assess_study", input: "gse_id, purpose?", returns: "Deterministic usability report and fit checks", metered: "No — but needs a key" },
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
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
      "Connect an AI assistant to the singlet.bio atlas: search public single-cell studies, read their QC, download one sample by byte range and export a cohort manifest — no account needed to start.",
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
          <h1 className="text-[36px] md:text-[42px] mb-3">Use singlet from Claude, Cursor or ChatGPT</h1>
          <p className="text-lg text-muted-foreground">
            Finding the right public single-cell study, checking whether its samples are any good, and getting the counts
            onto your machine used to be an afternoon of GEO clicking, GEOquery calls and FASTQ processing. Connected to
            singlet.bio, it is one conversation: your assistant searches the atlas, reads the per-sample QC out of the
            file itself, picks matched controls and hands you a download command — for a whole study, or for the single
            sample you actually need.
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
              The server is hosted at <code className="code-inline">{MCP_URL}</code> — nothing to install and nothing to
              run locally. <strong>Start without a key:</strong> every tool except two works straight away, and
              AI-interpreted search runs at 10 questions a day. A free key from{" "}
              <Link to="/account">your account</Link> raises search to 200 a day and unlocks{" "}
              <code className="code-inline">assess_study</code> and <code className="code-inline">find_matched_controls</code>.
            </p>

            <h3>Claude Desktop</h3>
            <p className="text-sm text-muted-foreground">
              Settings → Developer → Edit Config, then restart Claude.
            </p>
            <div className="grid md:grid-cols-2 gap-3">
              <CodeBlock label="no key" code={claudeDesktopConfigNoKey} />
              <CodeBlock label="with a key" code={claudeDesktopConfig(KEY)} />
            </div>

            <h3 className="mt-8">Claude Code</h3>
            <div className="grid md:grid-cols-2 gap-3">
              <CodeBlock label="no key" code={claudeCodeConfigNoKey} />
              <CodeBlock label="with a key" code={claudeCodeConfig(KEY)} />
            </div>

            <h3 className="mt-8">Cursor</h3>
            <p className="text-sm text-muted-foreground">
              Put this in <code className="code-inline">.cursor/mcp.json</code> in your project, or in{" "}
              <code className="code-inline">~/.cursor/mcp.json</code> for every project.
            </p>
            <div className="grid md:grid-cols-2 gap-3">
              <CodeBlock label="no key" code={cursorConfigNoKey} />
              <CodeBlock label="with a key" code={cursorConfig(KEY)} />
            </div>

            <h3 className="mt-8">ChatGPT</h3>
            <p className="text-sm text-muted-foreground">
              Enable developer mode, then Settings → Connectors → Create, and add the URL below as a custom connector
              (transport: HTTP/streamable). Add <code className="code-inline">Authorization: Bearer {KEY}</code> as a
              header if you have a key.
            </p>
            <CodeBlock label="connector url" code={MCP_URL} />

            <h3 className="mt-8">VS Code</h3>
            <p className="text-sm text-muted-foreground">
              Add it to <code className="code-inline">.vscode/mcp.json</code>.
            </p>
            <CodeBlock label=".vscode/mcp.json" code={vscodeConfig(KEY)} />

            <h3 className="mt-8">Check it works</h3>
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
                  <th>Counts against your budget?</th>
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
                    <td className="text-sm">{t.metered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-sm text-muted-foreground">
              Every tool also returns the machine-readable version of its answer, so an assistant can act on the numbers
              rather than re-typing them.
            </p>
          </Section>

          <Section id="limits" title="Limits, and being honest about them">
            <ul>
              <li>
                AI-interpreted search: 10 a day without a key, 200 a day with one. The remaining budget comes back with
                every answer. When it runs out you still get a plain keyword search, clearly labelled.
              </li>
              <li>
                No tool calls a language model. Every number, every match reason and every caveat is computed from the
                catalog or read out of the study's own file — quote them, don't paraphrase them.
              </li>
              <li>
                Cell counts in the catalog come from the processing database; the counts in the file's QC come from the
                file. Where they differ, the file is the truth, and the tools say so.
              </li>
              <li>
                Reads are capped per sample during processing, so absolute read counts are not comparable to the raw
                FASTQs. <code className="code-inline">assess_study</code> reports the cap when it applies.
              </li>
              <li>
                Disease and tissue labels are study-level, taken from GEO text. Matched controls are candidates to check,
                not drop-in replacements.
              </li>
              <li>Data is CC0 and downloads never need a key or an account.</li>
            </ul>
          </Section>

          <Section id="troubleshooting" title="If something goes wrong">
            <ul>
              <li>
                <strong>401 / "invalid key"</strong> — the key was typed wrong, expired or revoked. Remove the header to
                fall back to anonymous access, or create a new key in <Link to="/account">your account</Link>.
              </li>
              <li>
                <strong>"needs a personal API key"</strong> — you called{" "}
                <code className="code-inline">assess_study</code> or <code className="code-inline">find_matched_controls</code>{" "}
                without one. Everything else works anonymously.
              </li>
              <li>
                <strong>429, or "today's budget is used up"</strong> — the daily search allowance. Wait for the reset time
                in the answer, add a key, or ask for a keyword search.
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
              Still stuck? Open an issue on GitHub, or read the rest of the <Link to="/docs">documentation</Link>.
            </p>
          </Section>
        </article>
      </main>
      <Footer />
    </div>
  );
}

import { Link } from "react-router-dom";
import { Logo } from "@/components/Logo";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { CodeBlock } from "@/components/CodeBlock";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PY_INSTALL, R_INSTALL_STANDALONE, GITHUB_ISSUES } from "@/lib/install-snippets";
import {
  MCP_URL,
  claudeCodeConfig,
  claudeDesktopConfig,
  cursorConfig,
  vscodeConfig,
} from "@/lib/mcp-snippets";

const KEY_PLACEHOLDER = "sk_live_…";
const GSE = "GSE178957";

const Mono = ({ children }: { children: React.ReactNode }) => <code className="code-inline">{children}</code>;

/** A numbered step inside a tab. */
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 mb-7">
      <span className="flex items-center justify-center w-7 h-7 shrink-0 rounded bg-primary text-white text-[13px] font-semibold">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="!mt-0 !mb-2">{title}</h3>
        {children}
      </div>
    </div>
  );
}

/** One row of the "beyond gene counts" table. */
const MODALITIES: { what: string; name: string; note: string }[] = [
  { what: "Combined raw counts (exon + intron)", name: "raw_counts()", note: "X is the sum; spliced and unspliced kept as layers." },
  { what: "Per-feature exon / intron matrices", name: "exon_counts, intron_counts", note: "The native axis, before features are merged onto genes." },
  { what: "Splice junctions", name: "junctions", note: "Per-cell counts per junction." },
  { what: "Percent-spliced-in", name: "splice_psi", note: "Per-cell PSI per splice event; splice_events annotates the rows." },
  { what: "mtDNA heteroplasmy", name: "mt_heteroplasmy", note: "Per-cell VAF at each chrM variant site." },
  { what: "mtDNA variant calls", name: "mt_variants", note: "Depth, allele counts and annotation per chrM variant." },
  { what: "Donor demultiplexing", name: "donor_assignments", note: "Genotype-free: barcode to donor, with doublet calls." },
  { what: "Donor SNP depths", name: "donor_snp_ad, donor_snp_dp", note: "Alt-allele and total depth over the SNP panel." },
  { what: "Allele-specific expression", name: "ase_counts", note: "Per-gene allelic counts." },
  { what: "Genetic sex and ancestry", name: "sex_call, ancestry_call", note: "Derived from the SNP panel and chrX/chrY coverage." },
  { what: "Non-host species", name: "nonhost_species", note: "Microbial and viral abundance per taxon after EM re-assignment." },
  { what: "V(D)J segment usage", name: "vdj_gene_usage", note: "Per-cell V/D/J segment counts." },
  { what: "Doublets, cell cycle, ambient RNA", name: "doublet_scores, cell_cycle_scores, ambient_contamination", note: "Per-cell annotation tables." },
  { what: "Per-sample QC", name: "summary, pileup_stats, provenance", note: "Cells called, mapping rate, pipeline version, reference checksums." },
];

const PY_MODALITY_CODE = `import singlet

b = singlet.open_bundle("${GSE}")          # downloads and caches the .singlet
b.gsm_ids                                   # ['GSM...', ...]
b.modalities()                              # {'exon_counts': '...', 'junctions': '...', ...}

gsm = b.gsm_ids[0]

# --- the conventional combined counts matrix ---------------------------
adata = b.raw_counts(gsm)                   # cells x genes, exon + intron
adata.layers["spliced"]                     # exonic half
adata.layers["unspliced"]                   # intronic half

# keep the native per-feature axis instead of merging onto genes
feat = b.raw_counts(gsm, gene_level=False)
feat.var["feature_kind"]                    # 'exon' or 'intron' per row
feat.var["gene_id"]                         # which gene each feature belongs to

# every barcode, including empty droplets (a raw_feature_bc_matrix)
raw = b.raw_counts(gsm, gene_level=False, cells="all")

# --- everything else ---------------------------------------------------
b.mt_variants(gsm)                          # cells x chrM sites (heteroplasmy)
b.read("mt_variants", gsm)                  # called chrM variants, as a DataFrame
b.donors(gsm)                               # barcode -> donor, with doublet calls
b.nonhost(gsm)                              # microbial / viral abundance per taxon
b.junctions(gsm)                            # cells x splice junctions
b.splice_psi(gsm)                           # cells x splice events (PSI)
b.vdj(gsm)                                  # cells x V(D)J segments
b.read("doublet_scores", gsm)               # per-cell doublet score and call
b.qc(gsm)                                   # the sample's summary.json`;

const R_MODALITY_CODE = `library(singlet)

path <- download("${GSE}")             # local .singlet path
singlet_modalities(path)                # named vector: modality -> description
gsm <- "GSM5399457"

# --- the conventional combined counts matrix ---------------------------
sce <- singlet_raw_counts(path, gsm)
assayNames(sce)                         # counts, spliced, unspliced

# keep the native per-feature axis instead of merging onto genes
feat <- singlet_raw_counts(path, gsm, gene_level = FALSE)
table(rowData(feat)$feature_kind)       # exon / intron
rowData(feat)$gene_id

# every barcode, including empty droplets
raw <- singlet_raw_counts(path, gsm, gene_level = FALSE, cells = "all")

# --- everything else ---------------------------------------------------
singlet_read(path, gsm, "mt_heteroplasmy")   # dgCMatrix, features x cells
singlet_read(path, gsm, "mt_variants")       # data.frame
singlet_read(path, gsm, "donor_assignments")
singlet_read(path, gsm, "nonhost_species")
singlet_read(path, gsm, "junctions")
singlet_read(path, gsm, "splice_psi")
singlet_read(path, gsm, "vdj_gene_usage")
singlet_read(path, gsm, "doublet_scores")
singlet_read(path, gsm, "summary")           # list`;

const CLAUDE_PROMPTS = [
  { ask: "Find me human PBMC studies in COVID-19 with at least 20,000 cells.", tool: "search_datasets" },
  { ask: `Is ${GSE} usable for RNA velocity? What is the QC like?`, tool: "assess_study, get_sample_qc" },
  { ask: `What is inside ${GSE} besides gene counts — does it have mtDNA variants or donor assignments?`, tool: "get_modalities" },
  { ask: `Give me the R code to pull donor assignments and non-host species out of ${GSE}.`, tool: "get_modalities" },
  { ask: "I only want one sample's counts matrix, not the whole 9 GB study.", tool: "get_partial_download" },
  { ask: "Write me a curl script that downloads every mouse brain study in the atlas.", tool: "export_manifest" },
];

const Quickstart = () => {
  usePageMeta({
    title: "Getting started",
    description:
      "Step-by-step guides for the singlet Python package, the R package and the MCP server for Claude, Cursor and VS Code — including raw counts matrices, mtDNA variants, donor demultiplexing, non-host species and every other modality.",
    path: "/quickstart",
  });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="container-site flex-1 py-10 md:py-14">
        <article className="prose-doc max-w-[820px]">
          <header className="mb-10">
            <Logo variant="mark" height={28} link={false} className="docs-brand-mark mb-4" />
            <h1 className="text-[36px] md:text-[42px] mb-3">Getting started</h1>
            <p className="text-[17px] text-muted-foreground">
              Pick how you want to work. No account is needed to browse, download or load anything.
            </p>
          </header>

          {/* ── The install paths ── */}
          <section id="install" className="pb-12 mb-12 border-b border-border scroll-mt-20">
            <Tabs defaultValue="python">
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="python">Python</TabsTrigger>
                <TabsTrigger value="r">R</TabsTrigger>
                <TabsTrigger value="claude">Claude</TabsTrigger>
                <TabsTrigger value="cursor">Cursor</TabsTrigger>
                <TabsTrigger value="vscode">VS Code</TabsTrigger>
              </TabsList>

              {/* ── Python ── */}
              <TabsContent value="python" className="mt-7">
                <Step n={1} title="Install">
                  <p>Python 3.9 or newer.</p>
                  <CodeBlock label="bash" code={PY_INSTALL} />
                </Step>

                <Step n={2} title="Find a study">
                  <p>
                    Describe what you need — a tissue, disease, cell type, organism, or a GEO accession. The same query
                    works in the site search bar.
                  </p>
                  <CodeBlock
                    label="python"
                    code={`import singlet

accs = singlet.find("microglia in the aging mouse brain")
print(accs)                    # ['GSE...', ...]`}
                  />
                  <p className="text-sm text-muted-foreground">
                    <Mono>find</Mono> returns GSE accessions. <Mono>find_load(...)</Mono> loads the matches in one call.
                  </p>
                </Step>

                <Step n={3} title="Load a study">
                  <p>One AnnData for the whole study: gene counts, with spliced and unspliced layers.</p>
                  <CodeBlock
                    label="python"
                    code={`adata = singlet.load("${GSE}")                     # AnnData, cells x genes
adata.X                                             # exon + intron counts
adata.layers["spliced"], adata.layers["unspliced"]
adata.obs[["gsm_id", "organism", "protocol"]].head()`}
                  />
                </Step>

                <Step n={4} title="Go beyond gene counts">
                  <p>
                    <Mono>load()</Mono> gives you the gene-level matrix because that is what most analyses need. Open the
                    bundle directly to reach everything else.
                  </p>
                  <CodeBlock label="python" code={PY_MODALITY_CODE} />
                </Step>
              </TabsContent>

              {/* ── R ── */}
              <TabsContent value="r" className="mt-7">
                <Step n={1} title="Install">
                  <p>R 4.2 or newer. Bioconductor is needed for SingleCellExperiment.</p>
                  <CodeBlock label="r" code={R_INSTALL_STANDALONE} />
                </Step>

                <Step n={2} title="Find a study">
                  <CodeBlock
                    label="r"
                    code={`library(singlet)

accs <- find("microglia in the aging mouse brain")
print(accs)                    # c("GSE...", ...)`}
                  />
                </Step>

                <Step n={3} title="Load a study">
                  <p>One SingleCellExperiment for the whole study, or a Seurat object.</p>
                  <CodeBlock
                    label="r"
                    code={`sce <- load("${GSE}")                  # SingleCellExperiment
assayNames(sce)                         # counts, spliced, unspliced
head(colData(sce)$gsm_id)

seu <- load("${GSE}", as = "seurat")    # Seurat instead`}
                  />
                </Step>

                <Step n={4} title="Go beyond gene counts">
                  <p>
                    Matrices come back in the Bioconductor orientation (features × cells), the transpose of what the
                    Python package returns.
                  </p>
                  <CodeBlock label="r" code={R_MODALITY_CODE} />
                </Step>
              </TabsContent>

              {/* ── Claude ── */}
              <TabsContent value="claude" className="mt-7">
                <p className="mb-6">
                  singlet runs an MCP server at <Mono>{MCP_URL}</Mono>. Connecting it lets Claude search the atlas, read
                  real QC numbers out of the files, and write the loading code for you. Everything below works without an
                  account; a free key raises the daily AI-search allowance from 10 to 200.
                </p>

                <Step n={1} title="Add the server — Claude Code">
                  <p>One command, no config file.</p>
                  <CodeBlock label="bash" code={`claude mcp add --transport http singlet ${MCP_URL}`} />
                  <p className="mt-3">With a key from your account page:</p>
                  <CodeBlock label="bash" code={claudeCodeConfig(KEY_PLACEHOLDER)} />
                  <p className="text-sm text-muted-foreground">
                    Check it with <Mono>claude mcp list</Mono> — singlet should show as connected.
                  </p>
                </Step>

                <Step n={2} title="Add the server — Claude Desktop">
                  <p>
                    Open <strong>Settings → Developer → Edit Config</strong>, paste this into{" "}
                    <Mono>claude_desktop_config.json</Mono>, and restart Claude Desktop. Desktop speaks stdio, so{" "}
                    <Mono>mcp-remote</Mono> bridges it to the HTTP server (this needs Node.js installed).
                  </p>
                  <CodeBlock label="claude_desktop_config.json" code={claudeDesktopConfig(KEY_PLACEHOLDER)} />
                  <p className="text-sm text-muted-foreground">
                    Drop the two <Mono>--header</Mono> arguments to run anonymously. After restarting, singlet appears in
                    the tools menu.
                  </p>
                </Step>

                <Step n={3} title="Ask for what you want">
                  <p>You never name the tools — Claude picks. These prompts all work:</p>
                  <ul className="!list-none !pl-0 space-y-2.5 mt-4">
                    {CLAUDE_PROMPTS.map((p) => (
                      <li key={p.ask} className="surface px-4 py-3">
                        <p className="!m-0 text-[14.5px]">“{p.ask}”</p>
                        <p className="!m-0 mt-1 text-[12px] text-muted-foreground font-mono">{p.tool}</p>
                      </li>
                    ))}
                  </ul>
                </Step>

                <Step n={4} title="Have it write the analysis code">
                  <p>
                    <Mono>get_modalities</Mono> returns the exact Python and R line that reads each modality, so Claude
                    can go straight from “does this study have donor assignments?” to runnable code.
                  </p>
                  <CodeBlock
                    label="prompt"
                    code={`Using ${GSE}, check which modalities are available, then write me Python
that loads the combined raw counts matrix with spliced/unspliced layers,
pulls the mtDNA heteroplasmy matrix, and joins the donor assignments onto
adata.obs. Tell me what is missing from this bundle.`}
                  />
                </Step>

                <p className="text-sm text-muted-foreground">
                  Full reference, including the per-tool table and troubleshooting:{" "}
                  <Link to="/docs/mcp" className="text-primary hover:underline">Use singlet from Claude, Cursor or ChatGPT</Link>.
                </p>
              </TabsContent>

              {/* ── Cursor ── */}
              <TabsContent value="cursor" className="mt-7">
                <Step n={1} title="Add the server">
                  <p>
                    Create <Mono>.cursor/mcp.json</Mono> in your project, or <Mono>~/.cursor/mcp.json</Mono> for every
                    project. Cursor speaks HTTP directly, so no bridge is needed.
                  </p>
                  <CodeBlock label=".cursor/mcp.json" code={cursorConfig(KEY_PLACEHOLDER)} />
                  <p className="text-sm text-muted-foreground">
                    Drop the <Mono>headers</Mono> block to run anonymously.
                  </p>
                </Step>
                <Step n={2} title="Enable it">
                  <p>
                    Open <strong>Settings → MCP</strong> and confirm singlet is green, then ask in the chat pane exactly
                    as you would with Claude — the tools and the prompts are identical.
                  </p>
                </Step>
                <Step n={3} title="Let it write the loader">
                  <p>
                    Because Cursor sees your codebase, this is the fastest way to wire a study into an existing analysis
                    script.
                  </p>
                  <CodeBlock
                    label="prompt"
                    code={`Find a human PBMC COVID-19 study with matched controls, check its QC,
then add a loader for it to analysis/load_data.py using the singlet package.`}
                  />
                </Step>
              </TabsContent>

              {/* ── VS Code ── */}
              <TabsContent value="vscode" className="mt-7">
                <Step n={1} title="Add the server">
                  <p>
                    Create <Mono>.vscode/mcp.json</Mono> in your workspace. GitHub Copilot picks it up in agent mode.
                  </p>
                  <CodeBlock label=".vscode/mcp.json" code={vscodeConfig(KEY_PLACEHOLDER)} />
                </Step>
                <Step n={2} title="Use it in agent mode">
                  <p>
                    Open the Chat view, switch the mode selector to <strong>Agent</strong>, and check that singlet
                    appears in the tools picker. Then ask the same questions as in the Claude tab.
                  </p>
                </Step>
              </TabsContent>
            </Tabs>
          </section>

          {/* ── Beyond gene counts ── */}
          <section id="modalities" className="pb-12 mb-12 border-b border-border scroll-mt-20">
            <h2>Beyond gene counts</h2>
            <p>
              Because every study is reprocessed from raw reads, a <Mono>.singlet</Mono> bundle carries much more than a
              count matrix. Each row below is addressable by name from Python, from R, and through the MCP server.
            </p>
            <table>
              <thead>
                <tr>
                  <th>What you want</th>
                  <th>Modality name</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {MODALITIES.map((m) => (
                  <tr key={m.name}>
                    <td>{m.what}</td>
                    <td className="font-mono text-[12.5px]">{m.name}</td>
                    <td className="text-[13.5px]">{m.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3>How features become genes</h3>
            <p>
              The pipeline counts per <em>feature</em> — individual exons and introns — not per gene. A feature id looks
              like <Mono>ENSG00000000003_TSPAN6_chrX:100627107-100629986</Mono>, where the gene is everything before the
              first underscore. A gene-level matrix is the sum of all of that gene's exon and intron features, which is
              exactly what <Mono>raw_counts(gsm)</Mono> and <Mono>singlet_raw_counts(path, gsm)</Mono> do for you. Don't
              add the exon and intron matrices together by hand: their feature axes are disjoint and have to be projected
              onto the shared gene axis first.
            </p>
            <p>
              Pass <Mono>gene_level=False</Mono> (Python) or <Mono>gene_level = FALSE</Mono> (R) to keep the native
              feature axis, with a <Mono>feature_kind</Mono> column marking each row as exonic or intronic. Pass{" "}
              <Mono>cells="all"</Mono> to keep empty droplets as well — the equivalent of a{" "}
              <Mono>raw_feature_bc_matrix</Mono>.
            </p>

            <h3>Not every bundle has everything</h3>
            <p>
              Splicing, heteroplasmy and V(D)J outputs are in every bundle. Donor demultiplexing, non-host species,
              allele-specific expression and the per-cell annotation tables were added later and only appear in newer
              bundles. Check rather than assume:
            </p>
            <div className="grid md:grid-cols-2 gap-3">
              <CodeBlock
                label="python"
                code={`b = singlet.open_bundle("${GSE}")
b.modalities()                  # what this bundle has
b.has("donor_assignments")      # True / False`}
              />
              <CodeBlock
                label="r"
                code={`path <- download("${GSE}")
singlet_modalities(path)
singlet_has(path, "donor_assignments")`}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              From an assistant, ask “what modalities does {GSE} have?” — that calls <Mono>get_modalities</Mono>, which
              returns the list plus the Python and R line for each one.
            </p>
          </section>

          {/* ── One sample at a time ── */}
          <section id="partial" className="pb-12 mb-12 border-b border-border scroll-mt-20">
            <h2>Taking one sample instead of the whole study</h2>
            <p>
              Study files run from hundreds of MB to several GB. The bundle is a ZIP64 archive served with HTTP range
              support, so a single sample's matrix can be pulled without downloading the rest.
            </p>
            <div className="grid md:grid-cols-2 gap-3">
              <CodeBlock label="python" code={`adata = singlet.load_sample("GSM5399457")`} />
              <CodeBlock
                label="r"
                code={`path <- download("${GSE}")
sce <- singlet_raw_counts(path, "GSM5399457")`}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              From an assistant, <Mono>list_bundle_files</Mono> then <Mono>get_partial_download</Mono> return the byte
              range plus a ready-to-run curl command.
            </p>
          </section>

          {/* ── Bring your own studies ── */}
          <section id="my-data" className="pb-12 mb-12 border-b border-border scroll-mt-20">
            <h2>Bring your own studies</h2>
            <p>
              Sign in, open <Link to="/my-data" className="text-primary hover:underline">Your data</Link>, and create a
              private project. Upload a <Mono>.singlet</Mono> file or register its public HTTPS URL; validated metadata
              and QC then appear under <strong>Mine</strong> in Browse.
            </p>
            <p className="text-sm text-muted-foreground">
              Included with a free account. Limits: 5 projects, 20 files per project, 2 GB per file and 10 GB stored per
              account. Save selected public studies as a versioned cohort or share work in a lab workspace.
            </p>
          </section>

          {/* ── Good to know ── */}
          <section id="good-to-know" className="pb-12 mb-12 border-b border-border scroll-mt-20">
            <h2>Good to know</h2>
            <ul>
              <li>One <Mono>.singlet</Mono> file per study. Filter on <Mono>gsm_id</Mono> after loading to work with individual samples.</li>
              <li>Files are cached locally after the first load. Set <Mono>SINGLET_CACHE_DIR</Mono> to choose where.</li>
              <li>Counts are raw. Nothing is normalised, batch-corrected or filtered beyond cell calling.</li>
              <li>Gene ids come from the reference build recorded in the bundle — see <Link to="/about#references" className="text-primary hover:underline">References</Link>.</li>
              <li>Anonymous AI search is limited to 10 questions per day. Keyword search and downloads are unlimited and need no account.</li>
              <li>All data is CC0; code is MIT.</li>
            </ul>
          </section>

          {/* ── Found a problem? ── */}
          <section id="problems" className="scroll-mt-20">
            <h2>Found a problem?</h2>
            <p>
              Open an issue on{" "}
              <a href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                GitHub Issues
              </a>
              {" "}— bug reports, missing studies, and pipeline questions are welcome.
            </p>
          </section>
        </article>
      </main>
      <Footer />
    </div>
  );
};

export default Quickstart;

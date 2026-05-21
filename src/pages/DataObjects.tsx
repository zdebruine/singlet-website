import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Link } from "react-router-dom";

const Mono = ({ children }: { children: React.ReactNode }) => (
  <code className="font-mono text-[0.85em] bg-muted/60 px-1 py-0.5 rounded">{children}</code>
);

const Code = ({ children }: { children: React.ReactNode }) => (
  <pre className="font-mono text-xs leading-relaxed bg-muted/40 border border-border rounded p-4 overflow-x-auto whitespace-pre">
    {children}
  </pre>
);

const DataObjects = () => (
  <div className="min-h-screen bg-background">
    <Navbar />
    <section className="pt-28 pb-16 md:pt-36 md:pb-24 px-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-2">
          Data Objects &amp; Fetch API
        </h1>
        <p className="text-xs text-muted-foreground mb-10 font-mono">
          Python · v0.3 · How to pull processed Singlet samples and derive any view you want
        </p>

        <div className="prose prose-sm max-w-none space-y-10 text-muted-foreground">

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">The one-liner</h2>
            <p className="text-sm leading-relaxed mb-3">
              Every published Singlet sample is reachable by accession. <Mono>singlet.open()</Mono> resolves
              the accession, downloads the canonical bundle into the local cache (verified by sha256),
              and returns a <Mono>SingletSample</Mono>. From there, every matrix is a method call.
            </p>
            <Code>{`import singlet

sample = singlet.open("GSM3308814")

gene_counts = sample.gene_counts()        # cells × genes — total UMIs per gene
usa = sample.usa()                         # NamedTuple(spliced, unspliced, ambiguous)
psi = sample.psi()                         # per-junction percent-spliced-in
mt_vaf = sample.mt_vaf()                   # mitochondrial variant allele frequencies
donor_vaf = sample.donor_vaf()             # SNP VAFs for donor demultiplexing
summary = sample.summary                   # run-level metrics dict`}</Code>
            <p className="text-sm leading-relaxed mt-3">
              All matrices are returned as SciPy CSC sparse arrays. The whole sample is lazy — no
              file is read until you ask for it, and individual modalities (counts, mt, snp,
              nonhost) open independently.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">What's in a sample</h2>
            <p className="text-sm leading-relaxed mb-3">
              A canonical sample directory contains a small, stable set of files. The whole atlas
              uses this same layout. Every file except <Mono>manifest.json</Mono> and{" "}
              <Mono>summary.json</Mono> is optional and present only when its modality applies.
            </p>
            <Code>{`{accession}/
├── manifest.json             # file listing + sha256 digests
├── summary.json              # run metrics, schema version, sample IDs
├── provenance.json           # singlet version, reference, input hashes
├── cell_meta.parquet         # per-cell QC + barcode metadata
├── counts.1pz                # 3-block tensor: exon_body | intron_body | junctions
├── snp.1pz                   # SNP genotype (ad, dp) — donor demux input
├── mt.1pz                    # mitochondrial (ad, dp) — heteroplasmy / lineage
├── nonhost.json              # microbiome bulk metrics (Kraken2 + Bracken)
├── nonhost_species.1pz       # per-cell × taxid counts
├── guides.1pz                # CRISPR guide counts (perturbation screens)
├── antibodies.1pz            # CITE-seq ADT counts
├── vdj_gene_usage.1pz        # B/T-cell receptor V(D)J usage
├── donor_consensus.fa        # per-donor consensus
├── donor_variants.vcf.gz     # called variants
├── splice_events.tsv         # alternative-splicing event table
├── saturation_curve.tsv
└── star_Log.final.out`}</Code>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">Sample API surface</h2>
            <p className="text-sm leading-relaxed mb-3">
              <Mono>SingletSample</Mono> exposes every file as a typed accessor. Each accessor is
              lazy — nothing is decompressed until you call it.
            </p>

            <h3 className="font-display text-sm font-semibold text-foreground mb-2 mt-6">Expression &amp; splicing</h3>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li><Mono>sample.gene_counts()</Mono> → cells × genes total UMIs (CSC). Sum of exon + intron + junction blocks.</li>
              <li><Mono>sample.usa()</Mono> → <Mono>UsaTriplet(spliced, unspliced, ambiguous)</Mono>. Partition; sums to <Mono>gene_counts</Mono>. Direct input for scVelo / dynamo.</li>
              <li><Mono>sample.psi()</Mono> → per-junction Ψ (inclusion vs. competing junctions sharing donor/acceptor).</li>
              <li><Mono>sample.counts.exon_body() / .intron_body() / .junctions()</Mono> → raw row blocks for custom analyses.</li>
            </ul>

            <h3 className="font-display text-sm font-semibold text-foreground mb-2 mt-6">Variants &amp; lineage</h3>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li><Mono>sample.mt_vaf()</Mono> → mitochondrial variant-allele frequency, per (position, cell). Lineage tracing.</li>
              <li><Mono>sample.donor_vaf()</Mono> → SNP VAFs for multi-donor demultiplexing.</li>
              <li><Mono>sample.snp.ad() / .dp()</Mono>, <Mono>sample.mt.ad() / .dp()</Mono> → two-layer CSC, raw counts.</li>
            </ul>

            <h3 className="font-display text-sm font-semibold text-foreground mb-2 mt-6">Multimodal &amp; non-host</h3>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li><Mono>sample.nonhost</Mono> → microbiome summary + cells × taxid matrix.</li>
              <li><Mono>sample.guides_path</Mono>, <Mono>sample.antibodies_path</Mono>, <Mono>sample.vdj_path</Mono> → modality files when present; pass to <Mono>read_1pz</Mono>.</li>
            </ul>

            <h3 className="font-display text-sm font-semibold text-foreground mb-2 mt-6">Metadata</h3>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li><Mono>sample.summary</Mono> → run-level metrics dict from <Mono>summary.json</Mono>.</li>
              <li><Mono>sample.cell_meta</Mono> → per-cell QC and barcode table (pyarrow).</li>
              <li><Mono>sample.path</Mono> → the local directory.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">Fetch &amp; cache</h2>
            <p className="text-sm leading-relaxed mb-3">
              <Mono>singlet.fetch(accession)</Mono> is the file-only sibling of <Mono>open()</Mono>.
              It downloads to the local cache and returns the path; you call{" "}
              <Mono>SingletSample(path)</Mono> yourself. Useful when you want to control caching or
              pre-fetch many samples in parallel.
            </p>
            <Code>{`from concurrent.futures import ThreadPoolExecutor
import singlet

accessions = ["GSM3308814", "GSM3308815", "GSM3308816"]

with ThreadPoolExecutor(max_workers=4) as pool:
    paths = list(pool.map(singlet.fetch, accessions))

samples = [singlet.SingletSample(p) for p in paths]`}</Code>
            <ul className="list-disc list-inside text-sm space-y-1 mt-3">
              <li>Cache root: <Mono>~/.singlet/data/</Mono>. Override with <Mono>$SINGLET_CACHE_DIR</Mono>.</li>
              <li>Base URL: <Mono>https://data.singlet.bio/v1/</Mono>. Override with <Mono>$SINGLET_DATA_BASE</Mono>.</li>
              <li>Files already on disk with the manifest's sha256 are not re-downloaded.</li>
              <li>Within a sample, files download in parallel (8 workers by default).</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">Manifest format</h2>
            <p className="text-sm leading-relaxed mb-3">
              Each sample directory ships a <Mono>manifest.json</Mono>. This is the contract — every
              hosted sample has it, every fetch reads it first.
            </p>
            <Code>{`{
  "schema": "singlet-sample-manifest/v1",
  "accession": "GSM3308814",
  "produced_by": {"tool": "singlet", "version": "0.3.0"},
  "reference": {
    "organism": "Homo sapiens",
    "annotation": "gencode-v44",
    "sha256": "..."
  },
  "files": [
    {"path": "summary.json",       "size": 4321,    "sha256": "..."},
    {"path": "counts.1pz",         "size": 4587234, "sha256": "..."},
    {"path": "cell_meta.parquet",  "size": 6789,    "sha256": "..."},
    {"path": "snp.1pz",            "size": 213445,  "sha256": "..."},
    {"path": "mt.1pz",             "size": 32118,   "sha256": "..."}
  ]
}`}</Code>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">Reference data</h2>
            <p className="text-sm leading-relaxed mb-3">
              Derived views (<Mono>gene_counts</Mono>, <Mono>usa</Mono>, <Mono>psi</Mono>) need the
              feature bundle (<Mono>features.fbin</Mono>) that maps row-block indices to gene IDs and
              junction classes. The bundle is resolved in this order:
            </p>
            <ol className="list-decimal list-inside text-sm space-y-1">
              <li>The <Mono>features=</Mono> argument to the method.</li>
              <li>A <Mono>reference/</Mono> directory next to the sample.</li>
              <li>The <Mono>$SINGLET_REFERENCE_DIR</Mono> environment variable.</li>
            </ol>
            <p className="text-sm leading-relaxed mt-3">
              Bundles are versioned by annotation release (e.g. gencode-v44). The manifest's{" "}
              <Mono>reference</Mono> block records which bundle the sample was processed with so a
              mismatch is caught immediately.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">Why these primitives</h2>
            <p className="text-sm leading-relaxed mb-3">
              The on-disk format stores only canonical inputs: row blocks for counts and two-layer
              CSC tensors for variant calls. Every other matrix — gene-level expression, USA, PSI,
              VAF — is a deterministic projection. We don't cache derived matrices because they're
              fast to compute (sub-200 ms on a 12K-cell sample) and trivially parallelizable across
              samples.
            </p>
            <p className="text-sm leading-relaxed">
              The atomic representation that powers the count blocks is documented separately in
              the{" "}
              <Link to="/specs/splice-patterns" className="text-primary hover:underline">
                Splice Pattern Format spec
              </Link>
              . Users do not need to read that spec — it's an internal contract between the
              pipeline and the readers.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">Status</h2>
            <p className="text-sm leading-relaxed">
              <Mono>singlet.open</Mono>, <Mono>singlet.fetch</Mono>, and the derived views are wired
              and importable. The hosted endpoint at <Mono>data.singlet.bio/v1</Mono> is provisioned
              but not yet populated — runs ingested into the catalog are still on private storage.
              Population of the public bucket is tracked separately and will not change this API.
            </p>
          </section>
        </div>
      </div>
    </section>
    <Footer />
  </div>
);

export default DataObjects;

import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { usePageMeta } from "@/hooks/usePageMeta";

const Mono = ({ children }: { children: React.ReactNode }) => (
  <code className="font-mono text-[0.85em] bg-muted/60 px-1 py-0.5 rounded">{children}</code>
);

const Block = ({ children }: { children: React.ReactNode }) => (
  <pre className="font-mono text-xs leading-relaxed bg-muted/40 border border-border rounded p-4 overflow-x-auto whitespace-pre">
    {children}
  </pre>
);

const SplicePatternSpec = () => {
  usePageMeta({ title: "Splice pattern format", description: "Draft technical specification for the singlet splice pattern format.", path: "/specs/splice-patterns" });
  return (
  <div className="min-h-screen bg-background">
    <Navbar />
    <section className="py-12 md:py-16 px-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-2">
          Singlet Splice Pattern Format
        </h1>
        <p className="text-xs text-muted-foreground mb-2 font-mono">Spec v0.1 — Draft — 2026-05-19</p>
        <p className="text-sm text-muted-foreground mb-10">
          The atomic storage unit for mapped single-cell transcriptomics in Singlet. One
          UMI lives in exactly one bucket per gene; all downstream matrices
          (spliced / unspliced / ambiguous, junction usage, exon usage, total expression) are
          derived by query rather than stored redundantly.
        </p>

        <div className="prose prose-sm max-w-none space-y-10 text-muted-foreground">

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">1. Motivation</h2>
            <p className="text-sm leading-relaxed mb-3">
              Conventional pipelines emit three independent count matrices — exon, intron,
              splice-junction — each with its own UMI dedup table. A UMI whose reads cover
              both an exon and an intron of the same gene is then counted in both matrices.
              This breaks the partition required for honest spliced / unspliced quantification
              and inflates totals.
            </p>
            <p className="text-sm leading-relaxed">
              Singlet stores instead the structural path each UMI takes through its gene of
              origin, dedup'd once. Every other view is a deterministic query over this
              primitive.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">2. Terminology</h2>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li><strong>Feature dictionary (SFD)</strong> — versioned, locally installed catalog of genes, exons, and introns. Defines the integer index space.</li>
              <li><strong>Token</strong> — one byte: high bit = intron flag, low 7 bits = feature index within gene.</li>
              <li><strong>Pattern</strong> — sorted token sequence describing one UMI's path through one gene.</li>
              <li><strong>Pattern hash</strong> — 64-bit canonical hash of the token sequence; identical patterns collide globally.</li>
              <li><strong>Observation</strong> — (cell, gene, pattern_hash, umi_count) record. The atomic stored unit.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">3. Feature Dictionary (SFD)</h2>
            <p className="text-sm leading-relaxed mb-3">
              One <Mono>.sfd</Mono> file per (organism, annotation release). Locally installed
              via <Mono>singlet refs install human-gencode-v44</Mono> and pinned by sha256 in
              every <Mono>.1pz</Mono> that consumes it. Because the index space is fixed by
              the SFD, count matrices store only indices — no string rownames.
            </p>
            <Block>{`SFD binary layout
─────────────────────────────────────────────
  magic        "SFD1"               4 bytes
  version      uint16               2 bytes
  organism     ascii, null-term     ≤ 32 bytes
  annotation   ascii (e.g. v44)     ≤ 32 bytes
  sha256       payload digest      32 bytes
  n_genes      uint32
  gene_offsets uint64 × n_genes      (offset into gene_block)

GeneRecord (variable):
  gene_id      ascii (Ensembl)
  symbol       ascii
  chrom        uint16 (table-indexed)
  strand       int8   (+1 / −1)
  n_exons      uint16     (1..N, 1-indexed)
  exons        (start_u32, end_u32) × n_exons   (genomic, sorted)
  # introns are derived: intron i lies between exon i and exon i+1`}</Block>
            <p className="text-sm leading-relaxed mt-3">
              Genes with more than 127 exons (rare; titin, dystrophin) use a 2-byte extended
              token encoding flagged in the gene record's header.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">4. Token Encoding</h2>
            <Block>{`Byte layout (standard, ≤127 features):
  bit 7      : 0 = exon,   1 = intron
  bits 0..6  : feature index within gene (1..127)

Extended (>127 features):
  16-bit word, bit 15 = intron flag, bits 0..14 = index`}</Block>
            <p className="text-sm leading-relaxed mt-3">
              Tokens are written in genomic order (5′ → 3′ relative to the gene's strand) and
              the sequence is canonicalized by sorting on (intron_flag, index). Because reads
              are colinear with the genome after alignment, sorted order preserves all
              structural information.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">5. Pattern &amp; Pattern Hash</h2>
            <p className="text-sm leading-relaxed mb-3">
              A pattern is the canonical token sequence for one (cell, gene, UMI). Examples:
            </p>
            <Block>{`[1, 2, 3]          # exons 1→2→3, two junctions implied — spliced
[1, i1, 2]         # exon 1, retained intron 1, exon 2 — unspliced
[3]                # exon 3 only, no junction — ambiguous
[2, i2]            # exon-intron boundary read — unspliced`}</Block>
            <p className="text-sm leading-relaxed mt-3">
              <Mono>pattern_hash</Mono> = xxh3_64(canonical_byte_sequence). The hash is
              deterministic, collision-resistant in practice for the cardinalities we see,
              and stable across samples that share an SFD. Pattern dictionaries can be merged
              across samples without renumbering.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">6. Read → Token Classification</h2>
            <p className="text-sm leading-relaxed mb-3">
              For each primary alignment of a read to its gene of origin:
            </p>
            <ol className="list-decimal list-inside text-sm space-y-1">
              <li>Split CIGAR into aligned blocks (M / = / X). Skips (N) and deletions advance reference but emit no block.</li>
              <li>For each aligned block, query the gene's exon and intron interval trees.</li>
              <li>An exon is recorded for a block iff overlap ≥ <Mono>MIN_FEATURE_OVERLAP_BP</Mono> (default 10 bp) <em>and</em> overlap ≥ <Mono>MIN_FEATURE_OVERLAP_FRAC</Mono> of the block (default 0.30).</li>
              <li>An intron is recorded under the same thresholds against the intron tree.</li>
              <li>Each N-skip whose donor/acceptor coordinates match an annotated intron is recorded as evidence of that junction; this does not add a token but informs the spliced/ambiguous decision (see §8).</li>
              <li>Reads with multi-gene token sets are dropped (or routed to EM rescue if enabled). Patterns are strictly intra-gene.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">7. UMI Consensus</h2>
            <p className="text-sm leading-relaxed mb-3">
              All reads sharing (cell, gene, UMI) are merged before pattern assignment:
            </p>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li>Token set = union of tokens across reads.</li>
              <li>Observed junction set = union of N-skips across reads.</li>
              <li>If reads disagree on gene identity, the UMI is dropped (or rescued by EM if enabled).</li>
              <li>The merged token sequence is canonicalized and hashed once.</li>
            </ul>
            <p className="text-sm leading-relaxed mt-3">
              Net effect: one UMI → one pattern → one observation row. No double-counting is
              possible at any stage of aggregation.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">8. Spliced / Unspliced / Ambiguous Derivation</h2>
            <p className="text-sm leading-relaxed mb-3">
              S/U/A is a pure function of the pattern and its observed junction set. Nothing
              is stored — the classifier is run at query time:
            </p>
            <Block>{`def classify(pattern, junctions):
    has_intron_token = any(t.is_intron for t in pattern)
    if has_intron_token:
        return "U"          # unspliced — at least one intronic block
    n_exons = len({t.index for t in pattern})
    if n_exons >= 2 and junctions:
        return "S"          # spliced — multi-exon path with junction evidence
    return "A"              # ambiguous — single-exon coverage, no junction observed`}</Block>
            <p className="text-sm leading-relaxed mt-3">
              The three matrices form an exact partition: S + U + A = total gene UMIs.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">9. Storage in .1pz</h2>
            <p className="text-sm leading-relaxed mb-3">
              Observations are stored in a single sparse matrix with rows = cells and columns
              = global pattern indices. Global pattern index = SFD-gene-offset + local pattern
              id within gene, materialized at write time from a sample-scoped pattern
              dictionary:
            </p>
            <Block>{`patterns.1pz (per-sample)
─────────────────────────────────────────────
  header: sfd_sha256, n_cells, n_global_patterns
  matrix: COO/CSC sparse, cell × pattern_index → umi_count

patterns.dict (per-sample sidecar)
─────────────────────────────────────────────
  per global_pattern_index:
    gene_idx (into SFD)
    pattern_hash (u64)
    canonical token bytes`}</Block>
            <p className="text-sm leading-relaxed mt-3">
              No string rownames are stored anywhere in the .1pz. All names (gene_id, symbol,
              exon/intron coordinates) are resolved through the SFD at load time. Merging
              samples requires only that they reference the same SFD sha256 — pattern hashes
              collide naturally.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">10. Derivation Queries</h2>
            <p className="text-sm leading-relaxed mb-3">
              All downstream matrices are constructed by scanning <Mono>patterns.1pz</Mono>
              once and grouping by the appropriate key:
            </p>
            <Block>{`gene_S[c, g]     = Σ count[c, p]   for p in g  where classify(p) == "S"
gene_U[c, g]     = Σ count[c, p]   for p in g  where classify(p) == "U"
gene_A[c, g]     = Σ count[c, p]   for p in g  where classify(p) == "A"
gene_total[c, g] = gene_S + gene_U + gene_A     (exact, no overcount)

sj_counts[c, j]  = Σ count[c, p]   over patterns whose token sequence
                                    implies junction j (adjacent exon pair)
exon_use[c, e]   = Σ count[c, p]   over patterns whose token set contains e

intron_retention[c, i] = Σ count[c, p]
   where p contains intron token i AND flanking exon tokens — distinguishes
   true retention from straight-through unspliced reads.`}</Block>
            <p className="text-sm leading-relaxed mt-3">
              <strong>Important:</strong> <Mono>sj_counts</Mono> and <Mono>exon_use</Mono> are
              evidence matrices. A single UMI may contribute to many junctions and exons.
              They are not partitioned counts and must not be summed to recover gene totals —
              use <Mono>gene_total</Mono> for that.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">11. Algorithmic Cost</h2>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li>Per-read overhead vs current 3-counter design: one interval-tree query (already paid), one hash, one dict insert. No additional dedup tables — net <em>fewer</em> hash operations than today's three-table scheme.</li>
              <li>Pattern dictionary size: empirically &lt; 50 patterns / gene at full saturation for protein-coding genes; the long tail is bounded by annotated isoforms. Per-sample dictionary fits in tens of MB.</li>
              <li>Compressed <Mono>patterns.1pz</Mono> is smaller than the current sum of <Mono>exon_counts</Mono> + <Mono>intron_counts</Mono> + <Mono>sj_counts</Mono> for typical droplet libraries, because most cells revisit a small set of patterns.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">12. Open Issues</h2>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li>Min-overlap thresholds (<Mono>MIN_FEATURE_OVERLAP_BP</Mono>, <Mono>MIN_FEATURE_OVERLAP_FRAC</Mono>) need empirical tuning across short-read (10x), long-read, and Smart-seq2 inputs.</li>
              <li>Pattern hash collision rate at 10⁹+ observations: xxh3_64 expected fine, but worth a one-time audit against real data.</li>
              <li>Multi-mapping UMI rescue (EM) needs a defined fallback policy when gene identity is itself ambiguous within a UMI.</li>
              <li>Long-read (Iso-Seq, ONT) data produces patterns with 10s of tokens; encoding stays valid, but pattern dictionaries grow. May warrant a separate long-read SFD variant.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">13. Status</h2>
            <p className="text-sm leading-relaxed">
              Draft v0.1 — design only. Implementation supersedes the current independent
              <Mono> exon_counts</Mono> / <Mono>intron_counts</Mono> / <Mono>sj_counts</Mono>
              writers in <Mono>pileup_engine.h</Mono>. Outputs of the v0.1 implementation:
              <Mono> patterns.1pz</Mono>, <Mono>patterns.dict</Mono>, and the installed SFD.
              Three independent matrices are removed.
            </p>
          </section>
        </div>
      </div>
    </section>
    <Footer />
  </div>
  );
};

export default SplicePatternSpec;

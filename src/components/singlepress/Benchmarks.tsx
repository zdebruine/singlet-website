const benchmarkRows = [
  { format: "SinglePress (.spz)", size: "1.2 GB", readTime: "3.1s", gpuLoad: "0.8s", ratio: "10×", highlight: true },
  { format: "H5AD (.h5ad)", size: "12.4 GB", readTime: "28s", gpuLoad: "14s", ratio: "1× (baseline)", highlight: false },
  { format: "MTX.gz", size: "8.1 GB", readTime: "45s", gpuLoad: "N/A", ratio: "1.5×", highlight: false },
  { format: "BPCells", size: "3.2 GB", readTime: "8.4s", gpuLoad: "N/A", ratio: "3–5×", highlight: false },
  { format: "TileDB-SOMA", size: "3.5 GB", readTime: "9.1s", gpuLoad: "6.2s", ratio: "~3–5×", highlight: false },
];

const SinglePressBenchmarks = () => (
  <section className="py-24 px-6">
    <div className="max-w-5xl mx-auto">
      <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4 text-center">Performance</p>
      <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground text-center tracking-tightest mb-4">
        Benchmarks
      </h2>
      <p className="text-sm text-muted-foreground text-center mb-10 max-w-xl mx-auto">
        10M cell dataset (33,538 genes). Single-threaded read. NVIDIA A100 GPU. Lower is better for size and time.
      </p>
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">Format</th>
                <th className="text-right px-4 py-3 text-muted-foreground font-medium">File Size</th>
                <th className="text-right px-4 py-3 text-muted-foreground font-medium">Read Time</th>
                <th className="text-right px-4 py-3 text-muted-foreground font-medium">GPU Load</th>
                <th className="text-right px-4 py-3 text-muted-foreground font-medium">Compression</th>
              </tr>
            </thead>
            <tbody>
              {benchmarkRows.map((row) => (
                <tr key={row.format} className={`border-b border-border last:border-0 ${row.highlight ? "bg-primary/[0.04]" : ""}`}>
                  <td className={`px-4 py-3 font-mono text-xs ${row.highlight ? "text-primary font-semibold" : "text-muted-foreground"}`}>{row.format}</td>
                  <td className={`px-4 py-3 text-right font-mono text-xs ${row.highlight ? "text-foreground font-semibold" : "text-muted-foreground"}`}>{row.size}</td>
                  <td className={`px-4 py-3 text-right font-mono text-xs ${row.highlight ? "text-foreground font-semibold" : "text-muted-foreground"}`}>{row.readTime}</td>
                  <td className={`px-4 py-3 text-right font-mono text-xs ${row.highlight ? "text-foreground font-semibold" : "text-muted-foreground"}`}>{row.gpuLoad}</td>
                  <td className={`px-4 py-3 text-right font-mono text-xs ${row.highlight ? "text-primary font-bold" : "text-muted-foreground"}`}>{row.ratio}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </section>
);

export default SinglePressBenchmarks;

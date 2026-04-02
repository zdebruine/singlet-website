import { Shuffle } from "lucide-react";

const pytorchCode = `from singlet.torch import DataLoader

# Zero-copy GPU loading
loader = DataLoader("GSE136831",
                    batch_size=1024, shuffle=True,
                    num_workers=4, device="cuda")

for batch in loader:
    # batch is a sparse CUDA tensor — no transfer needed
    # normalization happens on-the-fly
    embeddings = model(batch)`;

const gpuFeatures = [
  { title: "Zero-copy CuSPARSE", desc: "Sparse data mapped directly to GPU via CuSPARSE. No host-to-device copies, no intermediate dense buffers." },
  { title: "PyTorch Sparse Tensors", desc: "Native torch.sparse_csc_tensor support. Works with any model that accepts sparse inputs." },
  { title: "On-the-fly Normalization", desc: "Library-size normalization computed during loading. No preprocessing step, no extra passes over the data." },
  { title: "Random Shufflers", desc: "High-performance distributed shufflers for pulling preferred data subsets across workers and nodes." },
  { title: "Compute-bound Training", desc: "Eliminates I/O bottlenecks entirely. Out-of-core GPU training stays saturated — your GPUs never wait on disk." },
];

const SinglePressGPU = () => (
  <section className="py-24 px-6">
    <div className="max-w-4xl mx-auto">
      <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">GPU-Native by Design</p>
      <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-6">
        Built for the GPU, not adapted to it
      </h2>
      <p className="text-muted-foreground leading-relaxed mb-8 max-w-3xl">
        Most formats were designed for CPUs and retro-fitted for accelerators. Singlet Bio's compression was engineered from the ground up for GPU training pipelines — zero-copy CuSPARSE integration, native PyTorch sparse tensor support, and on-the-fly normalization that keeps every CUDA core busy.
      </p>
      <div className="grid md:grid-cols-[2fr_1fr] gap-6">
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border bg-muted/30">
            <div className="w-2.5 h-2.5 rounded-full bg-destructive/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
            <span className="ml-2 font-mono text-[10px] text-muted-foreground">gpu_training.py</span>
          </div>
          <div className="bg-background p-5">
            <pre className="font-mono text-xs leading-6 text-foreground overflow-x-auto whitespace-pre">
              {pytorchCode.split("\n").map((line, i) => {
                if (line.startsWith("#")) return <div key={i} className="text-muted-foreground">{line}</div>;
                const highlighted = line
                  .replace(/\b(from|import|for|in)\b/g, '§kw§$1§/kw§')
                  .replace(/"([^"]*)"/g, '§str§"$1"§/str§');
                const parts = highlighted.split(/§(kw|str|\/kw|\/str)§/);
                let inKw = false, inStr = false;
                return (
                  <div key={i}>
                    {parts.map((part, j) => {
                      if (part === "kw") { inKw = true; return null; }
                      if (part === "/kw") { inKw = false; return null; }
                      if (part === "str") { inStr = true; return null; }
                      if (part === "/str") { inStr = false; return null; }
                      if (inKw) return <span key={j} className="text-primary font-semibold">{part}</span>;
                      if (inStr) return <span key={j} className="text-accent-foreground">{part}</span>;
                      return <span key={j}>{part}</span>;
                    })}
                  </div>
                );
              })}
            </pre>
          </div>
        </div>
        <div className="space-y-3">
          {gpuFeatures.map((item) => (
            <div key={item.title} className="rounded-lg border border-border bg-card p-4">
              <h4 className="font-display text-sm font-bold text-primary mb-1">{item.title}</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

export default SinglePressGPU;

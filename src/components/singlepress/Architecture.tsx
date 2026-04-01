import { ChevronRight, HardDrive, RotateCcw, Cpu, Shield, Zap } from "lucide-react";

const archSteps = [
  { icon: HardDrive, label: "Column-chunked CSC", desc: "Sparse data in compressed sparse column format, chunked for parallel I/O" },
  { icon: RotateCcw, label: "Delta-encoded indices", desc: "Row indices stored as deltas — monotonically increasing values compress dramatically" },
  { icon: Cpu, label: "Variable-width int packing", desc: "Integers packed to minimum bit-width per chunk — no wasted bytes" },
  { icon: Shield, label: "CRC32 integrity", desc: "Per-chunk checksums for data integrity verification on read" },
  { icon: Zap, label: "Optional transpose", desc: "Pre-transposed layout for row-slicing workloads (gene queries)" },
];

const SinglePressArchitecture = () => (
  <section className="py-24 px-6 relative overflow-hidden">
    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/[0.02] to-transparent pointer-events-none" />
    <div className="max-w-5xl mx-auto relative">
      <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4 text-center">Format Design</p>
      <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground text-center tracking-tightest mb-14">
        Architecture
      </h2>
      <div className="flex flex-col md:flex-row items-start gap-3">
        {archSteps.map((step, i) => {
          const Icon = step.icon;
          return (
            <div key={step.label} className="flex-1 flex flex-col md:flex-row items-center gap-3">
              <div className="rounded-xl border border-border bg-card p-5 text-center flex-1 w-full">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <Icon size={20} className="text-primary" />
                </div>
                <h4 className="font-display text-sm font-bold text-foreground mb-1">{step.label}</h4>
                <p className="text-[11px] text-muted-foreground leading-snug">{step.desc}</p>
              </div>
              {i < archSteps.length - 1 && (
                <ChevronRight size={16} className="text-primary flex-shrink-0 hidden md:block" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  </section>
);

export default SinglePressArchitecture;

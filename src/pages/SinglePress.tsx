import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Github, ChevronRight, Download, Cpu, HardDrive,
  Zap, Shield, RotateCcw, Shuffle, Filter, Package, Crown, Database
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import SinglePressBenchmarks from "@/components/singlepress/Benchmarks";
import SinglePressArchitecture from "@/components/singlepress/Architecture";
import SinglePressGPU from "@/components/singlepress/GPUNative";
import SinglePressProWorkflow from "@/components/singlepress/ProWorkflow";
import SinglePressInstall from "@/components/singlepress/Install";

const SinglePress = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Hero */}
      <section className="relative pt-32 pb-20 px-6 grid-bg">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-primary/[0.06] blur-[100px]" />
        </div>
        <div className="relative max-w-4xl mx-auto text-center">
          <div className="flex items-center justify-center gap-2 mb-6">
            <div className="w-2.5 h-2.5 rounded-full bg-primary" />
            <span className="font-mono text-xs text-muted-foreground uppercase tracking-[0.2em]">Data Engineering for Genomics Intelligence</span>
          </div>
          <h1 className="font-display text-5xl md:text-7xl font-bold text-foreground leading-[0.95] tracking-tightest mb-6">
            SinglePress
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto leading-relaxed mb-4">
            GPU-native compression for single-cell omics. Zero-copy. Compute-bound. Open source.
          </p>
          <p className="text-sm text-muted-foreground max-w-xl mx-auto leading-relaxed mb-8">
            The <span className="font-mono text-foreground font-medium">.1pz</span> format ships inside the <span className="text-foreground font-medium">singlet</span> package. PyTorch DataLoaders, CuSPARSE integration, and on-the-fly normalization — designed to keep your GPUs saturated, not waiting on I/O.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <a
              href="https://github.com/singletdb/singlepress"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-7 py-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Github size={16} /> View on GitHub
            </a>
            <a
              href="#install"
              className="inline-flex items-center gap-2 px-7 py-3 rounded-md border border-border bg-secondary text-secondary-foreground text-sm font-mono hover:bg-muted transition-colors"
            >
              pip install singlet
            </a>
          </div>
        </div>
      </section>

      {/* Why a new format? */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">The Problem</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-6">
            I/O is the bottleneck. We fix it.
          </h2>
          <div className="space-y-4 text-muted-foreground leading-relaxed">
            <p>
              Single-cell datasets are <span className="text-foreground font-semibold">sparse — 95–99% zeros</span> — but stored in formats designed for dense data. H5AD allocates space for every zero. MTX stores every coordinate triple. Even "compressed" formats leave 3–5× on the table. The result? Your GPUs sit idle while data trickles in from disk.
            </p>
            <p>
              SinglePress exploits sparsity structure for <span className="text-foreground font-semibold">10× compression</span> with zero-copy GPU loading via CuSPARSE and PyTorch sparse tensors. No decompression step. No intermediate representation. Normalization happens on-the-fly. The file on disk maps directly to the tensor in GPU memory — keeping you <span className="text-foreground font-semibold">compute-bound, not I/O-bound</span> for out-of-core GPU training.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-10">
            {[
              { val: "10×", label: "compression vs H5AD" },
              { val: "0 ms", label: "decompression overhead" },
              { val: "100%", label: "GPU utilization" },
              { val: "Native", label: "PyTorch DataLoaders" },
            ].map((s) => (
              <div key={s.label} className="text-center rounded-lg border border-border bg-card p-4">
                <div className="font-mono text-2xl font-bold text-primary">{s.val}</div>
                <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <SinglePressBenchmarks />
      <SinglePressGPU />
      <SinglePressArchitecture />
      <SinglePressProWorkflow />
      <SinglePressInstall />

      <Footer />
    </div>
  );
};

export default SinglePress;

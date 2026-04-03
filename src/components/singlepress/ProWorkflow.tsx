import { Filter, Package, Database, Crown, ArrowRight, Search, Bot, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

const proAnnotations = [
  "Cell type annotations",
  "Imputed multimodal data",
  "Tissue labels",
  "Perturbation metadata",
  "Disease annotations",
  "Organism & assay tags",
  "AI-powered GEO search",
  "MCP tool integration",
];

const workflowSteps = [
  {
    icon: Search,
    step: "1",
    title: "Search with AI",
    desc: "Describe what you need in natural language. Our AI searches GEO descriptions across all processed datasets to find exact matches — then slices the data per your request.",
  },
  {
    icon: Bot,
    step: "2",
    title: "MCP tools",
    desc: "Connect via MCP and use natural language to query for single-cell data directly from your IDE or agent. Results are delivered in .1pz format, ready for downstream analysis.",
  },
  {
    icon: RefreshCw,
    step: "3",
    title: "Convert with one line",
    desc: "Convert .1pz to AnnData, SingleCellExperiment, Seurat, or any other format with a single line of code using the singlet package. No pipelines, no boilerplate.",
  },
  {
    icon: Filter,
    step: "4",
    title: "Slice & filter",
    desc: "Filter by GSE/GSM identifier, tissue, cell type, disease, organism, assay — whatever you need. Rich annotations make it easy to find exactly the cells you're looking for.",
  },
  {
    icon: Database,
    step: "5",
    title: "Verify & request",
    desc: "Preview your selection. Confirm cell counts, metadata coverage, and annotation quality. When you're ready, request your .1pz file — we'll package it up and send it your way.",
  },
  {
    icon: Package,
    step: "6",
    title: "Load & train",
    desc: "Once on disk, use our data loaders to interface directly with your file. Stream into PyTorch DataLoaders, or convert to any format. Your cluster, your workflow.",
  },
];

const SinglePressProWorkflow = () => (
  <section className="py-24 px-6 relative overflow-hidden">
    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/[0.02] to-transparent pointer-events-none" />
    <div className="max-w-5xl mx-auto relative">
      <div className="flex items-center justify-center gap-2 mb-4">
        <Crown size={14} className="text-primary" />
        <p className="font-mono text-xs text-primary uppercase tracking-widest">Pro & Enterprise</p>
      </div>
      <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground text-center tracking-tightest mb-4">
        From atlas to cluster in minutes
      </h2>
      <p className="text-sm text-muted-foreground text-center mb-12 max-w-2xl mx-auto leading-relaxed">
        The Pro version ships with rich annotations across every cell in the atlas. Set your filters, verify what you want, and we'll deliver a ready-to-train <span className="font-mono text-foreground">.1pz</span> file to your infrastructure.
      </p>

      {/* Annotation tags */}
      <div className="flex flex-wrap justify-center gap-2 mb-14">
        {proAnnotations.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center px-3 py-1.5 rounded-full border border-border bg-card text-xs font-medium text-muted-foreground"
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Workflow steps */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
        {workflowSteps.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.step} className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Icon size={20} className="text-primary" />
                </div>
                <div className="font-mono text-xs text-muted-foreground">Step {item.step}</div>
              </div>
              <h4 className="font-display text-lg font-bold text-foreground mb-2">{item.title}</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
            </div>
          );
        })}
      </div>

      <div className="text-center">
        <Link
          to="/pricing"
          className="inline-flex items-center gap-2 px-7 py-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
        >
          View Pro Plans <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  </section>
);

export default SinglePressProWorkflow;

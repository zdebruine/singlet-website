import { useAuth } from "@/hooks/useAuth";
import { useCorpusStats } from "@/hooks/useDatabase";
import { Link } from "react-router-dom";
import { Database, Download, Filter, LogOut, ArrowRight, Search, Bot } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const { data: stats } = useCorpusStats();

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-10">
            <div>
              <h1 className="font-display text-3xl font-bold text-foreground tracking-tightest mb-1">
                Dashboard
              </h1>
              <p className="text-sm text-muted-foreground">
                Welcome back, <span className="text-foreground font-medium">{user?.email}</span>
              </p>
            </div>
            <button
              onClick={signOut}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-border bg-secondary text-secondary-foreground text-sm font-medium hover:bg-muted transition-colors"
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            {stats && (
              <div className="col-span-full grid grid-cols-2 md:grid-cols-4 gap-4 rounded-xl border border-primary/20 bg-primary/5 p-4 mb-2">
                {[
                  { label: "Samples", value: stats.total_samples?.toLocaleString() },
                  { label: "Successful", value: stats.success_samples?.toLocaleString() },
                  { label: "Total Cells", value: stats.total_cells ? `${(stats.total_cells / 1e6).toFixed(1)}M` : "—" },
                  { label: "Species", value: stats.species_count },
                ].map((s) => (
                  <div key={s.label} className="text-center">
                    <div className="font-mono text-lg font-bold text-primary">{s.value}</div>
                    <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{s.label}</div>
                  </div>
                ))}
              </div>
            )}
            {[
              {
                icon: Search,
                title: "Query the Atlas",
                desc: "Structured queries across the full atlas. Filter by tissue, cell type, disease, and species — get annotations, NMF programs, and velocity.",
                link: "/docs",
                cta: "Query Now",
                pro: true,
              },
              {
                icon: Bot,
                title: "MCP Tools",
                desc: "Query Singlet Bio from VS Code, Claude Code, or Cursor via MCP. Query results stream directly into AnnData.",
                link: "/docs",
                cta: "Connect via MCP",
                pro: true,
              },
              {
                icon: Database,
                title: "Browse Datasets",
                desc: "Explore thousands of uniformly reprocessed datasets across hundreds of species and 6 modalities.",
                link: "/docs",
                cta: "View Docs",
              },
              {
                icon: Filter,
                title: "Slice & Filter",
                desc: "Filter by tissue, cell type, disease, organism, assay, GSE/GSM identifiers, and more.",
                link: "/docs",
                cta: "View Docs",
              },
              {
                icon: Download,
                title: "Export Data",
                desc: "Package your filtered selection and download via Cloudflare R2 (free with API key). Convert to AnnData, Seurat, or any format.",
                link: "/docs",
                cta: "View docs",
              },
            ].map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.title} className={`rounded-xl border bg-card p-6 flex flex-col ${(card as any).pro ? "border-primary/30" : "border-border"}`}>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Icon size={20} className="text-primary" />
                    </div>
                    {(card as any).pro && <span className="text-[10px] font-mono font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">PRO</span>}
                  </div>
                  <h3 className="font-display text-lg font-bold text-foreground mb-2">{card.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed flex-1 mb-4">{card.desc}</p>
                  <Link
                    to={card.link}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  >
                    {card.cta} <ArrowRight size={14} />
                  </Link>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="font-display text-lg font-bold text-foreground mb-2">Quick Start</h3>
            <div className="rounded-lg bg-background border border-border p-4">
              <pre className="font-mono text-xs text-muted-foreground leading-6 overflow-x-auto">
                {`pip install singlet

import singlet

# Free: download any dataset
adata = singlet.load("GSE136831")

# Pro: structured query across the atlas
adata = singlet.query(
    tissue="lung", cell_type="T cell"
)
# → annotations, NMF programs, velocity included`}
              </pre>
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default Dashboard;

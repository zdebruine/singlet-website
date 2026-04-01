import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Github, Download } from "lucide-react";

const SinglePressInstall = () => {
  const [installTab, setInstallTab] = useState<"python" | "r">("python");

  return (
    <section id="install" className="py-24 px-6">
      <div className="max-w-3xl mx-auto text-center">
        <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Get Started</p>
        <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-10">
          Install
        </h2>
        <div className="rounded-xl border border-border overflow-hidden max-w-lg mx-auto mb-8">
          <div className="flex border-b border-border">
            <button
              onClick={() => setInstallTab("python")}
              className={`flex-1 px-4 py-2.5 font-mono text-xs font-semibold transition-colors ${installTab === "python" ? "text-primary bg-primary/5 border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              Python
            </button>
            <button
              onClick={() => setInstallTab("r")}
              className={`flex-1 px-4 py-2.5 font-mono text-xs font-semibold transition-colors ${installTab === "r" ? "text-primary bg-primary/5 border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              R
            </button>
          </div>
          <div className="bg-background p-5 text-left">
            <pre className="font-mono text-sm text-foreground">
              {installTab === "python" ? "pip install singletai" : 'install.packages("singlet")'}
            </pre>
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-4">
          <a
            href="https://github.com/singletdb/singlepress"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md border border-border bg-secondary text-secondary-foreground text-sm font-medium hover:bg-muted transition-colors"
          >
            <Github size={16} /> GitHub
          </a>
          <a
            href="#"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md border border-border bg-secondary text-secondary-foreground text-sm font-medium hover:bg-muted transition-colors"
          >
            <Download size={16} /> Spec Document
          </a>
          <Link
            to="https://github.com/zdebruine"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            GitHub <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
};

export default SinglePressInstall;

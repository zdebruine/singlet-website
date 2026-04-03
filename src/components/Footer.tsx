import { Link } from "react-router-dom";
import { Github } from "lucide-react";

const footerCols = [
  {
    title: "Product",
    links: [
      { label: "Technology", to: "/gene-programs" },
      { label: "Intelligence Layers", to: "/intelligence" },
      
      { label: "Enterprise", to: "/enterprise" },
      { label: "Pricing", to: "/pricing" },
      { label: "Docs", to: "/docs" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "GitHub", href: "https://github.com/singletdb" },
      { label: "RcppML (CRAN)", href: "https://cran.r-project.org/package=RcppML" },
      { label: "CZI CELLxGENE", href: "https://cellxgene.cziscience.com/" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "For Investors", to: "/invest" },
      { label: "Contact", href: "mailto:hello@singletdb.com" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms", to: "/terms" },
      { label: "Privacy", to: "/privacy" },
      { label: "Data License", to: "/data-license" },
    ],
  },
];

const Footer = () => (
  <footer className="border-t border-border relative overflow-hidden">
    {/* Brand watermark */}
    <svg className="absolute bottom-4 right-4 opacity-[0.025] pointer-events-none" width="200" height="200" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
      <circle cx="5" cy="5" r="5" fill="hsl(174 84% 32%)" />
    </svg>
    <div className="max-w-7xl mx-auto px-6 py-14 relative">
      {/* Columns */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
        {footerCols.map((col) => (
          <div key={col.title}>
            <h4 className="font-display text-sm font-semibold text-foreground mb-4">{col.title}</h4>
            <ul className="space-y-2.5">
              {col.links.map((link) => (
                <li key={link.label}>
                  {"href" in link && link.href ? (
                    <a href={link.href} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                      {link.label}
                    </a>
                  ) : (
                    <Link to={link.to || "#"} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Divider */}
      <div className="border-t border-border pt-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Left — logo + legal */}
          <div className="flex flex-col items-center md:items-start gap-2">
            <div className="flex items-center gap-2">
              <svg className="self-center" style={{ height: '1.1em', width: '1.1em' }} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="5" cy="5" r="2" fill="hsl(174 84% 32%)" />
                <circle cx="15" cy="5" r="2" fill="hsl(174 84% 32%)" />
                <circle cx="5" cy="15" r="2" fill="hsl(174 84% 32%)" />
                <text x="15" y="15" textAnchor="middle" dominantBaseline="central" fontFamily="'JetBrains Mono', monospace" fontSize="10" fontWeight="700" fill="hsl(174 84% 32%)">1</text>
              </svg>
              <span className="font-display font-bold text-sm tracking-tightest text-foreground">Singlet Bio</span>
            </div>
            <p className="text-xs text-muted-foreground/60 text-center md:text-left max-w-md">
              Free for academic research. Singlet is open source under MIT license.
            </p>
          </div>

          {/* Right — socials + copyright */}
          <div className="flex items-center gap-5">
            <a href="https://github.com/singletdb" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
              <Github size={18} />
            </a>
            <a href="https://x.com/singletdb" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
            </a>
            <a href="mailto:hello@singletdb.com" className="text-muted-foreground hover:text-foreground transition-colors">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>
            </a>
            <span className="text-xs text-muted-foreground">© {new Date().getFullYear()}</span>
          </div>
        </div>
      </div>
    </div>
  </footer>
);

export default Footer;

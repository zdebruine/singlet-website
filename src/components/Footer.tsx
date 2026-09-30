import { Link } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { GITHUB_ISSUES, GITHUB_REPO } from "@/lib/install-snippets";

const LINKS: { label: string; to?: string; href?: string }[] = [
  { label: "Docs", to: "/docs" },
  { label: "MCP", to: "/docs/mcp" },
  { label: "Your data", to: "/my-data" },
  { label: "Brand", to: "/brand" },
  { label: "About the data", to: "/about" },
  { label: "Cite", to: "/about#cite" },
  { label: "GitHub", href: GITHUB_REPO },
];

const LEGAL = [
  { label: "Terms", to: "/terms" },
  { label: "Privacy", to: "/privacy" },
  { label: "License", to: "/data-license" },
];

const Footer = () => (
  <footer className="surface-dark mt-auto">
    <div className="container-site py-7 flex flex-col md:flex-row md:items-center gap-5 md:gap-8">
      <Logo variant="lockup" theme="dark" height={24} />
      <div className="md:flex-1 space-y-1">
        <p className="text-[13px] text-dark-muted">Data CC0 · Code MIT · No account required</p>
        {/* The support contact for the site, the API and the MCP connector (no email address exists). */}
        <p className="text-[13px] text-dark-muted">
          Contact and support (site, API, MCP connector):{" "}
          <a href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer" className="text-dark-foreground/85 underline underline-offset-2 hover:text-dark-foreground transition-colors">
            GitHub Issues
          </a>
        </p>
      </div>
      <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {LINKS.map((l) =>
          l.href ? (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] text-dark-foreground/85 hover:text-dark-foreground transition-colors"
            >
              {l.label}
            </a>
          ) : (
            <Link key={l.label} to={l.to!} className="text-[13px] text-dark-foreground/85 hover:text-dark-foreground transition-colors">
              {l.label}
            </Link>
          ),
        )}
        <span className="hidden md:inline text-dark-border">|</span>
        {LEGAL.map((l) => (
          <Link key={l.label} to={l.to} className="text-xs text-dark-muted hover:text-dark-foreground transition-colors">
            {l.label}
          </Link>
        ))}
      </nav>
    </div>
  </footer>
);

export default Footer;

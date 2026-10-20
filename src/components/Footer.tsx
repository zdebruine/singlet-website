import { Link } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { FeedbackButton } from "@/components/FeedbackDialog";
import { GITHUB_ISSUES, GITHUB_REPO } from "@/lib/install-snippets";

const LINKS: { label: string; to?: string; href?: string }[] = [
  { label: "Docs", to: "/docs" },
  { label: "MCP", to: "/docs/mcp" },
  { label: "Brand", to: "/brand" },
  { label: "About", to: "/about" },
  { label: "Cite", to: "/about#cite" },
  { label: "GitHub", href: GITHUB_REPO },
  { label: "Singlet Cloud", href: "https://cloud.singlet.bio" },
];

const LEGAL = [
  { label: "Terms", to: "/terms" },
  { label: "Privacy", to: "/privacy" },
  { label: "License", to: "/data-license" },
];

const Footer = () => (
  <footer className="mt-auto border-t border-border bg-background">
    <div className="container-site py-7 flex flex-col md:flex-row md:items-center gap-5 md:gap-8">
      <Logo variant="lockup" theme="auto" height={22} />
      <div className="md:flex-1 space-y-1">
        <p className="text-[13px] text-muted-foreground">Data and site CC0 · No account required</p>
        {/* The support contact for the site, the API and the MCP connector (no email address exists). */}
        <p className="text-[13px] text-muted-foreground">
          Contact and support (site, API, MCP connector):{" "}
          <a href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer" className="text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors">
            GitHub Issues
          </a>
          {" · "}
          <FeedbackButton className="text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors">Send feedback</FeedbackButton>
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
              className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {l.label}
            </a>
          ) : (
            <Link key={l.label} to={l.to!} className="text-[13px] text-muted-foreground hover:text-foreground transition-colors">
              {l.label}
            </Link>
          ),
        )}
        <span className="hidden md:inline text-border">|</span>
        {LEGAL.map((l) => (
          <Link key={l.label} to={l.to} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            {l.label}
          </Link>
        ))}
      </nav>
    </div>
  </footer>
);

export default Footer;

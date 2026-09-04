import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Github, Menu, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { SearchBox } from "@/components/SearchBox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/browse", label: "Browse" },
  { to: "/docs", label: "Docs" },
  { to: "/about", label: "About the data" },
];

const GITHUB = "https://github.com/Singlet-Bio/singlet";

function SignInPlaceholder({ className }: { className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn("text-[13px] text-muted-foreground hover:text-foreground transition-colors rounded px-1", className)}>
          Sign in
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3 rounded border-border">
        <p className="text-[13px] font-medium text-foreground mb-1">Coming soon</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Accounts are optional and only needed for saved searches and higher AI-search limits. Browsing and downloading never require one.
        </p>
      </PopoverContent>
    </Popover>
  );
}

const Navbar = () => {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const isHome = location.pathname === "/";
  // Home has the hero box and /browse has its own sticky search bar.
  const showSearch = !isHome && location.pathname !== "/browse";

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const isActive = (to: string) => location.pathname === to || location.pathname.startsWith(to + "/");

  return (
    <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
      <nav className="container-site h-14 flex items-center gap-6" aria-label="Main">
        <Logo size={20} />

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-5 ml-2">
          {NAV.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={cn(
                "text-[13.5px] transition-colors rounded px-0.5",
                isActive(l.to) ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {l.label}
            </Link>
          ))}
          <a
            href={GITHUB}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="GitHub repository"
          >
            <Github size={17} />
          </a>
        </div>

        <div className="flex-1" />

        {/* Right: compact search (not on home) + sign in */}
        <div className="hidden md:flex items-center gap-4">
          {showSearch && <SearchBox variant="compact" className="w-64 lg:w-72" />}
          <SignInPlaceholder />
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          className="md:hidden text-foreground p-1 rounded"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-border bg-card">
          <div className="container-site py-4 flex flex-col gap-3">
            {showSearch && <SearchBox variant="compact" className="w-full" onSubmitted={() => setOpen(false)} />}
            {NAV.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className={cn("text-sm py-1", isActive(l.to) ? "text-foreground font-medium" : "text-muted-foreground")}
              >
                {l.label}
              </Link>
            ))}
            <a href={GITHUB} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground py-1 inline-flex items-center gap-2">
              <Github size={15} /> GitHub
            </a>
            <div className="border-t border-border pt-3">
              <SignInPlaceholder className="text-sm" />
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

export default Navbar;

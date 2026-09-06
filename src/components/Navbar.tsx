import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Github, Menu, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { SearchBox } from "@/components/SearchBox";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/browse", label: "Browse" },
  { to: "/my-data", label: "Your data" },
  { to: "/quickstart", label: "Quickstart" },
  { to: "/docs", label: "Docs" },
  { to: "/about", label: "About the data" },
];

const GITHUB = "https://github.com/Singlet-Bio/singlet";

/**
 * Exactly one search input per page: the header search is hidden on pages
 * that render their own (home hero, /browse sticky bar, 404 page).
 */
const Navbar = ({ search = true }: { search?: boolean }) => {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const isHome = location.pathname === "/";
  const showSearch = search && !isHome && location.pathname !== "/browse";

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const isActive = (to: string) => location.pathname === to || location.pathname.startsWith(to + "/");

  return (
    <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
      <nav className="container-site h-14 flex items-center gap-6" aria-label="Main">
        <Logo variant="lockup" height={24} />

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

        {/* Right: compact search (not on home) + account */}
        <div className="hidden md:flex items-center gap-4">
          {showSearch && <SearchBox variant="compact" className="w-64 lg:w-72" />}
          <AccountMenu />
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
            {showSearch && <SearchBox id="site-search-mobile" variant="compact" className="w-full" onSubmitted={() => setOpen(false)} />}
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
              <AccountMenu className="text-sm" variant="menu" />
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

export default Navbar;

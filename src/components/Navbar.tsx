import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { SearchBox } from "@/components/SearchBox";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { cn } from "@/lib/utils";

/** Public navigation. "Your data" lives in the account menu, not here. */
const NAV = [
  { to: "/browse", label: "Browse" },
  { to: "/docs", label: "Docs" },
  { to: "/about", label: "About" },
];

/**
 * A plain white bar: logo on the left, three links and the account on the right.
 * Exactly one search input per page: the header search is hidden on pages that render their own
 * (home hero, /browse sticky bar, 404 page).
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
    <header className="site-navbar sticky top-0 z-40 bg-background border-b border-border">
      <nav className="container-site h-14 flex items-center gap-6" aria-label="Main">
        {!isHome && <Logo variant="lockup" theme="auto" height={24} />}

        <div className="flex-1" />

        <div className="hidden md:flex items-center gap-6">
          {showSearch && <SearchBox variant="compact" className="w-64 lg:w-72" />}
          {NAV.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={cn("text-[14px] transition-colors", isActive(l.to) ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground")}
            >
              {l.label}
            </Link>
          ))}
          <AccountMenu className="navbar-account" />
        </div>

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

      {open && (
        <div className="md:hidden border-t border-border bg-background">
          <div className="container-site py-4 flex flex-col gap-3">
            {showSearch && <SearchBox id="site-search-mobile" variant="compact" className="w-full" onSubmitted={() => setOpen(false)} />}
            {NAV.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className={cn("text-[15px] py-1", isActive(l.to) ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground")}
              >
                {l.label}
              </Link>
            ))}
            <div className="border-t border-border pt-3">
              <AccountMenu className="navbar-account text-sm" variant="menu" />
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

export default Navbar;

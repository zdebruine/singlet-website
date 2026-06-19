import { Link, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { Menu, X, Github } from "lucide-react";

const navLinks = [
  { to: "/browse", label: "Browse" },
  { to: "/docs/access", label: "Download" },
  { to: "/docs", label: "Quickstart" },
  { to: "/byod", label: "Bring your data" },
  { to: "/pipeline", label: "Pipeline" },
  { to: "/notebooks", label: "Notebooks" },
];

const Navbar = () => {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "glass-dark" : "bg-transparent"}`}>
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-0">
          <span className="font-display font-bold text-[1.45rem] tracking-tightest text-foreground">singlet</span>
          <span className="inline-flex items-center justify-center" style={{ width: '1ch', paddingLeft: '0.15ch' }}>
            <svg className="inline-block" style={{ height: '0.52em', width: '0.52em' }} viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
              <circle cx="5" cy="5" r="5" fill="hsl(174 84% 32%)" />
            </svg>
          </span>
          <span className="font-display font-bold text-[1.45rem] tracking-tightest text-primary">bio</span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden lg:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`text-sm transition-colors ${location.pathname === link.to || location.pathname.startsWith(link.to + "/") ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {link.label}
            </Link>
          ))}
          <a
            href="https://github.com/Singlet-Bio/singlet"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <Github size={18} />
          </a>
        </div>

        {/* Desktop Right */}
        <div className="hidden lg:flex items-center gap-3">
          <Link to="/docs" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Quickstart
          </Link>
          <Link
            to="/browse"
            className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Browse the atlas
          </Link>
        </div>

        {/* Mobile Toggle */}
        <button className="lg:hidden text-foreground" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="lg:hidden glass-dark px-6 py-4 flex flex-col gap-3 animate-fade-in">
          {navLinks.map((link) => (
            <Link key={link.to} to={link.to} className="text-sm text-foreground py-1" onClick={() => setMobileOpen(false)}>
              {link.label}
            </Link>
          ))}
          <a href="https://github.com/Singlet-Bio" target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground py-1">
            GitHub
          </a>
          <div className="border-t border-border pt-3 mt-1 flex flex-col gap-3">
            <Link to="/docs" className="text-sm text-muted-foreground" onClick={() => setMobileOpen(false)}>Quickstart</Link>
            <Link to="/browse" className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium" onClick={() => setMobileOpen(false)}>
              Browse the atlas
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;

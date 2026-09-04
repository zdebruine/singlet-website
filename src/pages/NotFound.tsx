import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { SearchBox } from "@/components/SearchBox";
import { usePageMeta } from "@/hooks/usePageMeta";

/** Looks like a GEO accession the visitor may have typed into the URL bar. */
const ACCESSION_RE = /\b(GSE\d{3,7}|GSM\d{3,8})\b/i;

const NotFound = () => {
  const location = useLocation();
  usePageMeta({ title: "Page not found", noindex: true });

  useEffect(() => {
    console.warn("404: no route for", location.pathname);
  }, [location.pathname]);

  const acc = ACCESSION_RE.exec(decodeURIComponent(location.pathname))?.[1]?.toUpperCase();
  const accHref = acc ? (acc.startsWith("GSE") ? `/study/${acc}` : `/sample/${acc}`) : null;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="container-site flex-1 py-20 md:py-24">
        <div className="mx-auto max-w-[720px] text-center">
          <p className="font-mono text-sm text-muted-foreground mb-2">404</p>
          <h1 className="text-[28px] md:text-[32px] font-semibold tracking-tight mb-3">Page not found</h1>
          <p className="text-muted-foreground mb-6">
            There is nothing at <span className="font-mono text-foreground break-all">{location.pathname}</span>.
            {accHref && (
              <>
                {" "}
                Looking for{" "}
                <Link to={accHref} className="font-mono text-primary hover:underline">
                  {acc}
                </Link>
                ?
              </>
            )}
          </p>
          <div className="text-left">
            <SearchBox variant="hero" />
          </div>
          <p className="mt-2.5 text-[13px] text-muted-foreground">
            Search by GEO accession (GSE…, GSM…), keyword, or plain English.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link to="/" className="btn-primary btn-sm">
              Home
            </Link>
            <Link to="/browse" className="btn-secondary btn-sm">
              Browse the atlas
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default NotFound;

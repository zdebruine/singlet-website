import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { usePageMeta } from "@/hooks/usePageMeta";

const NotFound = () => {
  const location = useLocation();
  usePageMeta({ title: "Page not found", noindex: true });

  useEffect(() => {
    console.error("404: no route for", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="container-site flex-1 py-24 text-center">
        <p className="font-mono text-sm text-muted-foreground mb-2">404</p>
        <h1 className="text-[28px] mb-3">Page not found</h1>
        <p className="text-muted-foreground mb-6">
          There is nothing at <span className="font-mono text-foreground">{location.pathname}</span>.
        </p>
        <div className="flex justify-center gap-3">
          <Link to="/" className="btn-primary btn-sm">Home</Link>
          <Link to="/browse" className="btn-secondary btn-sm">Browse the atlas</Link>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default NotFound;

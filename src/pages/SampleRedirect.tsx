import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { apiClient } from "@/integrations/api/client";
import { usePageMeta } from "@/hooks/usePageMeta";

/**
 * /sample/:gsmId → /study/<gse>#<gsm>
 * There are no per-sample pages or files; a sample is a row in its study.
 */
const SampleRedirect = () => {
  const { gsmId } = useParams<{ gsmId: string }>();
  const gsm = (gsmId ?? "").toUpperCase();
  const navigate = useNavigate();
  usePageMeta({ title: gsm, path: `/sample/${gsm}`, noindex: true });

  const { data, isError } = useQuery({
    queryKey: ["sample-redirect", gsm],
    queryFn: () => apiClient.gsm(gsm),
    enabled: !!gsm,
    retry: 1,
    staleTime: 300_000,
  });

  useEffect(() => {
    const gse = data?.sample?.gse_id ?? data?.series?.id;
    if (gse) navigate(`/study/${gse}#${gsm}`, { replace: true });
  }, [data, gsm, navigate]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="container-site flex-1 py-20 text-center">
        {isError ? (
          <>
            <h1 className="text-2xl mb-2">Sample not found</h1>
            <p className="text-muted-foreground mb-5">
              <span className="font-mono">{gsm}</span> is not in the catalog.
            </p>
            <Link to="/browse" className="btn-secondary btn-sm">Browse the atlas</Link>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Opening the study for <span className="font-mono text-foreground">{gsm}</span>…
          </p>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default SampleRedirect;

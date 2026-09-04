import { useEffect, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider } from "@/components/auth/AuthProvider";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Docs from "./pages/Docs.tsx";
import About from "./pages/About.tsx";
import Browse from "./pages/Browse.tsx";
import StudyDetail from "./pages/StudyDetail.tsx";
import SampleRedirect from "./pages/SampleRedirect.tsx";
import DataLicense from "./pages/DataLicense.tsx";
import Terms from "./pages/Terms.tsx";
import Privacy from "./pages/Privacy.tsx";
import SplicePatternSpec from "./pages/SplicePatternSpec.tsx";
import HpcDashboard from "./pages/HpcDashboard.tsx";
import AuthCallback from "./pages/AuthCallback.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Client errors (4xx) will not change on retry; give transient failures one more go.
      retry: (failureCount, error) => {
        const status = (error as { status?: number } | null)?.status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 1;
      },
    },
  },
});

/** Route-level error boundary that resets whenever the URL changes. */
function RouteBoundary({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  return <ErrorBoundary resetKey={pathname + search}>{children}</ErrorBoundary>;
}

/** /series/:gse → /study/:gse (the edge also 301s this; this covers client-side nav). */
function SeriesRedirect() {
  const { gseId } = useParams<{ gseId: string }>();
  return <Navigate to={`/study/${(gseId ?? "").toUpperCase()}`} replace />;
}

/** External redirect (notebooks live on GitHub). */
function ExternalRedirect({ href }: { href: string }) {
  useEffect(() => {
    window.location.replace(href);
  }, [href]);
  return null;
}

/** Reset scroll on route change, except when navigating to a hash. */
function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

const NOTEBOOKS_URL = "https://github.com/Singlet-Bio/singlet/tree/main/notebooks";

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ScrollToTop />
        <AuthProvider>
          <RouteBoundary>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/browse" element={<Browse />} />
              <Route path="/study/:gse" element={<StudyDetail />} />
              <Route path="/docs" element={<Docs />} />
              <Route path="/about" element={<About />} />

              {/* Accessions */}
              <Route path="/series/:gseId" element={<SeriesRedirect />} />
              <Route path="/sample/:gsmId" element={<SampleRedirect />} />

              {/* Sign-in round-trip (email link / Google) */}
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/auth" element={<Navigate to="/auth/callback" replace />} />

              {/* Legal + technical reference (linked from footer / docs) */}
              <Route path="/data-license" element={<DataLicense />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/specs/splice-patterns" element={<SplicePatternSpec />} />
              <Route path="/hpc-dashboard" element={<HpcDashboard />} />

              {/* Retired routes → their new home */}
              <Route path="/download" element={<Navigate to="/docs#install" replace />} />
              <Route path="/docs/access" element={<Navigate to="/docs" replace />} />
              <Route path="/docs/data-objects" element={<Navigate to="/docs#singlet-file" replace />} />
              <Route path="/byod" element={<Navigate to="/docs#pipeline" replace />} />
              <Route path="/pipeline" element={<Navigate to="/about#status" replace />} />
              <Route path="/notebooks" element={<ExternalRedirect href={NOTEBOOKS_URL} />} />
              <Route path="/benchmarks" element={<Navigate to="/" replace />} />
              <Route path="/blog" element={<Navigate to="/" replace />} />
              <Route path="/blog/*" element={<Navigate to="/" replace />} />
              <Route path="/validation" element={<Navigate to="/browse" replace />} />
              <Route path="/atlas-docs" element={<Navigate to="/docs" replace />} />
              <Route path="/dashboard" element={<Navigate to="/" replace />} />
              <Route path="/invest" element={<Navigate to="/" replace />} />
              <Route path="/invest/*" element={<Navigate to="/" replace />} />
              <Route path="/pricing" element={<Navigate to="/" replace />} />
              <Route path="/enterprise" element={<Navigate to="/" replace />} />
              <Route path="/intelligence" element={<Navigate to="/" replace />} />
              <Route path="/target-explorer" element={<Navigate to="/" replace />} />
              <Route path="/gene-programs" element={<Navigate to="/" replace />} />
              <Route path="/dev-progress" element={<Navigate to="/" replace />} />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </RouteBoundary>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

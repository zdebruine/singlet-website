import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Docs from "./pages/Docs.tsx";
import DocsAccess from "./pages/DocsAccess.tsx";
import DataLicense from "./pages/DataLicense.tsx";
import BYOD from "./pages/BYOD.tsx";
import Terms from "./pages/Terms.tsx";
import Privacy from "./pages/Privacy.tsx";
import Browse from "./pages/Browse.tsx";
import SampleDetail from "./pages/SampleDetail.tsx";
import SeriesDetail from "./pages/SeriesDetail.tsx";
import Benchmarks from "./pages/Benchmarks.tsx";
import Pipeline from "./pages/Pipeline.tsx";
import Blog from "./pages/Blog.tsx";
import BlogPost from "./pages/BlogPost.tsx";
import Notebooks from "./pages/Notebooks.tsx";
import SplicePatternSpec from "./pages/SplicePatternSpec.tsx";
import DataObjects from "./pages/DataObjects.tsx";
import HpcDashboard from "./pages/HpcDashboard.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/docs/access" element={<DocsAccess />} />
          <Route path="/docs/data-objects" element={<DataObjects />} />
          <Route path="/data-license" element={<DataLicense />} />
          <Route path="/byod" element={<BYOD />} />
          <Route path="/hpc-dashboard" element={<HpcDashboard />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/sample/:gsmId" element={<SampleDetail />} />
          <Route path="/series/:gseId" element={<SeriesDetail />} />
          <Route path="/benchmarks" element={<Benchmarks />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/blog/:slug" element={<BlogPost />} />
          <Route path="/notebooks" element={<Notebooks />} />
          <Route path="/specs/splice-patterns" element={<SplicePatternSpec />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          {/* Retired pages (model/investor/pricing/auth) → home */}
          <Route path="/auth" element={<Navigate to="/" replace />} />
          <Route path="/dashboard" element={<Navigate to="/" replace />} />
          <Route path="/invest/*" element={<Navigate to="/" replace />} />
          <Route path="/invest" element={<Navigate to="/" replace />} />
          <Route path="/pricing" element={<Navigate to="/" replace />} />
          <Route path="/enterprise" element={<Navigate to="/" replace />} />
          <Route path="/intelligence" element={<Navigate to="/" replace />} />
          <Route path="/target-explorer" element={<Navigate to="/" replace />} />
          <Route path="/gene-programs" element={<Navigate to="/" replace />} />
          <Route path="/dev-progress" element={<Navigate to="/" replace />} />
          <Route path="/validation" element={<Navigate to="/browse" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import ProtectedRoute from "@/components/ProtectedRoute";
import Index from "./pages/Index.tsx";
import Invest from "./pages/Invest.tsx";


import PricingPage from "./pages/Pricing.tsx";
import Auth from "./pages/Auth.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import NotFound from "./pages/NotFound.tsx";
import Docs from "./pages/Docs.tsx";
import DataLicense from "./pages/DataLicense.tsx";
import GenePrograms from "./pages/GenePrograms.tsx";
import TargetExplorer from "./pages/TargetExplorer.tsx";
import BYOD from "./pages/BYOD.tsx";
import Enterprise from "./pages/Enterprise.tsx";
import IntelligenceLayers from "./pages/IntelligenceLayers.tsx";
import DevProgress from "./pages/DevProgress.tsx";
import Terms from "./pages/Terms.tsx";
import Privacy from "./pages/Privacy.tsx";
import Browse from "./pages/Browse.tsx";
import SampleDetail from "./pages/SampleDetail.tsx";
import Validation from "./pages/Validation.tsx";
import Benchmarks from "./pages/Benchmarks.tsx";
import Pipeline from "./pages/Pipeline.tsx";
import Blog from "./pages/Blog.tsx";
import BlogPost from "./pages/BlogPost.tsx";
import SeriesDetail from "./pages/SeriesDetail.tsx";
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
          <Route path="/invest" element={<Invest />} />

          
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/data-license" element={<DataLicense />} />
          <Route path="/gene-programs" element={<GenePrograms />} />
          <Route path="/target-explorer" element={<TargetExplorer />} />
          <Route path="/byod" element={<BYOD />} />
          <Route path="/enterprise" element={<Enterprise />} />
          <Route path="/intelligence" element={<IntelligenceLayers />} />
          <Route path="/dev-progress" element={<DevProgress />} />
          <Route path="/hpc-dashboard" element={<HpcDashboard />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/sample/:gsmId" element={<SampleDetail />} />
          <Route path="/series/:gseId" element={<SeriesDetail />} />
          <Route path="/validation" element={<Validation />} />
          <Route path="/benchmarks" element={<Benchmarks />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/blog/:slug" element={<BlogPost />} />
          <Route path="/notebooks" element={<Notebooks />} />
          <Route path="/specs/splice-patterns" element={<SplicePatternSpec />} />
          <Route path="/docs/data-objects" element={<DataObjects />} />
          
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

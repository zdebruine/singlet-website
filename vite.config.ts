import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Committed non-secret build-time default for the R2 public base URL.
  // Overridable by a VITE_R2_PUBLIC_URL env var (e.g. a Cloudflare Pages build var).
  define: {
    "import.meta.env.VITE_R2_PUBLIC_URL": JSON.stringify(
      process.env.VITE_R2_PUBLIC_URL ?? "https://data.singlet.bio",
    ),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
}));

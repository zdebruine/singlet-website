import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

/**
 * Cloudflare Pages builds from the git checkout, which has no `.env` (it is
 * ignored). Without these values the auth client is constructed with
 * `undefined` and every sign-in fails with "supabaseUrl is required".
 * Both values are public by design (RLS protects the data), so they are
 * compiled in as fallbacks whenever the environment does not provide them.
 */
const CLOUD_FALLBACK = {
  VITE_SUPABASE_URL: "https://vbswbitfyallghbgxkuw.supabase.co",
  VITE_SUPABASE_PROJECT_ID: "vbswbitfyallghbgxkuw",
  VITE_SUPABASE_PUBLISHABLE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZic3diaXRmeWFsbGdoYmd4a3V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjkzNDksImV4cCI6MjA5MDIwNTM0OX0.GtX_3p0L78p0KqmgNY71ENagf-lugz5FhvhYrtKqLhs",
} as const;

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: Object.fromEntries(
    Object.entries(CLOUD_FALLBACK)
      .filter(([k]) => !loadEnv(mode, process.cwd(), "VITE_")[k])
      .map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)]),
  ),
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    // The /api/* routes are Cloudflare Pages Functions (functions/api/*), which
    // do not run under the Vite dev server. Proxy them to production so the
    // local preview shows live data. Override with VITE_API_PROXY_TARGET.
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET ?? "https://singlet.bio",
        changeOrigin: true,
        secure: true,
      },
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

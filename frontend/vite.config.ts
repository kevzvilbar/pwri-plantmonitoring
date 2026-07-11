import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(({ mode }) => ({
  base: '/pwri-plantmonitoring/',
  envPrefix: ["VITE_", "REACT_APP_"],
  server: {
    host: "0.0.0.0",
    port: 5000,
    allowedHosts: true,
    hmr: {
      overlay: false,
      clientPort: 443,
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  build: {
    chunkSizeWarningLimit: 1200,

    // Generate manifest.json so you can verify deployed chunk names.
    manifest: true,

    rollupOptions: {
      output: {
        /**
         * Manual chunk grouping — reduces 21 separate page chunks down to 6.
         *
         * WHY THIS MATTERS:
         * Every lazy-loaded page becomes its own .js file with a content hash
         * in its filename (e.g. Operations-BIBkQB0q.js). On each deployment,
         * ALL filenames change (new hash). If a user's browser has cached the
         * old index.html, it tries to fetch the old filenames → 404 →
         * "Failed to fetch dynamically imported module".
         *
         * Grouping pages reduces the number of separate chunk files from 21 to 6,
         * which means fewer files that can go stale and fewer fetches that can fail.
         *
         * Groups are chosen by usage pattern:
         *   core-ops   — the pages operators open most (heavy, change often)
         *   dashboard  — home + analytics (visited first on login)
         *   admin      — management pages (visited less often)
         *   reports    — costs, compliance, exports (management use)
         *   onboarding — auth flow (tiny, rarely changed)
         *   tools      — import, AI, misc (standalone utilities)
         */
        manualChunks(id: string) {
          // Vendor: keep large third-party libs in a single stable chunk
          if (id.includes('node_modules')) {
            // Supabase client — large, rarely changes
            if (id.includes('@supabase')) return 'vendor-supabase';
            // React + react-dom + react-query — core runtime
            if (
              id.includes('react-dom') ||
              id.includes('react/') ||
              id.includes('@tanstack/react-query') ||
              id.includes('@tanstack/query-core')
            ) return 'vendor-react';
            // Charting libs
            if (
              id.includes('recharts') ||
              id.includes('chart.js') ||
              id.includes('d3-') ||
              id.includes('victory')
            ) return 'vendor-charts';
            // All other node_modules
            return 'vendor-misc';
          }

          // Page chunks — group by usage pattern
          const p = id.replace(/\\/g, '/');

          if (
            p.includes('/pages/Operations') ||
            p.includes('/pages/ROTrains')
          ) return 'chunk-ops';          // Used daily by operators

          if (
            p.includes('/pages/Dashboard') ||
            p.includes('/pages/DataAnalysis')
          ) return 'chunk-dashboard';    // First page seen on login

          if (
            p.includes('/pages/Admin') ||
            p.includes('/pages/Plants') ||
            p.includes('/pages/Employees') ||
            p.includes('/pages/PlantTopology') ||
            p.includes('/pages/Profile')
          ) return 'chunk-admin';        // Management + settings

          if (
            p.includes('/pages/Costs') ||
            p.includes('/pages/Compliance') ||
            p.includes('/pages/Exports') ||
            p.includes('/pages/Maintenance') ||
            p.includes('/pages/Incidents') ||
            p.includes('/pages/Chemicals')
          ) return 'chunk-reports';      // Reporting & compliance

          if (
            p.includes('/pages/Auth') ||
            p.includes('/pages/Onboarding') ||
            p.includes('/pages/PendingApproval')
          ) return 'chunk-auth';         // Auth flow — tiny, rarely changes

          if (
            p.includes('/pages/Import') ||
            p.includes('/pages/AIAssistant') ||
            p.includes('/pages/NotFound')
          ) return 'chunk-tools';        // Utilities

          // Shared app components (hooks, lib, integrations)
          if (
            p.includes('/src/components/') ||
            p.includes('/src/hooks/') ||
            p.includes('/src/lib/') ||
            p.includes('/src/integrations/')
          ) return 'chunk-shared';
        },
      },
    },
  },
}));

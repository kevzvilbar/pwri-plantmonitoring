import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(({ mode }) => ({
  base: process.env.VERCEL ? '/' : '/pwri-plantmonitoring/',
  envPrefix: ["VITE_"],
  server: {
    host: "0.0.0.0",
    port: 5000,
    allowedHosts: true,
    hmr: {
      overlay: false,
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
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // 2026-08-17: split vendor code out of the shared "index" chunk.
        // Measured before/after on this exact codebase (npm run build):
        //   before: one 733.9 kB / 218.2 kB gz chunk, welding
        //           react/react-dom/react-router, @supabase/*, @radix-ui/*,
        //           and date-fns to app code that changes on every commit.
        //   after:  220.8 kB / 65.2 kB gz app chunk +
        //           vendor-react (187.9 kB / 62.1 kB gz) +
        //           vendor-supabase (196.5 kB / 51.7 kB gz) +
        //           vendor-radix (120.5 kB / 36.6 kB gz) +
        //           vendor-date-fns (28.7 kB / 8.3 kB gz)
        // Total gzip bytes are roughly flat (this isn't a size reduction --
        // it's the same code, split into more pieces, which loses a little
        // cross-chunk gzip redundancy). The actual win is cache lifetime:
        // these four vendor groups rarely change between commits, but were
        // previously re-downloaded by every returning user on every deploy
        // because they lived inside the one chunk that changes whenever any
        // app code does. Split out, ~530 kB raw of vendor code now survives
        // across deploys in the browser cache; only the ~220 kB app chunk
        // needs re-fetching after a typical commit.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@supabase")) return "vendor-supabase";
          if (id.includes("react-dom") || id.match(/node_modules\/react\//) || id.includes("react-router") || id.includes("@remix-run")) return "vendor-react";
          if (id.includes("@radix-ui")) return "vendor-radix";
          if (id.includes("date-fns")) return "vendor-date-fns";
        },
      },
    },
  },
}));

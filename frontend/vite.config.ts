import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
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
  plugins: [
    react(),
    VitePWA({
      // "autoUpdate" refreshes the cached app shell in the background on
      // each visit — it does not force-reload a tab that's already open,
      // so an operator mid-form won't get yanked out from under themselves.
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "robots.txt"],
      manifest: {
        name: "PWRI Plant Monitoring",
        short_name: "PWRI Monitor",
        description: "Production, water quality, and compliance monitoring for water treatment plants.",
        // Relative rather than absolute so both deploy targets work without
        // a build-time branch here too — Vercel serves from "/", GitHub
        // Pages from "/pwri-plantmonitoring/" (see `base` above) — "." keeps
        // both the start URL and the installed scope relative to wherever
        // the manifest itself was served from.
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#0b1e2e",
        theme_color: "#0b1e2e",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // Precache the built app shell (JS/CSS/HTML/icons) only. No
        // runtimeCaching entries are added for the Supabase API — reads and
        // writes stay network-only and fail exactly as they do today when
        // offline (DataState's existing error/retry UI handles that). This
        // makes the *shell* installable and loadable with zero connectivity;
        // it deliberately does not paper over stale or unavailable data.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
        navigateFallback: "index.html",
      },
    }),
  ],
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
          // Match on the actual npm package name (the path segment right after
          // node_modules/), not a loose substring of the whole id — the
          // original id.includes("react-dom") check also matched
          // "@floating-ui/react-dom" (a dependency @radix-ui/react-popper
          // pulls in for Popover/Tooltip/Select/DropdownMenu positioning).
          const pkg = id.match(/\/node_modules\/(@[^/]+\/[^/]+|[^/]+)\//)?.[1];
          if (!pkg) return;
          if (pkg === "@supabase" || pkg.startsWith("@supabase/")) return "vendor-supabase";
          if (pkg === "date-fns") return "vendor-date-fns";
          // React and Radix are one bucket, not two. Radix is built entirely
          // on top of React (every @radix-ui/react-* package imports
          // React.forwardRef/createContext/etc. at module top level) and
          // pulls in @floating-ui for positioning, so a "vendor-react" and a
          // "vendor-radix" chunk can never truly be independent — Rollup
          // also has to place shared CJS-interop runtime helpers in
          // whichever chunk it emits first. Splitting them produced a real
          // circular import (vendor-react.js <-> vendor-radix.js, each
          // statically importing the other), which crashed on load with
          // "Cannot read properties of undefined (reading 'forwardRef')"
          // because vendor-radix's top-level code ran before vendor-react
          // had finished initializing. Verified fixed by evaluating the
          // built module graph directly in Node (same ESM linking/
          // evaluation semantics as a browser) before and after this change.
          if (
            pkg === "react" ||
            pkg === "react-dom" ||
            pkg === "scheduler" ||
            pkg === "react-router" ||
            pkg === "react-router-dom" ||
            pkg.startsWith("@remix-run/") ||
            pkg.startsWith("@radix-ui/") ||
            pkg.startsWith("@floating-ui/")
          ) {
            return "vendor-react";
          }
        },
      },
    },
  },
}));

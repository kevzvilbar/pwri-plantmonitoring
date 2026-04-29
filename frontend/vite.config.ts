import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
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
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
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
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("recharts") || id.includes("d3-")) return "vendor-charts";
          if (id.includes("@radix-ui")) return "vendor-radix";
          if (id.includes("@supabase")) return "vendor-supabase";
          if (id.includes("@tanstack")) return "vendor-query";
          if (id.includes("react-router")) return "vendor-router";
          if (id.includes("react-hook-form") || id.includes("@hookform") || id.includes("zod")) return "vendor-forms";
          if (id.includes("date-fns") || id.includes("react-day-picker")) return "vendor-dates";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("scheduler")
          ) {
            return "vendor-react";
          }
        },
      },
    },
  },
}));

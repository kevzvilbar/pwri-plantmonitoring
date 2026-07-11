import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "autoUpdate",
        devOptions: {
          enabled: false,
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
          maximumFileSizeToCacheInBytes: 10000000,
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/[a-c]\.tile\.openstreetmap\.org\/.*/i,
              handler: "CacheFirst",
              options: {
                cacheName: "osm-tiles-cache",
                expiration: {
                  maxEntries: 1000,
                  maxAgeSeconds: 60 * 60 * 24 * 30, // 30 Days
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        manifest: {
          name: "BPWI Field Ops",
          short_name: "BPWI",
          description: "BPWI Field Ops Application",
          theme_color: "#056374",
          icons: [
            {
              src: "favicon.ico",
              sizes: "64x64 32x32 24x24 16x16",
              type: "image/x-icon",
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
      dedupe: ["react", "react-dom"],
    },
    define: {
      "process.env.GOOGLE_MAPS_PLATFORM_KEY": JSON.stringify(
        process.env.GOOGLE_MAPS_PLATFORM_KEY || "",
      ),
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== "true",
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === "true" ? null : {},
    },
  };
});

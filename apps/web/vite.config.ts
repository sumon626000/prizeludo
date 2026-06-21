import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

const localApiProxy = {
  "/api": {
    target: "http://127.0.0.1:4000",
    changeOrigin: true,
  },
  "/socket.io": {
    target: "http://127.0.0.1:4000",
    ws: true,
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["prizejito-logo.png", "avatar-leaf.svg"],
      manifest: {
        name: "PrizeJito.com",
        short_name: "PrizeJito",
        description: "Real-time Ludo tournament platform",
        theme_color: "#0a2818",
        background_color: "#020a06",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        lang: "bn",
        icons: [
          {
            src: "/prizejito-logo.png",
            sizes: "657x634",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
    proxy: localApiProxy,
  },
  preview: {
    port: 5173,
    host: true,
    proxy: localApiProxy,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});

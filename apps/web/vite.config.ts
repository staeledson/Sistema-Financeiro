import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: {
    proxy: {
      "/api/auth": {
        target: "http://localhost:3100",
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:3100",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  plugins: [
    vue(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Finanças IA",
        short_name: "Finanças",
        description: "Gestão financeira pessoal com inteligência artificial",
        theme_color: "#ffffff",
        background_color: "#f6f5f2",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
        share_target: {
          action: "/lancar/compartilhado",
          method: "POST",
          enctype: "multipart/form-data",
          params: { title: "title", text: "text", url: "url", files: [{ name: "image", accept: ["image/*"] }] },
        },
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // SPA com vue-router (history): qualquer navegação cai no index.html, exceto a API.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api/],
        // Sem runtimeCaching de /api: o cache por URL ignoraria Authorization e workspace e vazaria dados entre usuários.
      },
    }),
  ],
});

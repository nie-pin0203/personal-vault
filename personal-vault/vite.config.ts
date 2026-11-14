import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import process from "node:process";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const token = env.VITE_SUPABASE_ANON_KEY;
  if (token) {
    let isPublic = token.startsWith("sb_publishable_");
    try {
      isPublic ||=
        JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())
          .role === "anon";
    } catch {}
    if (!isPublic)
      throw new Error(
        "Supabase 配置必须使用 publishable 或 anon key，已停止构建。",
      );
  }
  return {
    base: env.VITE_BASE_PATH || "./",
    plugins: [
      react(),
      VitePWA({
        registerType: "prompt",
        manifestFilename: "manifest.json",
        manifest: {
          name: "密屿 · 个人密码管家",
          short_name: "密屿",
          lang: "zh-CN",
          start_url: ".",
          scope: ".",
          display: "standalone",
          background_color: "#f5f6f2",
          theme_color: "#244e47",
          icons: [
            { src: "icon-192.png", sizes: "192x192", type: "image/png" },
            {
              src: "icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,png,woff2}"],
          navigateFallback: "index.html",
          navigateFallbackDenylist: [/\/auth\//],
          runtimeCaching: [],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
  };
});

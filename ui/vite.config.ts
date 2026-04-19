import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Upiqal UI is always served inside a Tauri webview in production. During
// development (`npm run dev`) Vite runs on 5173 and Tauri connects to it.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // Chromium (Edge WebView2), WebKitGTK, WKWebView — all modern.
    target: ["es2022", "safari14"],
    sourcemap: true,
  },
});

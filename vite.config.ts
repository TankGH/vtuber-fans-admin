import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Tauri 使用固定端口；clearScreen 关闭以免 Rust 侧日志被清空
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  clearScreen: false,
  server: {
    host: "0.0.0.0",
    port: 1420,
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    target: "es2020",
    outDir: "dist",
    sourcemap: false,
    // recharts 单独成块约 540 kB，属于已知体积，不因该 vendor 块告警
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // 图表库体积较大，单独成块避免挤压首屏包
        manualChunks: { charts: ["recharts"] },
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
  },
});

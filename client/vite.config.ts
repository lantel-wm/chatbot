import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const outDir = fileURLToPath(new URL("../dist/client", import.meta.url));
const clientPort = Number(process.env.CLIENT_PORT ?? 5173);

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: clientPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true
      }
    }
  },
  build: {
    outDir,
    emptyOutDir: true
  }
});

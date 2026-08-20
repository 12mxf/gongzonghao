import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "src/ui",
  build: { outDir: "../../dist/client", emptyOutDir: true },
  server: {
    port: 4310,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4311",
      "/output": "http://127.0.0.1:4311"
    }
  }
});

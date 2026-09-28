import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";

// https://vitejs.dev/config/
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    wasm()
  ],
  build: {
    target: "esnext"
  },
  esbuild: {
    supported: {
      "top-level-await": true
    }
  }
});

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: "@travelos/design-system/styles.css",
        replacement: fileURLToPath(
          new URL("../../packages/design-system/src/styles.css", import.meta.url),
        ),
      },
      {
        find: "@travelos/design-system",
        replacement: fileURLToPath(
          new URL("../../packages/design-system/src/index.ts", import.meta.url),
        ),
      },
    ],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
});

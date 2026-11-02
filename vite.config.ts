import { defineConfig } from "vite";

// `base: "./"` keeps asset paths relative, so the build works on GitHub Pages or in a sub-folder of a website.
export default defineConfig({
  base: "./",
  build: { target: "es2022", chunkSizeWarningLimit: 2600 }
});

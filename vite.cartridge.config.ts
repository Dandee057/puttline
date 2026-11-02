import { defineConfig } from "vite";

/**
 * The cartridge build: the whole game (three.js and the Rapier physics engine included) as one plain script,
 * dist-cartridge/puttline-engine.js, for the handheld consoles on dandeegames.com and the arcade cabinets in
 * Three Lab. cartridge/puttline.js is the small loader those sites include; it fetches this file on demand.
 */
export default defineConfig({
  publicDir: false,
  build: {
    target: "es2022",
    outDir: "dist-cartridge",
    emptyOutDir: true,
    lib: { entry: "src/cartridge.ts", name: "PuttlineEngine", formats: ["iife"], fileName: () => "puttline-engine.js" },
    minify: true,
    chunkSizeWarningLimit: 4000
  }
});

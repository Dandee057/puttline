// Puts the loader and the cover next to the built engine, so dist-cartridge/ is the whole cartridge folder:
// copy it to games/puttline/ on the website, or public/games/puttline/ in Three Lab.
import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";

for (const f of readdirSync("cartridge")) copyFileSync(`cartridge/${f}`, `dist-cartridge/${f}`);
for (const f of readdirSync("dist-cartridge")) console.log(`  dist-cartridge/${f}  ${(statSync(`dist-cartridge/${f}`).size / 1024).toFixed(0)} kB`);
if (!existsSync("dist-cartridge/cover.jpg")) console.warn("  (no cover.jpg in cartridge/)");

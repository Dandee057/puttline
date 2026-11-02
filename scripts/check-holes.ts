/**
 * npm run check-holes: searches for a way to finish every hole within par and saves the shots to
 * tests/solutions.json, which the tests replay. Run it after changing a hole.
 *   npm run check-holes -- 5     only hole 5
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { HOLES } from "../src/course/holes.ts";
import { initPhysics } from "../src/game/physics.ts";
import { solve, type Solution } from "../src/game/solver.ts";

await initPhysics();
const file = new URL("../tests/solutions.json", import.meta.url);
const saved: Solution[] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
const only = process.argv[2] ? Number(process.argv[2]) - 1 : -1;

let failed = 0;
for (const [i, def] of HOLES.entries()) {
  if (only >= 0 && i !== only) continue;
  const t0 = performance.now();
  let sol: Solution | null = null;
  for (const seed of [7, 11, 23, 42]) { sol = solve(def, { seed }); if (sol) break; }
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  if (sol) {
    saved[i] = sol;
    console.log(`Hole ${i + 1} ${def.name.padEnd(13)} par ${def.par}: done in ${sol.shots.length} (searched ${secs}s)`);
  } else {
    failed++;
    console.log(`Hole ${i + 1} ${def.name.padEnd(13)} par ${def.par}: NO WAY FOUND within par (searched ${secs}s)`);
  }
}
// full precision: the replay has to be exact
writeFileSync(file, JSON.stringify(saved, null, 1) + "\n");
process.exitCode = failed ? 1 : 0;

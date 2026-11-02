/**
 * npm run check-holes: searches for a way to finish every hole within par and saves the shots to
 * tests/solutions.json, which the tests replay. Run it after changing a hole.
 *   npm run check-holes -- 5     only hole 5
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { HOLES } from "../src/course/holes.ts";
import { initPhysics } from "../src/game/physics.ts";
import { solve, solveAce, type Solution } from "../src/game/solver.ts";

await initPhysics();
const file = new URL("../tests/solutions.json", import.meta.url);
const saved: Solution[] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
const only = process.argv[2] ? Number(process.argv[2]) - 1 : -1;
// PUTTLINE_OUT=file writes just this run's hole there, so holes can be checked in parallel and merged
const out = process.env.PUTTLINE_OUT;

let failed = 0;
for (const [i, def] of HOLES.entries()) {
  if (only >= 0 && i !== only) continue;
  const t0 = performance.now();
  let sol: Solution | null = null;
  for (const seed of [7, 11, 23, 42]) { sol = solve(def, { seed }); if (sol) break; }
  const t1 = performance.now();
  let ace: Solution["ace"] | null = null;
  for (const seed of [5, 9, 13]) { ace = solveAce(def, { seed }); if (ace) break; }
  const secs = ((performance.now() - t0) / 1000).toFixed(1), aceSecs = ((performance.now() - t1) / 1000).toFixed(1);
  const label = `Hole ${i + 1} ${def.name.padEnd(13)} par ${def.par}:`;
  if (sol) console.log(`${label} safe way round in ${sol.shots.length}`);
  else { failed++; console.log(`${label} NO WAY FOUND within par`); }
  if (ace) console.log(`${" ".repeat(label.length)} hole in one by "${def.shortcut ?? "the cup"}" found (searched ${aceSecs}s)`);
  else { failed++; console.log(`${" ".repeat(label.length)} NO HOLE IN ONE FOUND (searched ${aceSecs}s)`); }
  if (sol) saved[i] = { ...sol, ...(ace ? { ace } : {}) };
  void secs;
}
// full precision: the replay has to be exact
if (out) writeFileSync(out, JSON.stringify(saved[only] ?? null));
else writeFileSync(file, JSON.stringify(saved, null, 1) + "\n");
process.exitCode = failed ? 1 : 0;

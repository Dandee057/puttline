import { buildHole, type Course } from "../course/build.ts";
import type { HoleDef } from "../course/parse.ts";
import { DT, Sim } from "./physics.ts";
import { distanceField, remaining } from "./route.ts";

/**
 * Finds a way to finish a hole, to prove every hole is playable within par. It's a small beam search: from each
 * position, try a spread of shots (direction, strength, and how long to wait first, which matters for the windmill
 * and moving blocks), keep the few that end nearest the cup by walking distance, and search on from those.
 * Used by `npm run check-holes` while designing holes; the shots it finds are replayed by the tests.
 */

export interface Shot { dx: number; dz: number; power: number; wait: number }
export interface Solution { hole: string; par: number; shots: Shot[]; /** A hole in one by the shortcut. */ ace?: Shot }

interface Node { pos: [number, number, number]; time: number; shots: Shot[]; score: number }

/** A tiny seeded random generator, so a search gives the same answer every run. */
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}

/** Play one shot from a fresh simulation at a position and time. */
export function playShot(course: Course, def: HoleDef, pos: [number, number, number], time: number, s: Shot) {
  const sim = new Sim(course, def, { pos, time });
  for (let t = 0; t < s.wait; t += DT) sim.step();
  const state = sim.play(s.dx, s.dz, s.power);
  const end = { state, pos: state === "out" ? pos : sim.ballPosition(), time: sim.time, warped: sim.warped };
  sim.free();
  return end;
}

export function solve(def: HoleDef, opts: { tries?: number; beam?: number; maxShots?: number; seed?: number } = {}): Solution | null {
  const { tries = 140, beam = 3, maxShots = def.par, seed = 7 } = opts;
  const course = buildHole(def), field = distanceField(course), rand = rng(seed);
  let frontier: Node[] = [{ pos: [course.tee[0], course.tee[1] + 0.17, course.tee[2]], time: 0, shots: [], score: remaining(course, field, course.tee) }];
  for (let depth = 0; depth < maxShots; depth++) {
    const next: Node[] = [];
    for (const n of frontier) {
      for (let i = 0; i < tries; i++) {
        const a = rand() * Math.PI * 2;
        const s: Shot = { dx: Math.cos(a), dz: Math.sin(a), power: 0.15 + rand() * 0.85, wait: Math.floor(rand() * 4) * 0.75 };
        const end = playShot(course, def, n.pos, n.time, s);
        if (end.warped) continue; // the safe way round has to be done without the golden hole
        if (end.state === "sunk") return { hole: def.name, par: def.par, shots: [...n.shots, s] };
        if (end.state === "out") continue;
        next.push({ pos: end.pos, time: end.time, shots: [...n.shots, s], score: remaining(course, field, end.pos) });
      }
    }
    next.sort((x, y) => x.score - y.score);
    // keep the best few, but not several that ended up in the same spot
    frontier = [];
    for (const n of next) {
      if (frontier.some((f) => Math.hypot(f.pos[0] - n.pos[0], f.pos[2] - n.pos[2]) < 0.6)) continue;
      frontier.push(n);
      if (frontier.length >= beam) break;
    }
  }
  return null;
}

/**
 * Look for a hole in one: many single shots from the tee, half of them aimed roughly at the shortcut (the golden
 * hole, or the cup for a hole without one), with every strength and wait. Proves the risky route can be done.
 */
export function solveAce(def: HoleDef, opts: { tries?: number; seed?: number } = {}): Shot | null {
  const { tries = 4000, seed = 5 } = opts;
  const course = buildHole(def), rand = rng(seed);
  const tee: [number, number, number] = [course.tee[0], course.tee[1] + 0.17, course.tee[2]];
  const target = course.gold ?? course.hole, base = Math.atan2(target[2] - tee[2], target[0] - tee[0]);
  for (let i = 0; i < tries; i++) {
    // a third aimed at the shortcut, a third at its reflections in the four rails (bank shots), a third anywhere
    const b = course.bounds, mirror = [[2 * b.x1 - target[0], target[2]], [2 * b.x0 - target[0], target[2]], [target[0], 2 * b.z0 - target[2]], [target[0], 2 * b.z1 - target[2]]][i % 4];
    const a = i % 3 === 0 ? base + (rand() - 0.5) * 0.5
      : i % 3 === 1 ? Math.atan2(mirror[1] - tee[2], mirror[0] - tee[0]) + (rand() - 0.5) * 0.3
      : rand() * Math.PI * 2;
    const s: Shot = { dx: Math.cos(a), dz: Math.sin(a), power: 0.15 + rand() * 0.85, wait: Math.floor(rand() * 8) * 0.4 };
    const end = playShot(course, def, tee, 0, s);
    // on a hole with a golden hole, the hole in one has to go through it: that's the risky route being proved
    if (end.state === "sunk" && (!course.gold || end.warped)) return s;
  }
  return null;
}

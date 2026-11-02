import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildHole } from "../src/course/build.ts";
import { HOLES } from "../src/course/holes.ts";
import { BALL_RADIUS, DT, Sim, initPhysics } from "../src/game/physics.ts";
import { playShot, type Solution } from "../src/game/solver.ts";
import { distanceField, remaining } from "../src/game/route.ts";

await initPhysics();
// A plain straight hole for the physics tests, independent of the course design
const first = { name: "Straight", par: 2, map: ["...", ".C.", "...", "...", "...", "...", ".T.", "..."] }, course = buildHole(first);

test("the ball sits still on every tee", () => {
  for (const def of HOLES) {
    const c = buildHole(def), sim = new Sim(c, def);
    for (let i = 0; i < 240; i++) sim.step();
    const p = sim.ballPosition();
    assert.ok(Math.hypot(p[0] - c.tee[0], p[2] - c.tee[2]) < 1e-3, def.name);
    assert.ok(Math.abs(p[1] - (c.tee[1] + BALL_RADIUS)) < 0.01, def.name);
    sim.free();
  }
});

test("harder putts go further, and the ball comes to rest", () => {
  let last = 0;
  for (const power of [0.2, 0.35, 0.5, 0.65]) {
    const sim = new Sim(course, first);
    assert.equal(sim.play(0, -1, power), "rest");
    const travelled = course.tee[2] - sim.ballPosition()[2];
    assert.ok(travelled > last, `${power}: ${travelled}`);
    last = travelled;
    sim.free();
  }
});

test("the cup: too soft stops short, just right drops in, too hard skips over", () => {
  const outcome = (power: number) => { const s = new Sim(course, first), r = s.play(0, -1, power), z = s.ballPosition()[2]; s.free(); return { r, z }; };
  const soft = outcome(0.45), right = outcome(0.58), hard = outcome(0.7);
  assert.equal(soft.r, "rest"); assert.ok(soft.z > course.hole[2]);
  assert.equal(right.r, "sunk");
  assert.equal(hard.r, "rest"); assert.ok(hard.z < course.hole[2]); // rolled over the cup
});

test("rails bounce the ball back", () => {
  const sim = new Sim(course, first);
  sim.shoot(1, 0, 0.6);
  let hit = false;
  for (let i = 0; i < 600 && sim.state === "moving"; i++) if (sim.step().some((e) => e.type === "hit" && e.what === "rail")) hit = true;
  assert.ok(hit);
  assert.ok(sim.ballPosition()[0] < course.tee[0] + 1); // came back across
  sim.free();
});

test("off the side of the bridge is out of bounds, and the ball goes back where it was", () => {
  const def = HOLES.find((h) => h.name === "The Bridge")!, c = buildHole(def);
  const sim = new Sim(c, def, { pos: [3, 0.17, 9], time: 0 }); // on the bridge
  assert.equal(sim.play(1, 0, 0.4), "out");
  assert.deepEqual(sim.lastRest.map((v) => +v.toFixed(2)), [3, 0.17, 9]);
  sim.free();
});

test("ramps: a soft putt rolls back down, a firm one makes it up", () => {
  const def = { name: "Ramp", par: 3, map: [":::", ":c:", ":::", "^^^", "...", "...", ".T.", "..."] }, c = buildHole(def);
  const weak = new Sim(c, def); weak.play(0, -1, 0.35);
  assert.ok(weak.ballPosition()[1] < 0.3);
  const firm = new Sim(c, def); firm.play(0, -1, 0.7);
  assert.ok(firm.ballPosition()[1] > 0.6, String(firm.ballPosition()));
});

test("bumpers kick the ball away harder than it arrived", () => {
  const def = HOLES.find((h) => h.name === "Pinball")!, c = buildHole(def);
  const b = c.bumpers[0], sim = new Sim(c, def, { pos: [b.x, 0.17, b.z + 1.2] });
  sim.shoot(0, -1, 0.25);
  let kick = 0, before = 0;
  for (let i = 0; i < 300 && !kick; i++) {
    before = Math.hypot(sim.ball.linvel().x, sim.ball.linvel().z);
    if (sim.step().some((e) => e.type === "hit" && e.what === "bumper")) kick = Math.hypot(sim.ball.linvel().x, sim.ball.linvel().z);
  }
  assert.ok(kick > before, `${before} → ${kick}`);
});

test("the windmill blades and moving blocks move", () => {
  const def = HOLES.find((h) => h.name === "Grand Finale")!, sim = new Sim(buildHole(def), def);
  const at = () => sim.moverStates().map((m) => [m.position.x, m.rotation.z].map((v) => v.toFixed(3)).join());
  const a = at();
  for (let i = 0; i < 60; i++) sim.step();
  const b = at();
  assert.equal(a.length, 2);
  assert.ok(a.every((v, i) => v !== b[i]));
});

test("walking distance goes round the blocks", () => {
  const def = HOLES.find((h) => h.name === "Bank Shot")!, c = buildHole(def), f = distanceField(c);
  // from just below the blocks, straight up is blocked: the way round is longer than the straight line
  const p: [number, number, number] = [1, 0.17, 9];
  assert.ok(remaining(c, f, p) > Math.hypot(p[0] - c.hole[0], p[2] - c.hole[2]) + 2);
});

test("every hole can be finished within par: the recorded shots still drop in", () => {
  const sols: Solution[] = JSON.parse(readFileSync(new URL("./solutions.json", import.meta.url), "utf8"));
  assert.equal(sols.length, HOLES.length);
  HOLES.forEach((def, i) => {
    const c = buildHole(def), sol = sols[i];
    assert.equal(sol.hole, def.name, "solutions.json is out of date: run npm run check-holes");
    assert.ok(sol.shots.length <= def.par);
    let pos: [number, number, number] = [c.tee[0], c.tee[1] + BALL_RADIUS, c.tee[2]], time = 0, state = "";
    for (const s of sol.shots) ({ state, pos, time } = playShot(c, def, pos, time, s));
    assert.equal(state, "sunk", `${def.name}: run npm run check-holes`);
  });
});

test("every hole has a risky route that can be a hole in one: the recorded shot still goes in", () => {
  const sols: Solution[] = JSON.parse(readFileSync(new URL("./solutions.json", import.meta.url), "utf8"));
  HOLES.forEach((def, i) => {
    const c = buildHole(def), ace = sols[i].ace;
    assert.ok(ace, `${def.name}: no hole in one recorded`);
    const end = playShot(c, def, [c.tee[0], c.tee[1] + BALL_RADIUS, c.tee[2]], 0, ace!);
    assert.equal(end.state, "sunk", `${def.name}: the shortcut no longer works`);
    if (c.gold) assert.ok(end.warped, `${def.name}: went in, but not through the golden hole`);
  });
  void DT;
});

test("a ball that stops on the lip and then drops in still counts", () => {
  // a ball at rest hanging over the edge of the cup: gravity takes it in
  const [hx, hy, hz] = course.hole;
  const sim = new Sim(course, first, { pos: [hx, hy + BALL_RADIUS, hz - 0.24] });
  let sunk = false;
  for (let i = 0; i < 600 && !sunk; i++) if (sim.step().some((e) => e.type === "sunk")) sunk = true;
  assert.ok(sunk);
  sim.free();
});

test("the golden hole sends the ball into the cup", () => {
  const def = { name: "Gold", par: 3, map: ["...", ".C.", "...", "   ", " G ", " . ", " T ", " . "] }, c = buildHole(def);
  const sim = new Sim(c, def);
  const events: string[] = [];
  sim.shoot(0, -1, 0.38);
  for (let i = 0; i < 2400 && sim.state !== "sunk" && sim.state !== "out" && !(sim.state === "rest" && i > 10); i++) for (const e of sim.step()) events.push(e.type);
  assert.ok(events.includes("warp") && events.includes("warped"), events.join());
  assert.equal(sim.state, "sunk");
  assert.ok(sim.warped);
});

test("too hard past the golden hole is in the water", () => {
  const def = { name: "Gold", par: 3, map: ["...", ".C.", "...", "   ", " G ", " . ", " T ", " . "] }, c = buildHole(def);
  const sim = new Sim(c, def);
  assert.equal(sim.play(0, -1, 0.9), "out");
});

test("a ramp that runs out over the water is a jump: soft falls short, firm clears the gap", () => {
  const def = { name: "Jump", par: 3, map: ["...", ".C.", "...", "   ", "^^^", "...", ".T.", "..."] }, c = buildHole(def);
  assert.equal(c.lips.length, 3);
  const short = new Sim(c, def); assert.equal(short.play(0, -1, 0.5), "out");
  const clear = new Sim(c, def); const r = clear.play(0, -1, 0.7);
  assert.ok(r === "rest" || r === "sunk");
  assert.ok(clear.ballPosition()[2] < 6, "landed on the far side");
});

test("every part of every hole can reach the cup (no dead ends after a jump)", () => {
  for (const def of HOLES) {
    const c = buildHole(def), f = distanceField(c);
    for (const cell of c.grid.cells) if (!cell.block) assert.ok(f.has(cell), `${def.name}: square ${cell.c},${cell.r} can't reach the cup`);
  }
});

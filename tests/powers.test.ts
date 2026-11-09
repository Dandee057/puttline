import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHole } from "../src/course/build.ts";
import { HOLES } from "../src/course/holes.ts";
import { CELL } from "../src/course/parse.ts";
import { DT, FREEZE_TIME, Sim, initPhysics, type Event } from "../src/game/physics.ts";
import { BALLS, ballById } from "../src/game/balls.ts";

await initPhysics();

/** Run a shot to its end, calling `power` on the sim a few steps in. Collects the events. */
function shot(sim: Sim, dx: number, dz: number, p: number, power?: (s: Sim) => boolean, at = 6) {
  const events: Event[] = [];
  sim.shoot(dx, dz, p);
  let used = false;
  for (let i = 0; i < 20 / DT && (sim.state === "moving" || sim.state === "warp"); i++) {
    if (power && i === at) used = power(sim);
    events.push(...sim.step());
  }
  return { events, used, state: sim.state, pos: sim.ballPosition() };
}

test("three balls, each with its own special power and look", () => {
  assert.equal(BALLS.length, 3);
  assert.deepEqual(BALLS.map((b) => b.power), ["slash", "freeze", "magnet"]);
  assert.equal(new Set(BALLS.map((b) => b.id)).size, 3);
  assert.equal(ballById("nope").id, BALLS[0].id); // unknown ids fall back to the first ball
});

test("samurai: the slash cuts straight through a block in the way", () => {
  const def = { name: "Block", par: 2, map: ["...", ".C.", "...", ".#.", "...", "...", ".T.", "..."] }, c = buildHole(def);
  const blockZ = 3 * CELL + CELL / 2;
  // without it, the ball hits the block and stays on the tee side
  const plain = new Sim(c, def), a = shot(plain, 0, -1, 0.5);
  assert.ok(a.events.some((e) => e.type === "hit" && e.what === "block"));
  assert.ok(a.pos[2] > blockZ, `stopped at z ${a.pos[2]}`);
  plain.free();
  // with it, the ball goes through and out the far side
  const sam = new Sim(c, def), b = shot(sam, 0, -1, 0.5, (s) => s.slash());
  assert.ok(b.used);
  assert.ok(b.events.some((e) => e.type === "cut" && e.what === "block"));
  assert.ok(!b.events.some((e) => e.type === "hit" && e.what === "block"));
  assert.ok(b.pos[2] < blockZ - CELL / 2, `ended at z ${b.pos[2]}`);
  assert.equal(sam.slashT, 0); // the blade is sheathed again afterwards
  sam.free();
});

test("samurai: rails still stop a slashing ball", () => {
  const def = { name: "Straight", par: 2, map: ["...", ".C.", "...", "...", "...", ".T.", "..."] }, c = buildHole(def);
  const sim = new Sim(c, def), r = shot(sim, 1, 0, 0.6, (s) => s.slash(), 2);
  assert.ok(r.events.some((e) => e.type === "hit" && e.what === "rail"));
  assert.notEqual(r.state, "out");
  sim.free();
});

test("frost: a freeze stops the windmill until it thaws", () => {
  const def = HOLES.find((h) => h.name === "Windmill")!, c = buildHole(def), sim = new Sim(c, def);
  const angle = () => sim.moverStates()[0].rotation.z;
  for (let i = 0; i < 30; i++) sim.step();
  assert.ok(sim.freeze());
  const frozenAt = angle();
  for (let i = 0; i < (FREEZE_TIME - 0.5) / DT; i++) sim.step();
  assert.ok(Math.abs(angle() - frozenAt) < 1e-6, "turned while frozen");
  let thawed = false;
  for (let i = 0; i < 1.5 / DT; i++) if (sim.step().some((e) => e.type === "thaw")) thawed = true;
  assert.ok(thawed);
  assert.ok(Math.abs(angle() - frozenAt) > 1e-3, "didn't start again");
  sim.free();
});

test("frost: the ball rolls across the ice off the bridge, then drops in when it thaws under it", () => {
  const def = HOLES.find((h) => h.name === "The Bridge")!, c = buildHole(def);
  const plain = new Sim(c, def, { pos: [3, 0.17, 9], time: 0 });
  assert.equal(plain.play(1, 0, 0.18), "out");
  plain.free();
  const sim = new Sim(c, def, { pos: [3, 0.17, 9], time: 0 });
  assert.ok(sim.freeze());
  sim.shoot(1, 0, 0.18);
  let onIce = false, out = false, thawed = false;
  for (let i = 0; i < 12 / DT && !out; i++) {
    const ev = sim.step();
    const p = sim.ballPosition();
    if (!sim.overGreen() && p[1] > 0.1) onIce = true;
    if (ev.some((e) => e.type === "thaw")) thawed = true;
    if (ev.some((e) => e.type === "out")) out = true;
  }
  assert.ok(onIce, "never rolled on the ice");
  assert.ok(thawed && out, "should thaw and drop in");
  assert.deepEqual(sim.lastRest.map((v) => +v.toFixed(2)), [3, 0.17, 9]); // back where the shot was played from
  sim.free();
});

test("mecha: the magnet pulls a short or slightly wide putt into the cup", () => {
  const def = { name: "Straight", par: 2, map: ["...", ".C.", "...", "...", "...", "...", ".T.", "..."] }, c = buildHole(def);
  for (const [dx, power] of [[0, 0.45], [0.12, 0.55]] as const) {
    const plain = new Sim(c, def);
    assert.equal(plain.play(dx, -1, power), "rest", `plain ${dx} ${power}`);
    plain.free();
    const sim = new Sim(c, def), r = shot(sim, dx, -1, power, (s) => s.magnet(), 30);
    assert.ok(r.used);
    assert.equal(r.state, "sunk", `magnet ${dx} ${power} ended at ${r.pos}`);
    sim.free();
  }
});

test("powers only work when they make sense", () => {
  const def = { name: "Straight", par: 2, map: ["...", ".C.", "...", "...", ".T.", "..."] }, c = buildHole(def), sim = new Sim(c, def);
  assert.equal(sim.slash(), false);  // the ball has to be rolling
  assert.equal(sim.magnet(), false);
  assert.equal(sim.freeze(), true);  // a freeze can be used before the putt
  sim.free();
});

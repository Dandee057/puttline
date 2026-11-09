import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHole } from "../src/course/build.ts";
import { HOLES } from "../src/course/holes.ts";
import { CELL } from "../src/course/parse.ts";
import { DT, FREEZE_TIME, MAGNET_RANGE, MAGNET_TIME, Sim, initPhysics, type Event } from "../src/game/physics.ts";
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

test("mecha: the magnet sinks a near miss when it's switched on near the cup", () => {
  const def = { name: "Straight", par: 2, map: ["...", ".C.", "...", "...", "...", "...", ".T.", "..."] }, c = buildHole(def);
  const near = (s: Sim) => { const p = s.ballPosition(); return Math.hypot(p[0] - c.hole[0], p[2] - c.hole[2]) < MAGNET_RANGE; };
  const withMagnet = (dx: number, power: number) => {
    const sim = new Sim(c, def);
    sim.shoot(dx, -1, power);
    let used = false;
    for (let i = 0; i < 20 / DT && sim.state === "moving"; i++) { if (!used && near(sim)) used = sim.magnet(); sim.step(); }
    const state = sim.state; sim.free();
    return { used, state };
  };
  for (const [dx, power] of [[0, 0.5], [0.12, 0.55]] as const) {
    const plain = new Sim(c, def);
    assert.equal(plain.play(dx, -1, power), "rest", `plain ${dx} ${power}`);
    plain.free();
    const r = withMagnet(dx, power);
    assert.ok(r.used);
    assert.equal(r.state, "sunk", `magnet ${dx} ${power}`);
  }
  // it doesn't brake the ball: a putt that's far too hard still runs past
  assert.equal(withMagnet(0, 0.8).state, "rest");
});

test("mecha: the magnet is a short burst, so switching it on too early wastes it", () => {
  const def = { name: "Long", par: 2, map: ["...", ".C.", "...", "...", "...", "...", "...", "...", "...", ".T.", "..."] }, c = buildHole(def);
  const run = (at: number) => { const sim = new Sim(c, def), r = shot(sim, 0.02, -1, 0.75, (s) => s.magnet(), at); sim.free(); return r.state; };
  assert.ok(MAGNET_TIME <= 2);
  assert.equal(run(6), "rest");      // straight off the tee: it's run out before the ball gets there
  assert.equal(run(200), "sunk");    // as the ball arrives: in
});

test("samurai: the slash is a real dash forward", () => {
  const def = { name: "Straight", par: 2, map: ["...", ".C.", "...", "...", "...", "...", "...", "...", ".T.", "..."] }, c = buildHole(def);
  const plain = new Sim(c, def), a = shot(plain, 0.3, -1, 0.3); plain.free();
  const sam = new Sim(c, def), b = shot(sam, 0.3, -1, 0.3, (s) => s.slash(), 30); sam.free();
  const dist = (p: number[]) => Math.hypot(p[0] - c.tee[0], p[2] - c.tee[2]);
  assert.ok(dist(b.pos) > dist(a.pos) * 2, `plain ${dist(a.pos).toFixed(1)}, slashed ${dist(b.pos).toFixed(1)}`);
});

test("samurai: a slash cuts a tree down for good", () => {
  const def = { name: "Tree", par: 2, map: ["...", ".C.", "...", "...", ".Y.", "...", "...", ".T.", "..."] }, c = buildHole(def);
  const treeZ = c.trees[0].z;
  // straight at the trunk: it bounces back
  const plain = new Sim(c, def), a = shot(plain, 0, -1, 0.5);
  assert.ok(a.events.some((e) => e.type === "hit" && e.what === "tree"));
  assert.ok(a.pos[2] > treeZ);
  plain.free();
  const sam = new Sim(c, def), b = shot(sam, 0, -1, 0.5, (s) => s.slash());
  assert.ok(b.events.some((e) => e.type === "cut" && e.what === "tree" && e.tree === 0));
  assert.ok(b.pos[2] < treeZ - 1, `ended at z ${b.pos[2]}`);
  assert.ok(sam.felled.has(0));
  // it stays down: the next putt rolls straight through where it stood
  sam.place([c.tee[0], c.tee[1] + 0.17, c.tee[2]]);
  const again = shot(sam, 0, -1, 0.5);
  assert.ok(!again.events.some((e) => e.type === "hit" && e.what === "tree"));
  sam.free();
});

test("a river nudges the ball downstream; frozen, it doesn't, and the ball slides further", () => {
  const map = ["....", ".C..", "....", "~~~~", "~~~~", "....", ".T..", "...."];
  const run = (flow: "e" | "w", freeze: boolean) => {
    const def = { name: "River", par: 2, map, flow }, c = buildHole(def), sim = new Sim(c, def);
    if (freeze) sim.freeze();
    sim.shoot(0, -1, 0.45);
    let crossed = 0, rows = 0;
    for (let i = 0; i < 20 / DT && sim.state === "moving"; i++) { sim.step(); if (sim.riverUnder()) rows++; }
    const p = sim.ballPosition(); sim.free(); crossed = rows;
    return { x: p[0] - c.tee[0], z: p[2], crossed };
  };
  const east = run("e", false), west = run("w", false), iced = run("e", true);
  assert.ok(east.crossed > 0);
  assert.ok(east.x > 0.15, `east drift ${east.x}`);
  assert.ok(west.x < -0.15, `west drift ${west.x}`);
  assert.ok(Math.abs(iced.x) < 0.06, `frozen drift ${iced.x}`);
  assert.ok(iced.z < east.z, "ice should let it run further"); // further up the page
});

test("powers only work when they make sense", () => {
  const def = { name: "Straight", par: 2, map: ["...", ".C.", "...", "...", ".T.", "..."] }, c = buildHole(def), sim = new Sim(c, def);
  assert.equal(sim.slash(), false);  // the ball has to be rolling
  assert.equal(sim.magnet(), false);
  assert.equal(sim.freeze(), true);  // a freeze can be used before the putt
  sim.free();
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { CUP_RADIUS, buildHole, type MeshPart } from "../src/course/build.ts";
import { HOLES } from "../src/course/holes.ts";
import { CELL, STEP, floorHeight, parseHole } from "../src/course/parse.ts";

const normals = (m: MeshPart) => {
  const out: number[][] = [];
  for (let i = 0; i < m.indices.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => m.positions.slice(m.indices[i + k] * 3, m.indices[i + k] * 3 + 3));
    const u = b.map((v, j) => v - a[j]), w = c.map((v, j) => v - a[j]);
    out.push([u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]);
  }
  return out;
};

test("every hole parses: one tee, one cup, and only known squares", () => {
  for (const h of HOLES) {
    const g = parseHole(h);
    assert.ok(g.tee && g.cup, h.name);
  }
  assert.throws(() => parseHole({ name: "x", par: 2, map: ["T?C"] }), /unknown square/);
  assert.throws(() => parseHole({ name: "x", par: 2, map: ["..."] }), /one tee and one cup/);
});

test("the green faces up everywhere, ramps included", () => {
  for (const h of HOLES) for (const n of normals(buildHole(h).green)) assert.ok(n[1] > 0, h.name);
});

test("ramps climb exactly one step between levels", () => {
  const g = parseHole(HOLES[2]); // Step Up
  const ramp = g.cells.find((c) => c.ramp)!;
  const x = (ramp.c + 0.5) * CELL;
  assert.equal(floorHeight(ramp, x, ramp.r * CELL), STEP);           // top edge
  assert.equal(floorHeight(ramp, x, (ramp.r + 1) * CELL), 0);        // bottom edge
  assert.equal(floorHeight(ramp, x, (ramp.r + 0.5) * CELL), STEP / 2);
});

test("the cup is a real hole: no green inside its rim", () => {
  const c = buildHole(HOLES[0]), [hx, , hz] = c.hole, m = c.green;
  for (let i = 0; i < m.indices.length; i += 3) {
    const cx = [0, 1, 2].reduce((t, k) => t + m.positions[m.indices[i + k] * 3], 0) / 3;
    const cz = [0, 1, 2].reduce((t, k) => t + m.positions[m.indices[i + k] * 3 + 2], 0) / 3;
    assert.ok(Math.hypot(cx - hx, cz - hz) > CUP_RADIUS * 0.99);
  }
  assert.ok(c.cup.indices.length > 0);
});

test("rails go round open edges; bridges have none", () => {
  const plain = buildHole({ name: "x", par: 2, map: ["C", "T"] });
  assert.equal(plain.solids.filter((s) => s.kind === "rail").length, 6); // 2 squares: 3 open sides each
  const bridge = buildHole({ name: "x", par: 2, map: ["C", "_", "T"] });
  assert.equal(bridge.solids.filter((s) => s.kind === "rail").length, 6); // the bridge adds none
  assert.ok(bridge.skirt.indices.length > 0);
});

test("a step between levels gets a wall face; level neighbours don't", () => {
  assert.equal(buildHole({ name: "x", par: 2, map: ["C", "T"] }).sides.indices.length, 0);
  assert.ok(buildHole({ name: "x", par: 2, map: ["c.", ":T"] }).sides.indices.length > 0);
});

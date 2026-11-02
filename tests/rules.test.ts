import { test } from "node:test";
import assert from "node:assert/strict";
import { maxStrokes, scoreName, toPar, totals } from "../src/game/rules.ts";
import { COURSE_PAR, HOLES } from "../src/course/holes.ts";

test("score names", () => {
  assert.equal(scoreName(1, 3), "Hole in one!");
  assert.equal(scoreName(1, 2), "Hole in one!");
  assert.equal(scoreName(2, 4), "Eagle!");
  assert.equal(scoreName(2, 3), "Birdie!");
  assert.equal(scoreName(3, 3), "Par");
  assert.equal(scoreName(4, 3), "Bogey");
  assert.equal(scoreName(5, 3), "Double bogey");
  assert.equal(scoreName(7, 3), "4 over par");
});

test("against par, as golf writes it", () => {
  assert.equal(toPar(26, 26), "E");
  assert.equal(toPar(24, 26), "−2");
  assert.equal(toPar(29, 26), "+3");
});

test("running totals skip holes not yet played", () => {
  assert.deepEqual(totals([2, undefined, 4], [2, 3, 3]), { strokes: 6, par: 5 });
});

test("the course: nine holes, sensible pars, a stroke limit above par", () => {
  assert.equal(HOLES.length, 9);
  assert.equal(COURSE_PAR, HOLES.reduce((t, h) => t + h.par, 0));
  for (const h of HOLES) { assert.ok(h.par >= 2 && h.par <= 4); assert.ok(maxStrokes(h.par) > h.par); }
});

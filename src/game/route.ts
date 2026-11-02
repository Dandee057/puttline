import type { Course } from "../course/build.ts";
import { CELL, cellCentre, cornerHeights, type Cell } from "../course/parse.ts";

/** Walking distances on a hole: used to point the camera the right way, and by the hole checker. */

/** Walking distance from each square to the cup, going round blocks and only up or down ramps. */
export function distanceField(course: Course): Map<Cell, number> {
  const g = course.grid, dist = new Map<Cell, number>([[g.cup, 0]]), queue: Cell[] = [g.cup];
  const passable = (a: Cell, b: Cell) => {
    if (b.block) return false;
    // the shared edge must be level on both sides (ramps meet their ends)
    const ha = cornerHeights(a), hb = cornerHeights(b);
    if (b.c === a.c + 1) return close(ha[1], hb[0]) && close(ha[2], hb[3]);
    if (b.c === a.c - 1) return close(ha[0], hb[1]) && close(ha[3], hb[2]);
    if (b.r === a.r + 1) return close(ha[3], hb[0]) && close(ha[2], hb[1]);
    return close(ha[0], hb[3]) && close(ha[1], hb[2]);
  };
  while (queue.length) {
    const a = queue.shift()!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const b = g.at(a.c + dc, a.r + dr);
      if (!b || dist.has(b) || !passable(a, b)) continue;
      dist.set(b, dist.get(a)! + CELL);
      queue.push(b);
    }
  }
  return dist;
}
const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** How far the ball still has to go: walking distance from its square, plus the way to that square's centre. */
export function remaining(course: Course, field: Map<Cell, number>, p: [number, number, number]): number {
  const cell = course.grid.at(Math.floor(p[0] / CELL), Math.floor(p[2] / CELL));
  if (!cell || !field.has(cell)) return 1e6;
  const [cx, cz] = cellCentre(cell);
  if (cell.cup) return Math.hypot(p[0] - cx, p[2] - cz);
  return field.get(cell)! + Math.hypot(p[0] - cx, p[2] - cz);
}


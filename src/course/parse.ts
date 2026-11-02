/**
 * Holes are drawn as small text maps, one character per square of course (CELL units across). Rows run down
 * the page, which is +z in the world; columns run right, which is +x.
 *
 *   .  green              :  raised green (one step up)
 *   T  tee                t  tee on the raised level
 *   C  cup                c  cup on the raised level
 *   ^ v < >  ramp, rising towards the top, bottom, left or right of the page
 *   o  bumper on the green
 *   #  solid block on the green
 *   _  bridge: green with no rails, so the ball can fall off
 *   W  windmill: its building blocks this square except for a tunnel; blades turn in front (towards +z)
 *   (space)  nothing: rails go round the edge, and a ball out here is out of bounds
 *
 * Moving blocks are listed separately, because they move across several squares.
 */

export const CELL = 2;          // world units per square
export const STEP = 0.6;        // height of the raised level

export type Dir = "n" | "s" | "e" | "w";

export interface Cell {
  c: number; r: number; ch: string;
  /** Height of the floor: 0 or 1 level up. Ramps go from 0 to 1. */
  level: 0 | 1;
  ramp?: Dir;
  tee?: boolean;
  cup?: boolean;
  bumper?: boolean;
  block?: boolean;
  windmill?: boolean;
  /** No rails along its open edges. */
  bridge?: boolean;
}

export interface Slider {
  /** Squares at each end of its travel (centre of the block), and a full back-and-forth time in seconds. */
  from: [number, number];
  to: [number, number];
  period: number;
  /** Where in its cycle it starts, 0–1. */
  phase?: number;
}

export interface HoleDef {
  name: string;
  par: number;
  map: string[];
  sliders?: Slider[];
  /** Windmill blade speed, turns per second. */
  windmillSpeed?: number;
}

export interface Grid {
  cells: Cell[];
  cols: number;
  rows: number;
  at(c: number, r: number): Cell | undefined;
  tee: Cell;
  cup: Cell;
}

const RAMPS: Record<string, Dir> = { "^": "n", v: "s", "<": "w", ">": "e" };

export function parseHole(def: HoleDef): Grid {
  const cells: Cell[] = [];
  const rows = def.map.length, cols = Math.max(...def.map.map((l) => l.length));
  def.map.forEach((line, r) => [...line].forEach((ch, c) => {
    if (ch === " ") return;
    const cell: Cell = { c, r, ch, level: 0 };
    if (ch === ":" || ch === "t" || ch === "c" || ch === "=") cell.level = 1;
    if (ch in RAMPS) cell.ramp = RAMPS[ch];
    if (ch === "T" || ch === "t") cell.tee = true;
    if (ch === "C" || ch === "c") cell.cup = true;
    if (ch === "o") cell.bumper = true;
    if (ch === "#") cell.block = true;
    if (ch === "_" || ch === "=") cell.bridge = true;
    if (ch === "W") cell.windmill = true;
    if (!".:TtCc^v<>o#_=W".includes(ch)) throw new Error(`${def.name}: unknown square "${ch}" at column ${c}, row ${r}`);
    cells.push(cell);
  }));
  const index = new Map(cells.map((x) => [`${x.c},${x.r}`, x]));
  const tees = cells.filter((x) => x.tee), cups = cells.filter((x) => x.cup);
  if (tees.length !== 1 || cups.length !== 1) throw new Error(`${def.name}: needs exactly one tee and one cup`);
  return { cells, cols, rows, at: (c, r) => index.get(`${c},${r}`), tee: tees[0], cup: cups[0] };
}

/**
 * Floor height at a cell's four corners, in the order north-west, north-east, south-east, south-west
 * (north is the top of the page, -z).
 */
export function cornerHeights(cell: Cell): [number, number, number, number] {
  const lo = 0, hi = STEP;
  switch (cell.ramp) {
    case "n": return [hi, hi, lo, lo];
    case "s": return [lo, lo, hi, hi];
    case "e": return [lo, hi, hi, lo];
    case "w": return [hi, lo, lo, hi];
    default: { const h = cell.level * STEP; return [h, h, h, h]; }
  }
}

/** Centre of a cell on the floor, in world units. */
export function cellCentre(cell: { c: number; r: number }): [number, number] {
  return [(cell.c + 0.5) * CELL, (cell.r + 0.5) * CELL];
}

/** Floor height anywhere inside a cell (ramps are planar). */
export function floorHeight(cell: Cell, x: number, z: number): number {
  const [nw, ne, se, sw] = cornerHeights(cell);
  const u = x / CELL - cell.c, v = z / CELL - cell.r;
  return nw * (1 - u) * (1 - v) + ne * u * (1 - v) + se * u * v + sw * (1 - u) * v;
}

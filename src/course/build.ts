import { CELL, STEP, cellCentre, cornerHeights, parseHole, type Cell, type Grid, type HoleDef } from "./parse.ts";

/**
 * Turns a parsed hole into geometry. The same triangles are drawn and used as the physics collider, so what you
 * see is exactly what the ball rolls on. Rails, blocks and the windmill building are convex solids (better for
 * fast bounces than thin triangles).
 */

export const RAIL_HEIGHT = 0.32;   // above the green
export const RAIL_WIDTH = 0.24;
export const BASE = -0.5;          // bottom of the slab
export const CUP_RADIUS = 0.3;
export const CUP_DEPTH = 0.42;
export const GOLD_RADIUS = 0.25;   // barely wider than the ball: the shortcut has to be hit just right
export const BUMPER_RADIUS = 0.34;
export const TREE_RADIUS = 0.42;  // a trunk in the middle of its square: a ball fits past either side
const CUP_SEGMENTS = 32;           // a multiple of 8, so rays from the centre pass through the square's corners

export interface MeshPart { positions: number[]; indices: number[] }
export interface Solid { kind: "rail" | "block" | "building"; points: number[] }
export interface Windmill { x: number; z: number; hubY: number; hubZ: number; bladeLength: number }

export interface Course {
  grid: Grid;
  /** The playing surface, with the cup's hole cut out. */
  green: MeshPart;
  /** The cup's wall and bottom. */
  cup: MeshPart;
  /** Steps between levels and the sides of ramps. */
  sides: MeshPart;
  /** Edges of bridges, which have no rails. Drawn only. */
  skirt: MeshPart;
  solids: Solid[];
  bumpers: { x: number; y: number; z: number }[];
  trees: { x: number; y: number; z: number }[];
  /** River squares, and which way they flow (x, z). */
  river: { cells: Cell[]; flow: [number, number] };
  windmills: Windmill[];
  tee: [number, number, number];
  hole: [number, number, number];
  /** The golden hole, if this hole has one. */
  gold: [number, number, number] | null;
  /** Jump lips: the high edge of a ramp that runs out over the water. Drawn with a stripe. */
  lips: { a: [number, number, number]; b: [number, number, number] }[];
  bounds: { x0: number; z0: number; x1: number; z1: number };
}

type V3 = [number, number, number];

function part(): MeshPart { return { positions: [], indices: [] }; }
function vert(m: MeshPart, p: V3): number { m.positions.push(p[0], p[1], p[2]); return m.positions.length / 3 - 1; }
/** A triangle, wound so its normal points along `up` (for the green: +y). Degenerate ones are skipped. */
function tri(m: MeshPart, a: V3, b: V3, c: V3, up: V3 = [0, 1, 0]): void {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(n[0], n[1], n[2]);
  if (len < 1e-9) return;
  const flip = n[0] * up[0] + n[1] * up[1] + n[2] * up[2] < 0;
  const ia = vert(m, a), ib = vert(m, b), ic = vert(m, c);
  m.indices.push(...(flip ? [ia, ic, ib] : [ia, ib, ic]));
}
function quad(m: MeshPart, a: V3, b: V3, c: V3, d: V3, up: V3 = [0, 1, 0]): void { tri(m, a, b, c, up); tri(m, a, c, d, up); }

/** The four sides of a cell: neighbour offset, its two corners (indices into cornerHeights), the matching corners on the neighbour, the outward direction. */
const SIDES = [
  { dc: 0, dr: -1, ends: [0, 1], theirs: [3, 2], out: [0, -1] },
  { dc: 1, dr: 0, ends: [1, 2], theirs: [0, 3], out: [1, 0] },
  { dc: 0, dr: 1, ends: [2, 3], theirs: [1, 0], out: [0, 1] },
  { dc: -1, dr: 0, ends: [3, 0], theirs: [2, 1], out: [-1, 0] }
] as const;

function corners(cell: Cell): [number, number][] {
  const x0 = cell.c * CELL, z0 = cell.r * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}

const FLOW: Record<string, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

export function buildHole(def: HoleDef): Course {
  return buildGrid(parseHole(def), FLOW[def.flow ?? "e"]);
}

export function buildGrid(grid: Grid, flow: [number, number] = [1, 0]): Course {
  const green = part(), cup = part(), sides = part(), skirt = part();
  const solids: Solid[] = [];
  const bumpers: Course["bumpers"] = [], trees: Course["trees"] = [], windmills: Windmill[] = [];
  const lips: Course["lips"] = [];

  for (const cell of grid.cells) {
    const h = cornerHeights(cell), k = corners(cell);
    const P = (i: number): V3 => [k[i][0], h[i], k[i][1]];
    const [cx, cz] = cellCentre(cell), ch = (h[0] + h[1] + h[2] + h[3]) / 4;

    // The top of the square
    if (cell.cup) cupCell(green, cup, cx, ch, cz, CUP_RADIUS);
    else if (cell.gold) cupCell(green, cup, cx, ch, cz, GOLD_RADIUS);
    else quad(green, P(0), P(3), P(2), P(1));

    // Its four edges: rails against nothing, steps against a lower or higher neighbour
    SIDES.forEach((side, si) => {
      const nb = grid.at(cell.c + side.dc, cell.r + side.dr);
      const [i0, i1] = side.ends;
      // the high end of a ramp running out to nothing is a jump: no rail
      const lip = !nb && cell.ramp && h[i0] > 0 && h[i1] > 0 && Math.abs(h[i0] - h[i1]) < 1e-6 && h[i0] === Math.max(...h);
      if (lip) lips.push({ a: P(i0), b: P(i1) });
      if (!nb) {
        if (cell.bridge || lip) { quad(skirt, P(i0), P(i1), [k[i1][0], BASE, k[i1][1]], [k[i0][0], BASE, k[i0][1]], [side.out[0], 0, side.out[1]]); return; }
        solids.push({ kind: "rail", points: rail(grid, cell, si, k[i0], k[i1], h[i0], h[i1]) });
        return;
      }
      const nh = cornerHeights(nb), [j0, j1] = side.theirs;
      const mine = h[i0] + h[i1], theirs = nh[j0] + nh[j1];
      if (Math.abs(h[i0] - nh[j0]) < 1e-6 && Math.abs(h[i1] - nh[j1]) < 1e-6) return;
      if (mine < theirs || (mine === theirs && si > 1)) return; // the higher side draws the step, once
      quad(sides, P(i0), P(i1), [k[i1][0], nh[j1], k[i1][1]], [k[i0][0], nh[j0], k[i0][1]], [side.out[0], 0, side.out[1]]);
    });

    if (cell.block) {
      const inset = 0.02, top = ch + 0.55;
      solids.push({ kind: "block", points: box(k[0][0] + inset, ch - 0.01, k[0][1] + inset, k[2][0] - inset, top, k[2][1] - inset) });
    }
    if (cell.bumper) bumpers.push({ x: cx, y: ch, z: cz });
    if (cell.tree) trees.push({ x: cx, y: ch, z: cz });
    if (cell.windmill) {
      // A building across the square with a tunnel through the middle; the blades turn in front of it (+z side)
      const tunnel = 0.9, depth = 0.9, height = 1.25, z0 = cz - depth / 2, z1 = cz + depth / 2;
      const x0 = cell.c * CELL, x1 = x0 + CELL;
      solids.push({ kind: "building", points: box(x0, ch, z0, cx - tunnel / 2, ch + height, z1) });
      solids.push({ kind: "building", points: box(cx + tunnel / 2, ch, z0, x1, ch + height, z1) });
      solids.push({ kind: "building", points: box(cx - tunnel / 2, ch + 0.62, z0, cx + tunnel / 2, ch + height, z1) });
      windmills.push({ x: cx, z: cz, hubY: ch + 1.5, hubZ: z1 + 0.14, bladeLength: 1.42 });
    }
  }

  const xs = grid.cells.map((c) => c.c), zs = grid.cells.map((c) => c.r);
  const [tx, tz] = cellCentre(grid.tee), [hx, hz] = cellCentre(grid.cup);
  const gold = grid.gold ? (() => { const [gx, gz] = cellCentre(grid.gold!); return [gx, cornerHeights(grid.gold!)[0], gz] as [number, number, number]; })() : null;
  return {
    grid, green, cup, sides, skirt, solids, bumpers, trees, windmills, gold, lips,
    river: { cells: grid.cells.filter((c) => c.river), flow },
    tee: [tx, cornerHeights(grid.tee)[0], tz],
    hole: [hx, cornerHeights(grid.cup)[0], hz],
    bounds: { x0: Math.min(...xs) * CELL, z0: Math.min(...zs) * CELL, x1: (Math.max(...xs) + 1) * CELL, z1: (Math.max(...zs) + 1) * CELL }
  };
}

/** A square of green with a round hole in the middle, and the cup below it. */
function cupCell(green: MeshPart, cup: MeshPart, cx: number, y: number, cz: number, radius: number): void {
  const half = CELL / 2;
  const ring: V3[] = [], edge: V3[] = [];
  for (let i = 0; i < CUP_SEGMENTS; i++) {
    const a = (i / CUP_SEGMENTS) * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
    ring.push([cx + radius * cs, y, cz + radius * sn]);
    const s = half / Math.max(Math.abs(cs), Math.abs(sn)); // out along the same ray to the square's edge
    edge.push([cx + s * cs, y, cz + s * sn]);
  }
  const bottom = y - CUP_DEPTH;
  for (let i = 0; i < CUP_SEGMENTS; i++) {
    const j = (i + 1) % CUP_SEGMENTS;
    quad(green, ring[i], edge[i], edge[j], ring[j]);
    // the cup's wall faces inwards, its bottom faces up
    const inward: V3 = [cx - (ring[i][0] + ring[j][0]) / 2, 0, cz - (ring[i][2] + ring[j][2]) / 2];
    quad(cup, ring[i], ring[j], [ring[j][0], bottom, ring[j][2]], [ring[i][0], bottom, ring[i][2]], inward);
    tri(cup, [cx, bottom, cz], [ring[i][0], bottom, ring[i][2]], [ring[j][0], bottom, ring[j][2]]);
  }
}

/** A rail along one edge, standing outside the square, as 8 corner points. It's lengthened to close outside corners. */
function rail(grid: Grid, cell: Cell, si: number, a: [number, number], b: [number, number], ha: number, hb: number): number[] {
  const s = SIDES[si], [ox, oz] = s.out;
  const dx = Math.sign(b[0] - a[0]), dz = Math.sign(b[1] - a[1]);
  // at each end: if the next square along this edge is empty, this is an outside corner, so reach over it
  const extA = grid.at(cell.c - dx, cell.r - dz) ? 0 : RAIL_WIDTH, extB = grid.at(cell.c + dx, cell.r + dz) ? 0 : RAIL_WIDTH;
  const A: [number, number] = [a[0] - dx * extA, a[1] - dz * extA], B: [number, number] = [b[0] + dx * extB, b[1] + dz * extB];
  const pts: number[] = [];
  for (const [p, h] of [[A, ha], [B, hb]] as const) for (const w of [0, RAIL_WIDTH]) {
    pts.push(p[0] + ox * w, BASE, p[1] + oz * w, p[0] + ox * w, h + RAIL_HEIGHT, p[1] + oz * w);
  }
  return pts;
}

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  const out: number[] = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) out.push(x, y, z);
  return out;
}

export { STEP };

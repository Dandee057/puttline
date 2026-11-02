import RAPIER from "@dimforge/rapier3d-compat";
import { BUMPER_RADIUS, CUP_DEPTH, CUP_RADIUS, GOLD_RADIUS, type Course, type MeshPart } from "../course/build.ts";
import { CELL, cellCentre, cornerHeights, floorHeight, type HoleDef, type Slider } from "../course/parse.ts";

/**
 * The ball and everything it can hit, simulated with Rapier at a fixed 120 steps a second. The same code runs in
 * the browser and in the tests, so a shot plays out identically in both. Rapier rolls the ball properly (with
 * friction, it spins as it rolls); on top of that, a steady rolling resistance slows it like a real green.
 */

export const BALL_RADIUS = 0.17;
export const DT = 1 / 120;
export const MAX_SPEED = 13;        // a full-power putt, units per second
const ROLL_DECEL = 1.9;              // rolling resistance on the green, units/s²
const REST_SPEED = 0.07;
const REST_TIME = 0.35;              // seconds below REST_SPEED on the ground before the ball counts as stopped
const BUMPER_KICK = 1.25;
const MAX_HOP = 1.1;                 // fastest the ball may rise over flat green, units/s (a hop of ~6 cm)

export type Event =
  | { type: "hit"; what: "rail" | "block" | "building" | "bumper" | "blade" | "slider"; speed: number }
  | { type: "sunk" } | { type: "out" } | { type: "rest" }
  /** Into the golden hole: the ball is in the tube for a moment, then drops into the cup. */
  | { type: "warp" } | { type: "warped" };

export type BallState = "rest" | "moving" | "warp" | "sunk" | "out";
const WARP_TIME = 0.7;

let ready: Promise<void> | null = null;
/** Rapier is WebAssembly: call this once before creating a Sim. */
export const initPhysics = () => (ready ??= RAPIER.init());

const trimesh = (parts: MeshPart[]) => {
  const pos: number[] = [], idx: number[] = [];
  for (const p of parts) { const base = pos.length / 3; pos.push(...p.positions); idx.push(...p.indices.map((i) => i + base)); }
  return RAPIER.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(idx), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
};

interface Mover { body: RAPIER.RigidBody; kind: "blade" | "slider" }

export class Sim {
  readonly world: RAPIER.World;
  readonly ball: RAPIER.RigidBody;
  readonly course: Course;
  readonly def: HoleDef;
  time = 0;
  state: BallState = "rest";
  /** Where the ball last came to rest: an out-of-bounds ball goes back here. */
  lastRest: [number, number, number];
  private still = 0;
  private warpT = 0;
  /** Whether the ball went through the golden hole on this shot. */
  warped = false;
  private ground: RAPIER.Collider;
  private ballCollider: RAPIER.Collider;
  private kinds = new Map<number, Extract<Event, { type: "hit" }>["what"] | "green">();
  private movers: Mover[] = [];
  private events = new RAPIER.EventQueue(true);

  constructor(course: Course, def: HoleDef, start?: { pos?: [number, number, number]; time?: number }) {
    this.course = course; this.def = def;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = DT;

    const fixed = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.ground = this.world.createCollider(trimesh([course.green, course.cup, course.sides]).setFriction(0.6).setRestitution(0.05)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Multiply), fixed);
    this.kinds.set(this.ground.handle, "green");
    for (const s of course.solids) {
      const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(s.points));
      if (!desc) continue;
      const c = this.world.createCollider(bouncy(desc, s.kind === "rail" ? 0.72 : 0.6, 0.15), fixed);
      this.kinds.set(c.handle, s.kind);
    }
    for (const b of course.bumpers) {
      const c = this.world.createCollider(bouncy(RAPIER.ColliderDesc.cylinder(0.25, BUMPER_RADIUS).setTranslation(b.x, b.y + 0.25, b.z), 1, 0.05)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), fixed);
      this.kinds.set(c.handle, "bumper");
    }
    // Windmill blades: four paddles on a hub, turning in the plane facing the tee
    for (const w of course.windmills) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(w.x, w.hubY, w.hubZ));
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2, half = w.bladeLength / 2;
        const desc = bouncy(RAPIER.ColliderDesc.cuboid(0.13, half, 0.05), 0.5, 0.2)
          .setTranslation(-Math.sin(a) * half, Math.cos(a) * half, 0).setRotation(quatZ(a));
        this.kinds.set(this.world.createCollider(desc, body).handle, "blade");
      }
      this.movers.push({ body, kind: "blade" });
    }
    for (const s of def.sliders ?? []) {
      const [x, , z] = sliderAt(s, 0);
      const y = cornerHeights(course.grid.at(s.from[0], s.from[1])!)[0];
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + 0.26, z));
      const alongX = s.from[1] === s.to[1];
      const c = this.world.createCollider(bouncy(RAPIER.ColliderDesc.cuboid(alongX ? 0.9 : 0.35, 0.26, alongX ? 0.35 : 0.9), 0.6, 0.2), body);
      this.kinds.set(c.handle, "slider");
      this.movers.push({ body, kind: "slider" });
    }

    const p = start?.pos ?? [course.tee[0], course.tee[1] + BALL_RADIUS, course.tee[2]];
    this.lastRest = [...p];
    this.ball = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p[0], p[1], p[2])
      .setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.4).setCanSleep(false));
    this.ballCollider = this.world.createCollider(RAPIER.ColliderDesc.ball(BALL_RADIUS).setDensity(1.2).setFriction(1).setRestitution(1)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), this.ball);
    this.time = start?.time ?? 0;
    this.moveKinematics(this.time, true);
  }

  /** Hit the ball along (dx, dz) with power 0–1. */
  shoot(dx: number, dz: number, power: number): void {
    if (this.state !== "rest") return;
    this.warped = false;
    const len = Math.hypot(dx, dz) || 1, v = Math.max(0.05, Math.min(1, power)) * MAX_SPEED;
    const p = this.ball.translation();
    this.lastRest = [p.x, p.y, p.z];
    const vel = { x: (dx / len) * v, y: 0, z: (dz / len) * v };
    this.ball.setLinvel(vel, true);
    this.rollWith(vel); // a putter starts the ball rolling, not skidding
    this.state = "moving";
    this.still = 0;
  }

  /** Put the ball somewhere, at rest (after going out of bounds, or a new hole). */
  place(p: [number, number, number]): void {
    this.ball.setTranslation({ x: p[0], y: p[1], z: p[2] }, true);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.state = "rest";
  }

  /** One fixed step. Returns what happened. */
  step(): Event[] {
    const out: Event[] = [];
    this.time += DT;
    this.moveKinematics(this.time);
    const grounded = this.onGround();
    if (this.state === "moving" && grounded) this.rollingResistance();
    const before = this.ball.linvel(), impact = Math.hypot(before.x, before.z);
    this.world.step(this.events);

    this.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const other = h1 === this.ballCollider.handle ? h2 : h2 === this.ballCollider.handle ? h1 : -1;
      const what = this.kinds.get(other);
      if (!what || what === "green") return;
      const v = this.ball.linvel(), speed = impact;
      if (what === "bumper") {
        // a bumper gives the ball a kick away from its centre
        const b = this.world.getCollider(other).translation(), p = this.ball.translation();
        const nx = p.x - b.x, nz = p.z - b.z, n = Math.hypot(nx, nz) || 1, s = Math.min(MAX_SPEED, Math.max(3.5, speed * BUMPER_KICK));
        this.ball.setLinvel({ x: (nx / n) * s, y: v.y, z: (nz / n) * s }, true);
      }
      // Leave the wall already rolling the new way. Otherwise the spin it arrived with brakes it hard on the grass,
      // which is real but makes bank shots feel dead.
      this.rollWith(this.ball.linvel());
      if (this.state === "rest") this.state = "moving";
      out.push({ type: "hit", what, speed });
    });

    if (this.state === "sunk" || this.state === "out") return out;
    if (this.state === "warp") {
      // in the tube: after a moment it drops into the cup from just above it
      this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      if ((this.warpT += DT) >= WARP_TIME) {
        const [hx, hy, hz] = this.course.hole;
        this.ball.setTranslation({ x: hx, y: hy + 0.9, z: hz }, true);
        this.ball.setLinvel({ x: 0, y: -1, z: 0 }, true);
        this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.ball.setGravityScale(1, true);
        this.state = "moving";
        out.push({ type: "warped" });
      }
      return out;
    }
    // In the cup: below the green and inside its rim. Checked even at rest: a ball can stop on the lip and drop.
    const p = this.ball.translation(), v = this.ball.linvel();
    const [hx, hy, hz] = this.course.hole;
    // (inside the cup, not just somewhere below it: a ball that fell off the course can pass underneath)
    const inside = (y: number) => p.y < y - BALL_RADIUS * 0.6 && p.y > y - CUP_DEPTH;
    if (inside(hy) && Math.hypot(p.x - hx, p.z - hz) < CUP_RADIUS) {
      this.state = "sunk"; out.push({ type: "sunk" }); return out;
    }
    const g = this.course.gold;
    if (g && inside(g[1]) && Math.hypot(p.x - g[0], p.z - g[2]) < GOLD_RADIUS) {
      this.state = "warp"; this.warpT = 0; this.warped = true;
      this.ball.setGravityScale(0, true);
      this.ball.setTranslation({ x: g[0], y: g[1] - 1, z: g[2] }, true); // out of sight, down the tube
      out.push({ type: "warp" });
      return out;
    }
    if (this.state === "rest") { this.holdStill(); return out; }
    this.limitHop();
    const b = this.course.bounds;
    if (p.y < -1.5 || p.x < b.x0 - 1 || p.x > b.x1 + 1 || p.z < b.z0 - 1 || p.z > b.z1 + 1) {
      this.state = "out"; out.push({ type: "out" }); return out;
    }
    const speed = Math.hypot(v.x, v.y, v.z);
    // never "stopped" while hanging over a cup: let it drop
    const overCup = Math.hypot(p.x - hx, p.z - hz) < CUP_RADIUS || (!!g && Math.hypot(p.x - g[0], p.z - g[2]) < GOLD_RADIUS);
    this.still = speed < REST_SPEED && grounded && !overCup ? this.still + DT : 0;
    if (this.still >= REST_TIME) {
      this.place([p.x, p.y, p.z]);
      this.lastRest = [p.x, p.y, p.z];
      out.push({ type: "rest" });
    }
    return out;
  }

  /** Run a whole shot to its end, for the tests and the hole checker. */
  play(dx: number, dz: number, power: number, maxSeconds = 20): BallState {
    this.shoot(dx, dz, power);
    for (let t = 0; t < maxSeconds && (this.state === "moving" || this.state === "warp"); t += DT) this.step();
    if (this.state === "moving") { const p = this.ball.translation(); this.place([p.x, p.y, p.z]); }
    return this.state;
  }

  ballPosition(): [number, number, number] { const p = this.ball.translation(); return [p.x, p.y, p.z]; }
  ballRotation() { return this.ball.rotation(); }

  /** Windmill angles and slider positions, for drawing. */
  moverStates(): { kind: Mover["kind"]; position: RAPIER.Vector; rotation: RAPIER.Rotation }[] {
    return this.movers.map((m) => ({ kind: m.kind, position: m.body.translation(), rotation: m.body.rotation() }));
  }

  free(): void { this.world.free(); }

  private moveKinematics(t: number, teleport = false): void {
    let wi = 0, si = 0;
    for (const m of this.movers) {
      if (m.kind === "blade") {
        // turning so the blade nearest the tee sweeps across the tunnel from left to right
        const a = -t * Math.PI * 2 * (this.def.windmillSpeed ?? 0.2) + wi++ * 0.4;
        if (teleport) m.body.setRotation(quatZ(a), true); else m.body.setNextKinematicRotation(quatZ(a));
      } else {
        const s = this.def.sliders![si++], [x, , z] = sliderAt(s, t), y = m.body.translation().y;
        if (teleport) m.body.setTranslation({ x, y, z }, true); else m.body.setNextKinematicTranslation({ x, y, z });
      }
    }
  }

  private onGround(): boolean {
    let touching = false;
    this.world.contactPair(this.ballCollider, this.ground, (m) => { if (m.numContacts() > 0) touching = true; });
    return touching;
  }

  /** Slow a rolling ball by a steady amount, as the grass does. */
  private rollingResistance(): void {
    const v = this.ball.linvel(), s = Math.hypot(v.x, v.z);
    if (s < 1e-4) return;
    const k = Math.max(0, s - ROLL_DECEL * DT) / s;
    this.ball.setLinvel({ x: v.x * k, y: v.y, z: v.z * k }, true);
    const w = this.ball.angvel();
    this.ball.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true);
  }

  /**
   * Over flat green, the ball can only hop a little. Without this, a fast ball clipping the far rim of the cup is
   * thrown up high enough to clear the rails. Ramps are left alone: rolling up one needs the upward speed.
   */
  private limitHop(): void {
    const p = this.ball.translation(), cell = this.course.grid.at(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
    if (!cell || cell.ramp) return;
    // only right at grass level, where the contacts are: a ball in the air (off a jump) flies freely
    if (p.y - floorHeight(cell, p.x, p.z) > BALL_RADIUS + 0.12) return;
    const v = this.ball.linvel();
    if (v.y > MAX_HOP) this.ball.setLinvel({ x: v.x, y: MAX_HOP, z: v.z }, true);
  }

  /** Spin the ball so it rolls without slipping at velocity v. */
  private rollWith(v: { x: number; z: number }): void {
    this.ball.setAngvel({ x: v.z / BALL_RADIUS, y: 0, z: -v.x / BALL_RADIUS }, true);
  }

  /** A ball at rest stays put: no creeping on a flat green. */
  private holdStill(): void {
    this.ball.setLinvel({ x: 0, y: Math.min(0, this.ball.linvel().y), z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}

function bouncy(d: RAPIER.ColliderDesc, restitution: number, friction: number): RAPIER.ColliderDesc {
  return d.setRestitution(restitution).setFriction(friction)
    .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Multiply).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply);
}

const quatZ = (a: number) => ({ x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) });

/** Where a moving block is at time t: eased back and forth between its two squares. */
export function sliderAt(s: Slider, t: number): [number, number, number] {
  const [ax, az] = cellCentre({ c: s.from[0], r: s.from[1] }), [bx, bz] = cellCentre({ c: s.to[0], r: s.to[1] });
  const k = 0.5 - 0.5 * Math.cos(2 * Math.PI * (t / s.period + (s.phase ?? 0)));
  return [ax + (bx - ax) * k, 0, az + (bz - az) * k];
}

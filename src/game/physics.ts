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
const MAX_HOP = 1.1;
const TOOT_BOOST = 3.2;              // power-ups
const TOOT_MIN = 3.5;
const JUMP_SPEED = 4.4;              // about 1 unit of height
// The three balls' special powers (see src/game/balls.ts)
export const SLASH_TIME = 1.5;       // samurai: seconds the ball cuts through blocks, bumpers, sliders and blades
const SLASH_SPEED = 6;               // and the dash it gets as it draws
export const FREEZE_TIME = 5;        // frost: seconds the windmill and moving blocks stop and the water is ice
const ICE_DRAG = 0.35;               // on ice the ball keeps rolling: this much of the grass's resistance
export const MAGNET_TIME = 3;        // mecha: seconds the cup pulls the ball in
const MAGNET_RANGE = 5;              // from this far away
const MAGNET_PULL = 9;               // units/s² at the edge of range, more up close
/** Membership/filter bits (Rapier InteractionGroups: memberships << 16 | filter). Obstacles are group 2. */
const OBSTACLE_GROUPS = (0x0002 << 16) | 0xffff;
const BALL_NORMAL = 0xffffffff, BALL_CUTTING = (0xffff << 16) | 0xfffd;

export type Obstacle = "block" | "building" | "bumper" | "blade" | "slider";
export type Event =
  | { type: "hit"; what: "rail" | Obstacle; speed: number }
  /** The samurai ball cut through something. */
  | { type: "cut"; what: Obstacle; at: [number, number, number] }
  /** The ice from a freeze has melted. */
  | { type: "thaw" }
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
  private airborne = 0;
  private lastDir: [number, number] = [0, -1];
  /** Whether the ball went through the golden hole on this shot. */
  warped = false;
  private ground: RAPIER.Collider;
  private ballCollider: RAPIER.Collider;
  private kinds = new Map<number, Extract<Event, { type: "hit" }>["what"] | "green">();
  private movers: Mover[] = [];
  private events = new RAPIER.EventQueue(true);
  /** Time on the clock the windmill and moving blocks follow: it stands still while frozen. */
  private kinTime = 0;
  /** Seconds left on each special power (0 when off). */
  slashT = 0;
  freezeT = 0;
  magnetT = 0;
  private cut = new Set<number>();
  private ice: RAPIER.Collider | null = null;
  private probe = new RAPIER.Ball(BALL_RADIUS * 1.05);

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
      if (s.kind !== "rail") c.setCollisionGroups(OBSTACLE_GROUPS);
      this.kinds.set(c.handle, s.kind);
    }
    for (const b of course.bumpers) {
      const c = this.world.createCollider(bouncy(RAPIER.ColliderDesc.cylinder(0.25, BUMPER_RADIUS).setTranslation(b.x, b.y + 0.25, b.z), 1, 0.05)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS).setCollisionGroups(OBSTACLE_GROUPS), fixed);
      this.kinds.set(c.handle, "bumper");
    }
    // Windmill blades: four paddles on a hub, turning in the plane facing the tee
    for (const w of course.windmills) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(w.x, w.hubY, w.hubZ));
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2, half = w.bladeLength / 2;
        const desc = bouncy(RAPIER.ColliderDesc.cuboid(0.13, half, 0.05), 0.5, 0.2)
          .setTranslation(-Math.sin(a) * half, Math.cos(a) * half, 0).setRotation(quatZ(a)).setCollisionGroups(OBSTACLE_GROUPS);
        this.kinds.set(this.world.createCollider(desc, body).handle, "blade");
      }
      this.movers.push({ body, kind: "blade" });
    }
    for (const s of def.sliders ?? []) {
      const [x, , z] = sliderAt(s, 0);
      const y = cornerHeights(course.grid.at(s.from[0], s.from[1])!)[0];
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + 0.26, z));
      const alongX = s.from[1] === s.to[1];
      const c = this.world.createCollider(bouncy(RAPIER.ColliderDesc.cuboid(alongX ? 0.9 : 0.35, 0.26, alongX ? 0.35 : 0.9), 0.6, 0.2).setCollisionGroups(OBSTACLE_GROUPS), body);
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
    this.kinTime = this.time;
    this.moveKinematics(this.kinTime, true);
  }

  /** Hit the ball along (dx, dz) with power 0–1. */
  shoot(dx: number, dz: number, power: number): void {
    if (this.state !== "rest") return;
    this.warped = false;
    const len = Math.hypot(dx, dz) || 1, v = Math.max(0.05, Math.min(1, power)) * MAX_SPEED;
    const p = this.ball.translation();
    this.lastRest = [p.x, p.y, p.z];
    const vel = { x: (dx / len) * v, y: 0, z: (dz / len) * v };
    this.lastDir = [dx / len, dz / len];
    this.ball.setLinvel(vel, true);
    this.rollWith(vel); // a putter starts the ball rolling, not skidding
    this.state = "moving";
    this.still = 0;
  }

  /**
   * Power-up: a toot. A push along the way the ball is rolling, enough to get a slowing ball going again.
   * Returns false if the ball isn't rolling.
   */
  toot(): boolean {
    if (this.state !== "moving") return false;
    const v = this.ball.linvel();
    let dx = v.x, dz = v.z, s = Math.hypot(dx, dz);
    if (s < 0.05) { [dx, dz] = this.lastDir; s = 1; }
    const speed = Math.min(MAX_SPEED, Math.max(TOOT_MIN, s + TOOT_BOOST));
    const vel = { x: (dx / (s || 1)) * speed, y: v.y, z: (dz / (s || 1)) * speed };
    this.ball.setLinvel(vel, true);
    this.rollWith(vel);
    this.still = 0;
    return true;
  }

  /** Power-up: a jump. Pops the rolling ball into the air (over a block, a gap, or off the course). */
  jump(): boolean {
    if (this.state !== "moving") return false;
    const v = this.ball.linvel();
    this.ball.setLinvel({ x: v.x, y: JUMP_SPEED, z: v.z }, true);
    this.airborne = 0.4; // don't let the hop limit flatten it on the way up
    this.still = 0;
    return true;
  }

  /**
   * Samurai: draw the blade. The ball dashes forward and, for a moment, cuts straight through blocks, bumpers,
   * moving blocks, windmill blades and the windmill's walls (never the rails). Only while it's rolling.
   */
  slash(): boolean {
    if (this.state !== "moving") return false;
    const v = this.ball.linvel();
    let dx = v.x, dz = v.z, s = Math.hypot(dx, dz);
    if (s < 0.05) { [dx, dz] = this.lastDir; s = 1; }
    const speed = Math.min(MAX_SPEED, Math.max(SLASH_SPEED, Math.hypot(v.x, v.z)));
    const vel = { x: (dx / s) * speed, y: v.y, z: (dz / s) * speed };
    this.ball.setLinvel(vel, true); this.rollWith(vel);
    this.slashT = SLASH_TIME; this.cut.clear();
    this.ballCollider.setCollisionGroups(BALL_CUTTING);
    this.still = 0;
    return true;
  }

  /**
   * Frost: freeze the hole. The windmill and moving blocks stop, and the water inside the course turns to ice the
   * ball can roll across (and slide a long way on). Usable before a putt too. When it thaws, a ball left on the ice
   * drops in the water.
   */
  freeze(): boolean {
    if (this.state === "sunk" || this.state === "warp" || this.state === "out") return false;
    this.freezeT = FREEZE_TIME;
    if (!this.ice) {
      const b = this.course.bounds, hx = (b.x1 - b.x0) / 2 + 0.6, hz = (b.z1 - b.z0) / 2 + 0.6;
      this.ice = this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 0.05, hz).setTranslation((b.x0 + b.x1) / 2, -0.05, (b.z0 + b.z1) / 2)
        .setFriction(0.6).setRestitution(0.05).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Multiply));
    }
    return true;
  }

  /** Mecha: switch on the cup's magnet. A rolling ball within range is pulled in and steered onto the cup. */
  magnet(): boolean {
    if (this.state !== "moving") return false;
    this.magnetT = MAGNET_TIME;
    this.still = 0;
    return true;
  }

  /** Whether there's green (not water) under the ball. */
  overGreen(p = this.ball.translation()): boolean {
    return !!this.course.grid.at(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
  }

  /** Put the ball somewhere, at rest (after going out of bounds, or a new hole). */
  place(p: [number, number, number]): void {
    this.lastRest = [...p];
    this.endSlash(); this.magnetT = 0;
    this.ball.setGravityScale(1, true);
    this.ball.setTranslation({ x: p[0], y: p[1], z: p[2] }, true);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.state = "rest";
  }

  /** One fixed step. Returns what happened. */
  step(): Event[] {
    const out: Event[] = [];
    this.time += DT;
    if (this.freezeT > 0) { if ((this.freezeT -= DT) <= 0) { this.thaw(); out.push({ type: "thaw" }); } }
    else this.kinTime += DT; // the windmill and moving blocks stand still while frozen
    this.moveKinematics(this.kinTime);
    const grounded = this.onGround();
    if (this.state === "moving" && grounded) this.rollingResistance(this.onIce() ? ICE_DRAG : 1);
    if (this.state === "moving" && this.magnetT > 0) this.pull();
    if (this.slashT > 0) this.cutThrough(out);
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
    const pulled = this.magnetT > 0 && Math.hypot(p.x - hx, p.z - hz) < MAGNET_RANGE;
    this.still = speed < REST_SPEED && grounded && !overCup && !pulled ? this.still + DT : 0;
    if (this.still >= REST_TIME && this.ice && !this.overGreen()) {
      // stopped on the ice: it thaws under the ball, which drops in the water (and goes back where it was)
      this.freezeT = 0; this.thaw(); out.push({ type: "thaw" });
      this.still = 0;
      return out;
    }
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
    return touching || this.onIce();
  }

  private onIce(): boolean {
    if (!this.ice) return false;
    let touching = false;
    this.world.contactPair(this.ballCollider, this.ice, (m) => { if (m.numContacts() > 0) touching = true; });
    return touching;
  }

  private thaw(): void {
    if (this.ice) { this.world.removeCollider(this.ice, true); this.ice = null; }
    // a ball sitting on the ice now falls in
    if (this.state === "rest" && !this.overGreen()) { this.state = "moving"; this.still = 0; }
  }

  /** The cup's magnet: pull towards the cup, damp the sideways drift, and slow it near the rim so it drops. */
  private pull(): void {
    this.magnetT = Math.max(0, this.magnetT - DT);
    const p = this.ball.translation(), [hx, , hz] = this.course.hole;
    let dx = hx - p.x, dz = hz - p.z;
    const d = Math.hypot(dx, dz);
    if (d > MAGNET_RANGE || d < 1e-3) return;
    dx /= d; dz /= d;
    const v = this.ball.linvel();
    const along = v.x * dx + v.z * dz, sx = v.x - along * dx, sz = v.z - along * dz;
    const a = MAGNET_PULL * (1.6 - d / MAGNET_RANGE) * DT;
    let nx = (along + a) * dx + sx * 0.96, nz = (along + a) * dz + sz * 0.96;
    const cap = d < 1.4 ? 1.6 + d : MAX_SPEED, s = Math.hypot(nx, nz);
    if (s > cap) { nx *= cap / s; nz *= cap / s; }
    const vel = { x: nx, y: v.y, z: nz };
    this.ball.setLinvel(vel, true); this.rollWith(vel);
  }

  /** While slashing, note each obstacle the ball passes through (for the effect) and end it once clear. */
  private cutThrough(out: Event[]): void {
    const p = this.ball.translation();
    let inside = false;
    this.world.intersectionsWithShape(p, { x: 0, y: 0, z: 0, w: 1 }, this.probe, (c) => {
      const what = this.kinds.get(c.handle);
      if (!what || what === "green" || what === "rail") return true;
      inside = true;
      if (!this.cut.has(c.handle)) { this.cut.add(c.handle); out.push({ type: "cut", what, at: [p.x, p.y, p.z] }); }
      return true;
    });
    // never let the blade go back in while the ball is still inside something
    if ((this.slashT -= DT) <= 0 && !inside) this.endSlash();
    else if (this.slashT <= 0) this.slashT = DT;
  }

  private endSlash(): void {
    this.slashT = 0;
    this.ballCollider.setCollisionGroups(BALL_NORMAL);
  }

  /** Slow a rolling ball by a steady amount, as the grass does (less on ice). */
  private rollingResistance(scale = 1): void {
    const v = this.ball.linvel(), s = Math.hypot(v.x, v.z);
    if (s < 1e-4) return;
    const k = Math.max(0, s - ROLL_DECEL * scale * DT) / s;
    this.ball.setLinvel({ x: v.x * k, y: v.y, z: v.z * k }, true);
    const w = this.ball.angvel();
    this.ball.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true);
  }

  /**
   * Over flat green, the ball can only hop a little. Without this, a fast ball clipping the far rim of the cup is
   * thrown up high enough to clear the rails. Ramps are left alone: rolling up one needs the upward speed.
   */
  private limitHop(): void {
    if (this.airborne > 0) { this.airborne -= DT; return; }
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

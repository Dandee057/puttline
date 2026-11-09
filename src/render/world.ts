import * as THREE from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import { BUMPER_RADIUS, CUP_RADIUS, GOLD_RADIUS, type Course, type MeshPart } from "../course/build.ts";
import { CELL, type HoleDef } from "../course/parse.ts";
import { BALL_RADIUS, type Sim } from "../game/physics.ts";
import type { Theme } from "./themes.ts";
import { BALLS, type BallDef } from "../game/balls.ts";
import { makeBall, type BallLook } from "./balls.ts";

/**
 * What you see: the course drawn from the same triangles the ball rolls on, in the hole's theme, plus the ball,
 * the flag, moving parts, the golden hole, glowing trim, the aiming arrow and effects. Built per hole.
 */

const GOLD = "#ffc83d";

/** Mown stripes in the theme's two greens, one light and one dark band per square. */
const greenTextures = new Map<string, THREE.Texture>();
function greenTexture([light, dark]: [string, string]): THREE.Texture {
  const key = light + dark;
  if (greenTextures.has(key)) return greenTextures.get(key)!;
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = light; g.fillRect(0, 0, 128, 128);
  g.fillStyle = dark; g.fillRect(0, 64, 128, 64);
  // a little speckle so it reads as grass, not plastic
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? "255,255,255" : "0,40,0"},${Math.random() * 0.06})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  greenTextures.set(key, t);
  return t;
}

/** Yellow and black chevrons for the edge of a jump. */
let hazardTex: THREE.Texture | null = null;
function hazardTexture(): THREE.Texture {
  if (hazardTex) return hazardTex;
  const c = document.createElement("canvas"); c.width = 64; c.height = 16;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffd600"; g.fillRect(0, 0, 64, 16);
  g.fillStyle = "#1b1b1b";
  for (let x = -16; x < 64; x += 16) { g.beginPath(); g.moveTo(x, 16); g.lineTo(x + 8, 16); g.lineTo(x + 16, 0); g.lineTo(x + 8, 0); g.fill(); }
  hazardTex = new THREE.CanvasTexture(c);
  hazardTex.wrapS = THREE.RepeatWrapping; hazardTex.colorSpace = THREE.SRGBColorSpace;
  return hazardTex;
}

/** Ice for a frozen hole: pale, with cracks. */
let iceTex: THREE.Texture | null = null;
function iceTexture(): THREE.Texture {
  if (iceTex) return iceTex;
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#eaf9ff"; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(120,190,230,.7)"; g.lineWidth = 1.2;
  for (let i = 0; i < 26; i++) {
    let x = Math.random() * 256, y = Math.random() * 256;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (Math.random() - 0.5) * 60; y += (Math.random() - 0.5) * 60; g.lineTo(x, y); }
    g.stroke();
  }
  for (let i = 0; i < 200; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.5})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  iceTex = new THREE.CanvasTexture(c);
  iceTex.wrapS = iceTex.wrapT = THREE.RepeatWrapping; iceTex.repeat.set(4, 4); iceTex.colorSpace = THREE.SRGBColorSpace;
  return iceTex;
}

function geometry(m: MeshPart, uv = false): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(m.positions, 3));
  g.setIndex(m.indices);
  if (uv) {
    const uvs: number[] = [];
    for (let i = 0; i < m.positions.length; i += 3) uvs.push(m.positions[i] / CELL, m.positions[i + 2] / CELL);
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  }
  g.computeVertexNormals();
  return g;
}

const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
/** A colour bright enough to bloom: unaffected by tone mapping. */
const neon = (color: string, k = 1.6, opacity = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });

/** A thin bar from a to b. */
function bar(a: THREE.Vector3, b: THREE.Vector3, thick: number, m: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b), mesh = new THREE.Mesh(new THREE.BoxGeometry(thick, thick, len), m);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.lookAt(b);
  return mesh;
}

export class HoleView {
  readonly group = new THREE.Group();
  readonly ball: THREE.Mesh;
  private flag: THREE.Group;
  private flagShader: { uniforms: { time: { value: number } } } | null = null;
  private blades: THREE.Group[] = [];
  private sliders: THREE.Mesh[] = [];
  private bumpers: { mesh: THREE.Mesh; flash: number }[] = [];
  private trail: THREE.Mesh;
  private trailPts: THREE.Vector3[] = [];
  readonly aim: THREE.Group;
  private aimShaft: THREE.Mesh;
  private aimHead: THREE.Mesh;
  private confetti: Confetti;
  private effects: Effects;
  private course: Course;
  private theme: Theme;
  private flagLift = 0;
  private beacon: THREE.Mesh;
  private gold: THREE.Group | null = null;
  private goldSparks: THREE.InstancedMesh | null = null;
  private tmp = new THREE.Object3D();
  private look: BallLook;
  private ballDef: BallDef;
  /** Things the samurai can cut, to flash when it does. */
  private cuttable: { obj: THREE.Object3D; mat: THREE.MeshStandardMaterial; flash: number }[] = [];
  private iceSheet: THREE.Mesh;
  private iceLevel = 0;
  private magnetRings: THREE.Mesh[] = [];
  private magnetBeam: THREE.Mesh;
  private vel = new THREE.Vector3();
  private prevPos = new THREE.Vector3();

  constructor(course: Course, def: HoleDef, theme: Theme, ball: BallDef = BALLS[0]) {
    this.course = course; this.theme = theme; this.ballDef = ball;
    const night = theme.bloom >= 0.8;
    const add = <T extends THREE.Object3D>(o: T, shadows: [boolean, boolean] = [true, true]) => { o.castShadow = shadows[0]; o.receiveShadow = shadows[1]; this.group.add(o); return o; };

    add(new THREE.Mesh(geometry(course.green, true), std("#ffffff", { map: greenTexture(theme.green), roughness: 0.95 })), [false, true]);
    add(new THREE.Mesh(geometry(course.cup), std("#1e1e1e", { side: THREE.DoubleSide, roughness: 1 })), [false, true]);
    add(new THREE.Mesh(geometry(course.sides), std(theme.side, { side: THREE.DoubleSide })));
    add(new THREE.Mesh(geometry(course.skirt), std(theme.side, { side: THREE.DoubleSide })));

    const mats = {
      rail: std(theme.rail, { roughness: 0.55 }),
      block: std(theme.block, { roughness: 0.5, emissive: theme.block, emissiveIntensity: night ? 0.35 : 0 }),
      building: std(theme.building, { roughness: 0.7 })
    };
    const trim = neon(theme.trim, 0.6 + theme.trimGlow * 0.5);
    for (const s of course.solids) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < s.points.length; i += 3) pts.push(new THREE.Vector3(s.points[i], s.points[i + 1], s.points[i + 2]));
      const solid = add(new THREE.Mesh(new ConvexGeometry(pts), s.kind === "rail" ? mats.rail : mats[s.kind].clone()));
      if (s.kind !== "rail") this.cuttable.push({ obj: solid, mat: solid.material as THREE.MeshStandardMaterial, flash: 0 });
      // A glowing strip along the inner top edge of every rail (points 1 and 5: inner side, top, at each end)
      if (s.kind === "rail") add(bar(pts[1].clone().setY(pts[1].y + 0.01), pts[5].clone().setY(pts[5].y + 0.01), 0.05, trim), [false, false]);
    }

    // Jump lips get hazard stripes, lying on the ramp just inside the edge
    for (const lip of course.lips) {
      const A = new THREE.Vector3(...lip.a), B = new THREE.Vector3(...lip.b), len = A.distanceTo(B);
      let n = new THREE.Vector3(B.z - A.z, 0, -(B.x - A.x)).normalize();
      const mid = A.clone().add(B).multiplyScalar(0.5).addScaledVector(n, 0.3);
      if (!course.grid.at(Math.floor(mid.x / CELL), Math.floor(mid.z / CELL))) n = n.negate(); // point onto the ramp
      const w = 0.24, drop = w * (0.6 / CELL), up = 0.006; // the ramp falls 0.6 over a square
      const C = B.clone().addScaledVector(n, w).setY(B.y - drop), D = A.clone().addScaledVector(n, w).setY(A.y - drop);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute([A, B, C, D].flatMap((v) => [v.x, v.y + up, v.z]), 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, len / 0.5, 1, len / 0.5, 0, 0, 0], 2));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      geo.computeVertexNormals();
      add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6, side: THREE.DoubleSide })), [false, true]);
    }

    // The cup: a white rim, the flag, and a beacon of light so you can always see where it is
    const [hx, hy, hz] = course.hole;
    const rim = add(new THREE.Mesh(new THREE.RingGeometry(CUP_RADIUS, CUP_RADIUS + 0.045, 40), neon("#ffffff", 1.1)), [false, false]);
    rim.rotation.x = -Math.PI / 2; rim.position.set(hx, hy + 0.003, hz);
    this.flag = this.makeFlag();
    this.flag.position.set(hx, hy, hz);
    this.group.add(this.flag);
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 14, 24, 1, true).translate(0, 7, 0),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.accent), transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.beacon.position.set(hx, hy, hz);
    add(this.beacon, [false, false]);

    // The golden hole: a glowing gold ring, a gold tube, sparkles going round it
    if (course.gold) {
      const [gx, gy, gz] = course.gold;
      this.gold = new THREE.Group();
      this.gold.position.set(gx, gy, gz);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(GOLD_RADIUS + 0.03, 0.035, 10, 40), neon(GOLD, 2.2));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.02;
      const inside = new THREE.Mesh(new THREE.CylinderGeometry(GOLD_RADIUS * 0.99, GOLD_RADIUS * 0.99, 0.4, 32, 1, true).translate(0, -0.2, 0), new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.9, roughness: 0.25, side: THREE.BackSide, emissive: GOLD, emissiveIntensity: 0.3 }));
      const halo = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      halo.rotation.x = -Math.PI / 2; halo.position.y = 0.006;
      this.gold.add(ring, inside, halo);
      this.group.add(this.gold);
      this.goldSparks = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.045, 0), neon("#fff2b0", 2.5), 14);
      this.goldSparks.frustumCulled = false;
      this.group.add(this.goldSparks);
    }

    // Tee marker
    const tee = add(new THREE.Mesh(new THREE.RingGeometry(0.26, 0.34, 32), neon(theme.accent, 1, 0.5)), [false, false]);
    tee.rotation.x = -Math.PI / 2; tee.position.set(course.tee[0], course.tee[1] + 0.003, course.tee[2]);

    for (const b of course.bumpers) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(BUMPER_RADIUS, BUMPER_RADIUS, 0.5, 32), std(theme.bumper, { roughness: 0.3, emissive: theme.bumper, emissiveIntensity: night ? 0.35 : 0.1 }));
      mesh.position.set(b.x, b.y + 0.25, b.z); add(mesh);
      this.cuttable.push({ obj: mesh, mat: mesh.material as THREE.MeshStandardMaterial, flash: 0 });
      const cap = new THREE.Mesh(new THREE.TorusGeometry(BUMPER_RADIUS * 0.75, 0.04, 8, 32), neon(night ? theme.trim : "#ffffff", night ? 1.2 : 1));
      cap.rotation.x = Math.PI / 2; cap.position.set(b.x, b.y + 0.51, b.z); add(cap, [false, false]);
      this.bumpers.push({ mesh, flash: 0 });
    }

    for (const w of course.windmills) {
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.9, 4), std(theme.roof, { roughness: 0.6 }));
      roof.rotation.y = Math.PI / 4; roof.position.set(w.x, w.hubY - 1.5 + 1.25 + 0.45, w.z); add(roof);
      const blades = new THREE.Group();
      blades.position.set(w.x, w.hubY, w.hubZ);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.16, 16), std(theme.roof));
      hub.rotation.x = Math.PI / 2; blades.add(hub);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2, half = w.bladeLength / 2;
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.26, w.bladeLength, 0.1), std(i % 2 ? theme.roof : theme.building, { roughness: 0.6 }));
        this.cuttable.push({ obj: blade, mat: blade.material as THREE.MeshStandardMaterial, flash: 0 });
        blade.position.set(-Math.sin(a) * half, Math.cos(a) * half, 0); blade.rotation.z = a; blade.castShadow = true;
        // lights along each blade
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, w.bladeLength * 0.85, 0.02), neon(theme.trim, 1.2));
        strip.position.z = 0.06; blade.add(strip);
        blades.add(blade);
      }
      this.group.add(blades); this.blades.push(blades);
    }

    for (const s of def.sliders ?? []) {
      const alongX = s.from[1] === s.to[1];
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 1.8 : 0.7, 0.52, alongX ? 0.7 : 1.8), std(theme.slider, { roughness: 0.45, emissive: theme.slider, emissiveIntensity: night ? 0.4 : 0.05 }));
      // warning lights on top
      for (const x of [-0.6, 0.6]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), neon("#ff1744", 2.5)); l.position.set(alongX ? x : 0, 0.3, alongX ? 0 : x); mesh.add(l); }
      add(mesh); this.sliders.push(mesh);
      this.cuttable.push({ obj: mesh, mat: mesh.material as THREE.MeshStandardMaterial, flash: 0 });
    }

    // The ball you chose: its painted sphere rolls, its topper (hat, crown or antenna) stays upright
    this.look = makeBall(ball, night);
    this.ball = this.look.mesh;
    this.group.add(this.ball, this.look.topper);

    // Frost: a sheet of ice over the water, shown while the hole is frozen (just under the green, so it only shows over water)
    const b = course.bounds;
    this.iceSheet = new THREE.Mesh(new THREE.PlaneGeometry(b.x1 - b.x0 + 1.2, b.z1 - b.z0 + 1.2), new THREE.MeshStandardMaterial({ map: iceTexture(), color: "#dff6ff", roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0, emissive: "#5fd3ff", emissiveIntensity: 0.25, depthWrite: false }));
    this.iceSheet.rotation.x = -Math.PI / 2; this.iceSheet.position.set((b.x0 + b.x1) / 2, -0.012, (b.z0 + b.z1) / 2);
    this.iceSheet.visible = false; this.iceSheet.receiveShadow = true;
    this.group.add(this.iceSheet);
    // Mecha: rings closing in on the cup, and a beam from the ball to it, while the magnet is on
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), neon(ball.colours.accent, 2, 0.8));
      r.rotation.x = -Math.PI / 2; r.position.set(course.hole[0], course.hole[1] + 0.02, course.hole[2]); r.visible = false;
      this.group.add(r); this.magnetRings.push(r);
    }
    this.magnetBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), neon(ball.colours.accent, 2.2, 0.75));
    this.magnetBeam.visible = false; this.group.add(this.magnetBeam);

    // The trail: a glowing ribbon behind the rolling ball, in the ball's colour
    this.trail = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: new THREE.Color(ball.colours.trail).multiplyScalar(1.5), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, vertexColors: true }));
    this.trail.frustumCulled = false;
    this.group.add(this.trail);

    // The aiming arrow: a shaft and a head lying on the green, scaled by power
    this.aim = new THREE.Group();
    const arrowMat = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
    this.aimShaft = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 1).translate(0, 0.5, 0), arrowMat);
    const head = new THREE.Shape(); head.moveTo(-0.24, 0); head.lineTo(0.24, 0); head.lineTo(0, 0.38); head.lineTo(-0.24, 0);
    this.aimHead = new THREE.Mesh(new THREE.ShapeGeometry(head), arrowMat);
    for (const m of [this.aimShaft, this.aimHead]) { m.rotation.x = -Math.PI / 2; m.renderOrder = 5; }
    this.aim.add(this.aimShaft, this.aimHead);
    this.aim.visible = false;
    this.group.add(this.aim);

    this.confetti = new Confetti();
    this.group.add(this.confetti.mesh);
    this.effects = new Effects();
    this.group.add(this.effects.group);
  }

  private makeFlag(): THREE.Group {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.2, 8), std("#f5f5f5", { roughness: 0.4 }));
    pole.position.y = 1.1; pole.castShadow = true; g.add(pole);
    const geo = new THREE.PlaneGeometry(0.75, 0.48, 16, 4).translate(0.375, 0, 0);
    const mat = std("#e53935", { side: THREE.DoubleSide, roughness: 0.7, emissive: "#e53935", emissiveIntensity: this.theme.bloom >= 0.8 ? 0.5 : 0 });
    // The flag waves: a small vertex shader change, stronger towards the free end
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.time = { value: 0 };
      this.flagShader = shader as unknown as { uniforms: { time: { value: number } } };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float time;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          float k = position.x / 0.75;
          transformed.z += sin(position.x * 7.0 - time * 5.0) * 0.07 * k;
          transformed.y += sin(position.x * 4.0 - time * 3.0) * 0.025 * k;`);
    };
    const flag = new THREE.Mesh(geo, mat);
    flag.position.y = 1.95; flag.castShadow = true; g.add(flag);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), neon(GOLD, 1.8));
    top.position.y = 2.22; g.add(top);
    return g;
  }

  /** Copy the simulation into the scene. */
  update(sim: Sim, dt: number, t: number): void {
    const p = sim.ballPosition(), q = sim.ballRotation();
    this.ball.position.set(p[0], p[1], p[2]);
    this.ball.quaternion.set(q.x, q.y, q.z, q.w);
    this.ball.visible = sim.state !== "warp";
    // velocity from the motion between frames (smoothed), for the topper and the effects
    if (dt > 0) this.vel.lerp(new THREE.Vector3(p[0], p[1], p[2]).sub(this.prevPos).divideScalar(dt), Math.min(1, dt * 12));
    this.prevPos.set(p[0], p[1], p[2]);
    const powerOn = sim.slashT > 0 || sim.freezeT > 0 || sim.magnetT > 0;
    this.look.update(dt, t, this.vel, powerOn);
    this.powerEffects(sim, dt, t);

    let bi = 0, si = 0;
    for (const m of sim.moverStates()) {
      if (m.kind === "blade") this.blades[bi++]?.quaternion.set(m.rotation.x, m.rotation.y, m.rotation.z, m.rotation.w);
      else this.sliders[si++]?.position.set(m.position.x, m.position.y, m.position.z);
    }

    if (this.flagShader) this.flagShader.uniforms.time.value = t;
    // The flag lifts out as the ball gets close, like a caddie pulling it; the beacon fades as you approach
    const [hx, , hz] = this.course.hole, dist = Math.hypot(p[0] - hx, p[2] - hz);
    const near = dist < 2.4 && (sim.state === "moving" || sim.state === "warp");
    this.flagLift += ((near ? 1 : 0) - this.flagLift) * Math.min(1, dt * 5);
    this.flag.position.y = this.course.hole[1] + this.flagLift * 1.4;
    (this.flag.children as THREE.Mesh[]).forEach((c) => { const m = c.material as THREE.MeshStandardMaterial; m.transparent = true; m.opacity = 1 - this.flagLift * 0.85; });
    (this.beacon.material as THREE.MeshBasicMaterial).opacity = Math.min(0.09, Math.max(0, (dist - 3) / 40)) * (0.8 + Math.sin(t * 2) * 0.2);

    for (const b of this.bumpers) {
      b.flash = Math.max(0, b.flash - dt * 4);
      const m = b.mesh.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = (this.theme.bloom >= 0.8 ? 0.35 : 0.1) + b.flash * 1.6;
      b.mesh.scale.set(1 + b.flash * 0.15, 1, 1 + b.flash * 0.15);
    }

    if (this.gold && this.goldSparks) {
      const pulse = 1 + Math.sin(t * 4) * 0.08;
      this.gold.children[0].scale.setScalar(pulse);
      for (let i = 0; i < 14; i++) {
        const a = t * 1.6 + (i / 14) * Math.PI * 2, r = 0.45 + Math.sin(t * 2 + i) * 0.08;
        this.tmp.position.set(this.gold.position.x + Math.cos(a) * r, this.gold.position.y + 0.15 + ((t * 0.5 + i / 14) % 1) * 0.8, this.gold.position.z + Math.sin(a) * r);
        this.tmp.rotation.set(t * 3 + i, t * 2, 0);
        this.tmp.scale.setScalar(1 - ((t * 0.5 + i / 14) % 1));
        this.tmp.updateMatrix(); this.goldSparks.setMatrixAt(i, this.tmp.matrix);
      }
      this.goldSparks.instanceMatrix.needsUpdate = true;
    }

    // the trail: a ribbon along the last few positions, fading towards the tail
    if (sim.state === "moving") {
      this.trailPts.push(new THREE.Vector3(p[0], p[1] - BALL_RADIUS * 0.4, p[2]));
      if (this.trailPts.length > 40) this.trailPts.shift();
    } else if (this.trailPts.length) this.trailPts.splice(0, 3);
    this.updateTrail();

    this.confetti.update(dt);
    this.effects.update(dt);
  }

  private updateTrail(): void {
    const pts = this.trailPts, n = pts.length, geo = this.trail.geometry;
    if (n < 2) { geo.setDrawRange(0, 0); return; }
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const side = new THREE.Vector3(b.z - a.z, 0, -(b.x - a.x)).normalize().multiplyScalar(BALL_RADIUS * 0.8 * (i / n));
      pos.push(pts[i].x + side.x, pts[i].y, pts[i].z + side.z, pts[i].x - side.x, pts[i].y, pts[i].z - side.z);
      const k = i / n; col.push(k, k, k, k, k, k);
      if (i < n - 1) { const j = i * 2; idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.setDrawRange(0, idx.length);
  }

  /** Flash the bumper nearest the ball. */
  flashBumper(): void {
    let best: (typeof this.bumpers)[number] | null = null, d = Infinity;
    for (const b of this.bumpers) { const x = b.mesh.position.distanceTo(this.ball.position); if (x < d) { d = x; best = b; } }
    if (best) best.flash = 1;
  }

  showAim(dir: THREE.Vector2 | null, power: number): void {
    if (!dir || power < 0.03) { this.aim.visible = false; return; }
    this.aim.visible = true;
    const len = 0.5 + power * 2.6;
    this.aim.position.set(this.ball.position.x, this.ball.position.y - BALL_RADIUS + 0.02, this.ball.position.z);
    // the arrow is drawn pointing along -z; turn it to the shot direction (dir.x, dir.y) = (dx, dz)
    this.aim.rotation.y = Math.atan2(-dir.x, -dir.y);
    this.aimShaft.scale.y = len; this.aimShaft.position.z = -BALL_RADIUS * 1.6;
    this.aimHead.position.z = -BALL_RADIUS * 1.6 - len;
    // green → yellow → red with power
    const c = new THREE.Color().setHSL(0.33 - power * 0.33, 0.95, 0.55).multiplyScalar(1.3);
    (this.aimShaft.material as THREE.MeshBasicMaterial).color.copy(c);
  }

  /** What the special powers look like while they're running. */
  private powerEffects(sim: Sim, dt: number, t: number): void {
    // frost: the ice sheet fades in and out; the windmill and moving blocks frost over
    this.iceLevel += ((sim.freezeT > 0 ? 1 : 0) - this.iceLevel) * Math.min(1, dt * 6);
    const ice = this.iceSheet.material as THREE.MeshStandardMaterial;
    ice.opacity = this.iceLevel * 0.85; this.iceSheet.visible = this.iceLevel > 0.01;
    // mecha: rings shrink onto the cup, a beam joins ball and cup
    const pulling = sim.magnetT > 0 && sim.state === "moving";
    this.magnetRings.forEach((r, i) => {
      r.visible = pulling;
      const k = 1 - ((t * 1.2 + i / 3) % 1);
      r.scale.setScalar(0.4 + k * 3.2); (r.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
    });
    const [hx, hy, hz] = this.course.hole, bp = this.ball.position, d = Math.hypot(bp.x - hx, bp.z - hz);
    this.magnetBeam.visible = pulling && d < 5 && d > 0.2;
    if (this.magnetBeam.visible) {
      this.magnetBeam.position.copy(bp); this.magnetBeam.lookAt(hx, hy + 0.05, hz);
      this.magnetBeam.scale.set(1 + Math.sin(t * 40) * 0.4, 1 + Math.sin(t * 40) * 0.4, bp.distanceTo(new THREE.Vector3(hx, hy + 0.05, hz)));
    }
    // samurai: the ball glows hot while the blade is out; whatever it cut flashes
    const ballMat = this.ball.material as THREE.MeshStandardMaterial;
    if (this.ballDef.id === "samurai") ballMat.emissiveIntensity = sim.slashT > 0 ? 0.6 + Math.sin(t * 30) * 0.2 : this.theme.bloom >= 0.8 ? 0.12 : 0;
    for (const c of this.cuttable) {
      const frozen = this.iceLevel > 0.02 && (this.blades.some((g) => g.children.includes(c.obj)) || this.sliders.includes(c.obj as THREE.Mesh));
      c.flash = Math.max(0, c.flash - dt * 3);
      if (c.flash > 0) { c.mat.emissive.set("#ffffff"); c.mat.emissiveIntensity = c.flash * 1.4; }
      else if (frozen) { c.mat.emissive.set("#7fdcff"); c.mat.emissiveIntensity = this.iceLevel * 0.6; }
      else if (c.mat.userData.base === undefined) { c.mat.userData.base = [c.mat.emissive.getHex(), c.mat.emissiveIntensity]; }
      else { c.mat.emissive.setHex(c.mat.userData.base[0]); c.mat.emissiveIntensity = c.mat.userData.base[1]; }
    }
  }

  /** Samurai: the draw (a crescent slash ahead of the ball). */
  slash(): void { this.effects.slash(this.ball.position, this.vel, this.ballDef.colours.accent); }
  /** Samurai: it went through something. An X of light where it cut, sparks, and the thing flashes. */
  cutAt(at: [number, number, number]): void {
    const p = new THREE.Vector3(...at);
    this.effects.cross(p, this.vel);
    this.confetti.burst(p, ["#ffffff", "#ffd54f", "#ff4d5e"], 0.45);
    let best: (typeof this.cuttable)[number] | null = null, bd = Infinity;
    for (const c of this.cuttable) { const d = c.obj.getWorldPosition(new THREE.Vector3()).distanceTo(p); if (d < bd) { bd = d; best = c; } }
    if (best && bd < 2.2) best.flash = 1;
  }
  /** Frost: a ring of frost spreads from the ball, and snow bursts up. */
  freezeBurst(): void { this.effects.frost(this.ball.position); this.confetti.burst(this.ball.position.clone(), ["#ffffff", "#e6fbff", "#bfefff", "#8fe3ff"], 0.6); }
  /** Frost: the ice cracks away. */
  thaw(): void { this.effects.frost(this.ball.position, true); }
  /** Mecha: the magnet switches on. */
  magnetOn(): void { this.effects.ring(this.ball.position, this.ballDef.colours.accent); this.effects.ring(new THREE.Vector3(...this.course.hole), this.ballDef.colours.accent); }

  /** Power-up effects: a puff of fart cloud behind the ball, and a ring when it jumps. */
  puff(): void { this.effects.puff(this.ball.position); }
  ring(): void { this.effects.ring(this.ball.position); }

  /** Confetti from the cup; gold sparks for a hole in one. */
  celebrate(ace: boolean): void {
    this.confetti.burst(new THREE.Vector3(...this.course.hole), ace ? GOLD_PALETTE : undefined, ace ? 1.5 : 1);
  }
  /** Gold sparks where the ball went into the golden hole, then at the cup when it comes out. */
  sparkle(at: "gold" | "cup"): void {
    const p = at === "gold" && this.course.gold ? this.course.gold : this.course.hole;
    this.confetti.burst(new THREE.Vector3(...p), GOLD_PALETTE, 0.7);
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
    });
  }
}

const GOLD_PALETTE = ["#ffd54f", "#ffecb3", "#ffc107", "#fff8e1", "#ffb300"];

/** A burst of confetti: instanced little squares with their own simple physics. */
class Confetti {
  readonly mesh: THREE.InstancedMesh;
  private parts: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; life: number }[] = [];
  private tmp = new THREE.Object3D();
  private palette = ["#ef5350", "#ffca28", "#66bb6a", "#42a5f5", "#ab47bc", "#ffffff"];
  constructor(count = 220) {
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.09, 0.14), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), count);
    for (let i = 0; i < count; i++) this.parts.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), life: 0 });
    this.mesh.count = 0; this.mesh.frustumCulled = false;
  }
  burst(at: THREE.Vector3, palette = this.palette, power = 1): void {
    const colours = palette.map((c) => new THREE.Color(c).multiplyScalar(1.4));
    this.parts.forEach((c, i) => {
      const a = Math.random() * Math.PI * 2, s = (1.5 + Math.random() * 3) * power;
      c.p.copy(at).add(new THREE.Vector3(0, 0.2, 0));
      c.v.set(Math.cos(a) * s * 0.5, (4 + Math.random() * 4) * power, Math.sin(a) * s * 0.5);
      c.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      c.w.set(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5);
      c.life = 2.2 + Math.random();
      this.mesh.setColorAt(i, colours[i % colours.length]);
    });
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.count = this.parts.length;
  }
  update(dt: number): void {
    if (!this.mesh.count) return;
    let alive = 0;
    this.parts.forEach((c, i) => {
      c.life -= dt;
      if (c.life > 0) {
        alive++;
        c.v.y -= 9 * dt; c.v.multiplyScalar(1 - dt * 1.6);
        c.p.addScaledVector(c.v, dt);
        c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
      }
      this.tmp.position.copy(c.p); this.tmp.rotation.copy(c.r);
      this.tmp.scale.setScalar(c.life > 0 ? Math.min(1, c.life) : 0);
      this.tmp.updateMatrix(); this.mesh.setMatrixAt(i, this.tmp.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (!alive) this.mesh.count = 0;
  }
}

/** Short-lived effects for the power-ups: a cloud of puffs that swell and fade, and an expanding ring. */
class Effects {
  readonly group = new THREE.Group();
  private puffs: { mesh: THREE.Mesh; v: THREE.Vector3; life: number; size: number }[] = [];
  private rings: { mesh: THREE.Mesh; life: number; grow: number }[] = [];
  private puffGeo = new THREE.IcosahedronGeometry(0.16, 1);
  private ringGeo = new THREE.RingGeometry(0.2, 0.28, 40);

  puff(at: THREE.Vector3): void {
    const colours = ["#9ccc65", "#c5e1a5", "#aed581", "#d4e157"];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(this.puffGeo, new THREE.MeshStandardMaterial({ color: colours[i % 4], transparent: true, opacity: 0.85, roughness: 1, depthWrite: false }));
      m.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.05 + Math.random() * 0.15, (Math.random() - 0.5) * 0.3));
      this.group.add(m);
      this.puffs.push({ mesh: m, v: new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8), life: 1.2 + Math.random() * 0.5, size: 0.6 + Math.random() * 0.8 });
    }
  }
  /** Short glowing arcs: the samurai's draw and cuts. */
  private arcs: { mesh: THREE.Mesh; life: number; max: number; grow: number }[] = [];
  private arc(at: THREE.Vector3, yaw: number, tilt: number, colour: string, size: number, life: number): void {
    const m = new THREE.Mesh(new THREE.RingGeometry(size * 0.82, size, 40, 1, -Math.PI * 0.45, Math.PI * 0.9),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(colour).multiplyScalar(2.2), transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    m.position.copy(at); m.rotation.set(0, yaw, 0); m.rotateX(tilt);
    this.group.add(m); this.arcs.push({ mesh: m, life, max: life, grow: 1.6 });
  }
  slash(at: THREE.Vector3, vel: THREE.Vector3, colour: string): void {
    const yaw = Math.atan2(vel.x, vel.z);
    this.arc(at.clone().add(new THREE.Vector3(0, 0.15, 0)), yaw, Math.PI / 2 - 0.5, "#ffffff", 0.7, 0.35);
    this.arc(at.clone().add(new THREE.Vector3(0, 0.15, 0)), yaw, Math.PI / 2 - 0.3, colour, 0.85, 0.45);
  }
  cross(at: THREE.Vector3, vel: THREE.Vector3): void {
    const yaw = Math.atan2(vel.x, vel.z) + Math.PI / 2;
    this.arc(at.clone().add(new THREE.Vector3(0, 0.25, 0)), yaw, 0.8, "#ffffff", 0.55, 0.4);
    this.arc(at.clone().add(new THREE.Vector3(0, 0.25, 0)), yaw, -0.8, "#ff4d5e", 0.55, 0.4);
  }
  frost(at: THREE.Vector3, cracking = false): void {
    for (let i = 0; i < (cracking ? 1 : 2); i++) {
      const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(cracking ? "#ffffff" : "#8fe3ff").multiplyScalar(1.6), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
      m.rotation.x = -Math.PI / 2; m.position.copy(at).setY(at.y - BALL_RADIUS + 0.03);
      this.group.add(m); this.rings.push({ mesh: m, life: 0.6 + i * 0.25, grow: cracking ? 14 : 22 });
    }
  }
  ring(at: THREE.Vector3, colour = "#80d8ff"): void {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(colour).multiplyScalar(1.5), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.position.copy(at).setY(at.y - BALL_RADIUS + 0.02);
    this.group.add(m); this.rings.push({ mesh: m, life: 0.6, grow: 9 });
  }
  update(dt: number): void {
    this.puffs = this.puffs.filter((p) => {
      p.life -= dt;
      p.mesh.position.addScaledVector(p.v, dt); p.v.multiplyScalar(1 - dt * 1.5);
      p.mesh.scale.setScalar(p.size * (1 + (1.6 - p.life) * 1.4));
      (p.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, Math.min(0.85, p.life));
      if (p.life > 0) return true;
      this.group.remove(p.mesh); (p.mesh.material as THREE.Material).dispose(); return false;
    });
    this.arcs = this.arcs.filter((a) => {
      a.life -= dt;
      const k = 1 - a.life / a.max;
      a.mesh.scale.setScalar(1 + k * a.grow * 0.4);
      (a.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, a.life / a.max);
      if (a.life > 0) return true;
      this.group.remove(a.mesh); a.mesh.geometry.dispose(); (a.mesh.material as THREE.Material).dispose(); return false;
    });
    this.rings = this.rings.filter((r) => {
      r.life -= dt;
      r.mesh.scale.setScalar(1 + Math.max(0, 0.6 - r.life) * r.grow);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, r.life * 1.5);
      if (r.life > 0) return true;
      this.group.remove(r.mesh); (r.mesh.material as THREE.Material).dispose(); return false;
    });
  }
}

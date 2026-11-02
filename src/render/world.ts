import * as THREE from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import { BUMPER_RADIUS, CUP_RADIUS, type Course, type MeshPart } from "../course/build.ts";
import { CELL, type HoleDef } from "../course/parse.ts";
import { BALL_RADIUS, type Sim } from "../game/physics.ts";

/**
 * What you see: the course drawn from the same triangles the ball rolls on, plus the ball, the flag, moving parts,
 * the aiming arrow and a few effects. A HoleView is built per hole and thrown away after it.
 */

export const COLORS = {
  sky: "#bfe3f2", horizon: "#f6efe2", water: "#5fb3c9",
  green: "#4caf50", greenDark: "#43a047", side: "#8d6e63", rail: "#f4ead8", railTop: "#e9dcc4",
  block: "#ef7d57", building: "#fbf7ef", roof: "#d6453d", blade: "#fbf7ef", slider: "#ffb300",
  bumper: "#ec4899", ball: "#ffffff", cup: "#2b2b2b", flag: "#e53935"
};

/** Mown stripes, one light and one dark band per square. */
function greenTexture(): THREE.Texture {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = COLORS.green; g.fillRect(0, 0, 128, 128);
  g.fillStyle = COLORS.greenDark; g.fillRect(0, 64, 128, 64);
  // a little speckle so it reads as grass, not plastic
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? "255,255,255" : "0,40,0"},${Math.random() * 0.06})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
let greenTex: THREE.Texture | null = null;

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

export class HoleView {
  readonly group = new THREE.Group();
  readonly ball: THREE.Mesh;
  private flag: THREE.Group;
  private flagShader: { uniforms: { time: { value: number } } } | null = null;
  private blades: THREE.Group[] = [];
  private sliders: THREE.Mesh[] = [];
  private bumpers: { mesh: THREE.Mesh; flash: number }[] = [];
  private trail: THREE.Line;
  private trailPts: THREE.Vector3[] = [];
  readonly aim: THREE.Group;
  private aimShaft: THREE.Mesh;
  private aimHead: THREE.Mesh;
  private confetti: Confetti;
  private course: Course;
  private flagLift = 0;

  constructor(course: Course, def: HoleDef) {
    this.course = course;
    greenTex ??= greenTexture();
    const add = (o: THREE.Object3D, shadows: [boolean, boolean] = [true, true]) => { o.castShadow = shadows[0]; o.receiveShadow = shadows[1]; this.group.add(o); return o; };

    add(new THREE.Mesh(geometry(course.green, true), std("#ffffff", { map: greenTex, roughness: 0.95 })), [false, true]);
    add(new THREE.Mesh(geometry(course.cup), std(COLORS.cup, { side: THREE.DoubleSide, roughness: 1 })), [false, true]);
    add(new THREE.Mesh(geometry(course.sides), std(COLORS.side, { side: THREE.DoubleSide })));
    add(new THREE.Mesh(geometry(course.skirt), std(COLORS.side, { side: THREE.DoubleSide })));

    const mats = { rail: std(COLORS.rail, { roughness: 0.6 }), block: std(COLORS.block, { roughness: 0.55 }), building: std(COLORS.building, { roughness: 0.7 }) };
    for (const s of course.solids) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < s.points.length; i += 3) pts.push(new THREE.Vector3(s.points[i], s.points[i + 1], s.points[i + 2]));
      add(new THREE.Mesh(new ConvexGeometry(pts), mats[s.kind]));
    }

    // A white ring round the cup, and the flag
    const [hx, hy, hz] = course.hole;
    const rim = add(new THREE.Mesh(new THREE.RingGeometry(CUP_RADIUS, CUP_RADIUS + 0.04, 40), new THREE.MeshBasicMaterial({ color: "#ffffff" })), [false, false]);
    rim.rotation.x = -Math.PI / 2; rim.position.set(hx, hy + 0.003, hz);
    this.flag = this.makeFlag();
    this.flag.position.set(hx, hy, hz);
    this.group.add(this.flag);

    // Tee marker
    const tee = add(new THREE.Mesh(new THREE.CircleGeometry(0.32, 32), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.35 })), [false, false]);
    tee.rotation.x = -Math.PI / 2; tee.position.set(course.tee[0], course.tee[1] + 0.003, course.tee[2]);

    for (const b of course.bumpers) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(BUMPER_RADIUS, BUMPER_RADIUS, 0.5, 32), std(COLORS.bumper, { roughness: 0.3, emissive: COLORS.bumper, emissiveIntensity: 0 }));
      mesh.position.set(b.x, b.y + 0.25, b.z); add(mesh);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(BUMPER_RADIUS * 0.55, BUMPER_RADIUS * 0.55, 0.52, 24), std("#ffffff", { roughness: 0.3 }));
      cap.position.copy(mesh.position); add(cap);
      this.bumpers.push({ mesh, flash: 0 });
    }

    for (const w of course.windmills) {
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.9, 4), std(COLORS.roof, { roughness: 0.6 }));
      roof.rotation.y = Math.PI / 4; roof.position.set(w.x, w.hubY - 1.5 + 1.25 + 0.45, w.z); add(roof);
      const blades = new THREE.Group();
      blades.position.set(w.x, w.hubY, w.hubZ);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.16, 16), std(COLORS.roof));
      hub.rotation.x = Math.PI / 2; blades.add(hub);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2, half = w.bladeLength / 2;
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.26, w.bladeLength, 0.1), std(i % 2 ? COLORS.roof : COLORS.blade, { roughness: 0.6 }));
        blade.position.set(-Math.sin(a) * half, Math.cos(a) * half, 0); blade.rotation.z = a; blade.castShadow = true;
        blades.add(blade);
      }
      this.group.add(blades); this.blades.push(blades);
    }

    for (const s of def.sliders ?? []) {
      const alongX = s.from[1] === s.to[1];
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 1.8 : 0.7, 0.52, alongX ? 0.7 : 1.8), std(COLORS.slider, { roughness: 0.5 }));
      add(mesh); this.sliders.push(mesh);
    }

    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 32, 20), std(COLORS.ball, { roughness: 0.35 }));
    this.ball.castShadow = true;
    // a stripe so you can see it roll
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(BALL_RADIUS * 1.001, 0.012, 6, 40), new THREE.MeshBasicMaterial({ color: "#ff7043" }));
    this.ball.add(stripe);
    this.group.add(this.ball);

    this.trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.5 }));
    this.trail.frustumCulled = false;
    this.group.add(this.trail);

    // The aiming arrow: a shaft and a head lying on the green, scaled by power
    this.aim = new THREE.Group();
    const arrowMat = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, depthWrite: false });
    this.aimShaft = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 1).translate(0, 0.5, 0), arrowMat);
    const head = new THREE.Shape(); head.moveTo(-0.24, 0); head.lineTo(0.24, 0); head.lineTo(0, 0.38); head.lineTo(-0.24, 0);
    this.aimHead = new THREE.Mesh(new THREE.ShapeGeometry(head), arrowMat);
    for (const m of [this.aimShaft, this.aimHead]) { m.rotation.x = -Math.PI / 2; m.renderOrder = 5; }
    this.aim.add(this.aimShaft, this.aimHead);
    this.aim.visible = false;
    this.group.add(this.aim);

    this.confetti = new Confetti();
    this.group.add(this.confetti.mesh);
  }

  private makeFlag(): THREE.Group {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.2, 8), std("#f5f5f5", { roughness: 0.4 }));
    pole.position.y = 1.1; pole.castShadow = true; g.add(pole);
    const geo = new THREE.PlaneGeometry(0.75, 0.48, 16, 4).translate(0.375, 0, 0);
    const mat = std(COLORS.flag, { side: THREE.DoubleSide, roughness: 0.7 });
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
    return g;
  }

  /** Copy the simulation into the scene. */
  update(sim: Sim, dt: number, t: number): void {
    const p = sim.ballPosition(), q = sim.ballRotation();
    this.ball.position.set(p[0], p[1], p[2]);
    this.ball.quaternion.set(q.x, q.y, q.z, q.w);

    sim.moverStates().forEach((m, i) => {
      if (m.kind === "blade") this.blades[i]?.quaternion.set(m.rotation.x, m.rotation.y, m.rotation.z, m.rotation.w);
    });
    let si = 0;
    for (const m of sim.moverStates()) if (m.kind === "slider") this.sliders[si++]?.position.set(m.position.x, m.position.y, m.position.z);

    if (this.flagShader) this.flagShader.uniforms.time.value = t;
    // The flag lifts out as the ball gets close, like a caddie pulling it
    const [hx, , hz] = this.course.hole, near = Math.hypot(p[0] - hx, p[2] - hz) < 2.4 && sim.state === "moving";
    this.flagLift += ((near ? 1 : 0) - this.flagLift) * Math.min(1, dt * 5);
    this.flag.position.y = this.course.hole[1] + this.flagLift * 1.4;
    (this.flag.children as THREE.Mesh[]).forEach((c) => { const m = c.material as THREE.MeshStandardMaterial; m.transparent = true; m.opacity = 1 - this.flagLift * 0.85; });

    for (const b of this.bumpers) {
      b.flash = Math.max(0, b.flash - dt * 4);
      (b.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = b.flash * 0.9;
      b.mesh.scale.setScalar(1 + b.flash * 0.12);
    }

    // trail while the ball is moving
    if (sim.state === "moving") {
      this.trailPts.push(new THREE.Vector3(p[0], p[1] - BALL_RADIUS * 0.6, p[2]));
      if (this.trailPts.length > 36) this.trailPts.shift();
    } else if (this.trailPts.length) this.trailPts.splice(0, 2);
    this.trail.geometry.setFromPoints(this.trailPts);

    this.confetti.update(dt);
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
    const c = new THREE.Color().setHSL(0.33 - power * 0.33, 0.9, 0.55);
    (this.aimShaft.material as THREE.MeshBasicMaterial).color.copy(c);
  }

  celebrate(): void { this.confetti.burst(new THREE.Vector3(...this.course.hole)); }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
    });
  }
}

/** A burst of confetti from the cup: instanced little squares with their own simple physics. */
class Confetti {
  readonly mesh: THREE.InstancedMesh;
  private parts: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; life: number }[] = [];
  private tmp = new THREE.Object3D();
  constructor(count = 140) {
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.09, 0.14), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), count);
    const palette = ["#ef5350", "#ffca28", "#66bb6a", "#42a5f5", "#ab47bc", "#ffffff"].map((c) => new THREE.Color(c));
    for (let i = 0; i < count; i++) { this.mesh.setColorAt(i, palette[i % palette.length]); this.parts.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), life: 0 }); }
    this.mesh.count = 0; this.mesh.frustumCulled = false;
  }
  burst(at: THREE.Vector3): void {
    for (const c of this.parts) {
      const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3;
      c.p.copy(at).add(new THREE.Vector3(0, 0.2, 0));
      c.v.set(Math.cos(a) * s * 0.5, 4 + Math.random() * 4, Math.sin(a) * s * 0.5);
      c.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      c.w.set(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5);
      c.life = 2.2 + Math.random();
    }
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

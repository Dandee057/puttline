import * as THREE from "three";
import { BALL_RADIUS } from "../game/physics.ts";
import type { BallDef } from "../game/balls.ts";

/**
 * How the three balls look. Each is a sphere with its own painted texture (which rolls with the ball) and a
 * "topper" that stays upright and turns to face the way it's rolling: the samurai's topknot and headband ribbons,
 * the frost ball's ice crown, the mecha ball's antenna and visor.
 */

const R = BALL_RADIUS;
const neon = (color: string, k = 1.6, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });

/* ---------- Painted textures (equirectangular: u around the ball, v from pole to pole) ---------- */

function paint(def: BallDef, w = 512, h = 256): { map: HTMLCanvasElement; glow: HTMLCanvasElement | null } {
  const map = document.createElement("canvas"); map.width = w; map.height = h;
  const g = map.getContext("2d")!;
  let glow: HTMLCanvasElement | null = null;
  if (def.id === "samurai") {
    // deep red lacquer, a black band round the middle with gold edges, a gold crest each side
    const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, "#7d0a19"); grd.addColorStop(0.5, "#c8172f"); grd.addColorStop(1, "#7d0a19");
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = "#141014"; g.fillRect(0, h * 0.44, w, h * 0.12);
    g.fillStyle = def.colours.accent; g.fillRect(0, h * 0.43, w, h * 0.012); g.fillRect(0, h * 0.558, w, h * 0.012);
    for (let x = 6; x < w; x += 22) { g.fillStyle = "#e8d9b5"; g.fillRect(x, h * 0.495, 10, 3); } // stitching
    for (const u of [0.25, 0.75]) crest(g, u * w, h * 0.28, h * 0.11, def.colours.accent);
    for (const u of [0, 0.5]) crest(g, u * w, h * 0.72, h * 0.08, "#f3e3b5");
  } else if (def.id === "frost") {
    // pale ice with crystal facets and snowflakes; the facet lines glow
    g.fillStyle = "#d8f3ff"; g.fillRect(0, 0, w, h);
    glow = document.createElement("canvas"); glow.width = w; glow.height = h;
    const gg = glow.getContext("2d")!; gg.fillStyle = "#000"; gg.fillRect(0, 0, w, h);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 46; i++) {
      const x = rnd() * w, y = h * 0.12 + rnd() * h * 0.76, r = 18 + rnd() * 40;
      g.fillStyle = `rgba(${150 + rnd() * 60},${215 + rnd() * 40},255,${0.35 + rnd() * 0.4})`;
      g.beginPath(); for (let k = 0; k < 3; k++) { const a = rnd() * Math.PI * 2; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } g.closePath(); g.fill();
      for (const c of [g, gg]) { c.strokeStyle = c === g ? "rgba(255,255,255,.85)" : "#5fd3ff"; c.lineWidth = 1.5; c.stroke(); }
    }
    for (const [u, v, s] of [[0.15, 0.35, 22], [0.4, 0.65, 18], [0.65, 0.3, 24], [0.9, 0.6, 18]] as const) snowflake(g, u * w, v * h, s, "#ffffff");
  } else {
    // brushed chrome with panel lines, rivets and a glowing seam
    const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, "#8f9aa6"); grd.addColorStop(0.5, "#e2e8ee"); grd.addColorStop(1, "#8f9aa6");
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 3) { g.fillStyle = `rgba(255,255,255,${0.04 + ((y * 7) % 5) * 0.012})`; g.fillRect(0, y, w, 1); }
    g.strokeStyle = "#4b5560"; g.lineWidth = 3;
    for (const u of [0.125, 0.375, 0.625, 0.875]) { g.beginPath(); g.moveTo(u * w, h * 0.12); g.lineTo(u * w, h * 0.88); g.stroke(); }
    for (const v of [0.3, 0.7]) { g.beginPath(); g.moveTo(0, v * h); g.lineTo(w, v * h); g.stroke(); }
    g.fillStyle = "#59636e"; for (let u = 0.0625; u < 1; u += 0.125) for (const v of [0.26, 0.74]) { g.beginPath(); g.arc(u * w, v * h, 3, 0, 7); g.fill(); }
    glow = document.createElement("canvas"); glow.width = w; glow.height = h;
    const gg = glow.getContext("2d")!; gg.fillStyle = "#000"; gg.fillRect(0, 0, w, h);
    for (const c of [g, gg]) { c.fillStyle = def.colours.accent; c.fillRect(0, h * 0.49, w, h * 0.03); for (const u of [0.25, 0.75]) { c.beginPath(); c.arc(u * w, h * 0.5, 9, 0, 7); c.fill(); } }
  }
  return { map, glow };
}
function crest(g: CanvasRenderingContext2D, x: number, y: number, r: number, col: string): void {
  // a simple round crest: a ring and three petals
  g.strokeStyle = col; g.lineWidth = r * 0.16; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
  g.fillStyle = col;
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 - Math.PI / 2; g.beginPath(); g.ellipse(x + Math.cos(a) * r * 0.42, y + Math.sin(a) * r * 0.42, r * 0.36, r * 0.2, a, 0, Math.PI * 2); g.fill(); }
}
function snowflake(g: CanvasRenderingContext2D, x: number, y: number, s: number, col: string): void {
  g.strokeStyle = col; g.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, ex = x + Math.cos(a) * s, ey = y + Math.sin(a) * s;
    g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke();
    const mx = x + Math.cos(a) * s * 0.6, my = y + Math.sin(a) * s * 0.6;
    for (const b of [-0.6, 0.6]) { g.beginPath(); g.moveTo(mx, my); g.lineTo(mx + Math.cos(a + b) * s * 0.3, my + Math.sin(a + b) * s * 0.3); g.stroke(); }
  }
}

const textures = new Map<string, { map: THREE.Texture; glow: THREE.Texture | null }>();
function texturesFor(def: BallDef) {
  if (textures.has(def.id)) return textures.get(def.id)!;
  const p = paint(def);
  const tex = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const out = { map: tex(p.map), glow: p.glow ? tex(p.glow) : null };
  textures.set(def.id, out);
  return out;
}

/* ---------- The 3D ball ---------- */

export interface BallLook {
  /** The sphere: rolls with the physics. */
  mesh: THREE.Mesh;
  /** Stays upright on top of the ball, turned to face the way it rolls. */
  topper: THREE.Group;
  /** Call each frame with the ball's velocity and whether its power is running. */
  update(dt: number, t: number, vel: THREE.Vector3, powerOn: boolean): void;
}

export function makeBall(def: BallDef, night: boolean): BallLook {
  const tx = texturesFor(def);
  const geo = new THREE.SphereGeometry(R, 40, 24);
  let mat: THREE.MeshStandardMaterial;
  if (def.id === "samurai") mat = new THREE.MeshPhysicalMaterial({ map: tx.map, roughness: 0.28, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08, emissive: "#ff2040", emissiveIntensity: night ? 0.12 : 0 });
  else if (def.id === "frost") mat = new THREE.MeshPhysicalMaterial({ map: tx.map, roughness: 0.08, metalness: 0.1, clearcoat: 1, emissiveMap: tx.glow, emissive: "#5fd3ff", emissiveIntensity: 0.6, sheen: 0.4, sheenColor: new THREE.Color("#bfefff") });
  else mat = new THREE.MeshStandardMaterial({ map: tx.map, roughness: 0.22, metalness: 0.85, emissiveMap: tx.glow, emissive: def.colours.accent, emissiveIntensity: 1.2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;

  const topper = new THREE.Group();
  let animate: (dt: number, t: number, speed: number, powerOn: boolean) => void = () => {};

  if (def.id === "samurai") {
    // a white headband round the top of the ball, its knot and two ribbons at the back, and a black topknot
    const band = new THREE.Mesh(new THREE.TorusGeometry(R * 0.86, R * 0.11, 8, 36), new THREE.MeshStandardMaterial({ color: "#f5f1e6", roughness: 0.6 }));
    band.rotation.x = Math.PI / 2; band.position.y = R * 0.5; topper.add(band);
    const sun = new THREE.Mesh(new THREE.CircleGeometry(R * 0.13, 16), new THREE.MeshBasicMaterial({ color: "#d81b2c" }));
    sun.position.set(0, R * 0.5, -R * 0.99); sun.rotation.y = Math.PI; topper.add(sun); // the red sun on the front of the band
    const knot = new THREE.Mesh(new THREE.SphereGeometry(R * 0.16, 10, 8), band.material); knot.position.set(0, R * 0.5, R * 0.9); topper.add(knot);
    const ribbons: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const rib = new THREE.Mesh(new THREE.PlaneGeometry(R * 0.22, R * 1.4).translate(0, -R * 0.7, 0), new THREE.MeshStandardMaterial({ color: "#f5f1e6", side: THREE.DoubleSide, roughness: 0.7 }));
      rib.position.set(side * R * 0.08, R * 0.5, R * 0.95); topper.add(rib); ribbons.push(rib);
    }
    const knotTop = new THREE.Mesh(new THREE.CapsuleGeometry(R * 0.13, R * 0.35, 4, 8), new THREE.MeshStandardMaterial({ color: "#16121a", roughness: 0.5 }));
    knotTop.position.set(0, R * 1.05, R * 0.15); knotTop.rotation.x = -0.9; topper.add(knotTop);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(R * 0.08, R * 0.08, R * 2.2), neon("#ffffff", 2.2, 0.9));
    blade.position.set(R * 1.2, R * 0.2, 0); blade.visible = false; topper.add(blade); // the drawn katana, shown while slashing
    animate = (_dt, t, speed, on) => {
      ribbons.forEach((r, i) => { r.rotation.x = 0.35 + Math.min(1.1, speed * 0.12) + Math.sin(t * (8 + speed) + i) * (0.12 + speed * 0.02); r.rotation.z = (i ? 1 : -1) * 0.18; });
      blade.visible = on; blade.rotation.y = on ? Math.sin(t * 30) * 0.4 : 0;
    };
  } else if (def.id === "frost") {
    // a crown of ice crystals, and snowflakes circling it
    const ice = new THREE.MeshStandardMaterial({ color: "#c9f2ff", emissive: "#5fd3ff", emissiveIntensity: 0.7, roughness: 0.1, transparent: true, opacity: 0.9 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2, tall = i % 2 ? 0.55 : 0.8;
      const c = new THREE.Mesh(new THREE.ConeGeometry(R * 0.14, R * tall, 5), ice);
      c.position.set(Math.cos(a) * R * 0.45, R * (0.92 + tall * 0.35), Math.sin(a) * R * 0.45);
      c.rotation.z = -Math.cos(a) * 0.4; c.rotation.x = Math.sin(a) * 0.4; topper.add(c);
    }
    const flakes = new THREE.InstancedMesh(new THREE.OctahedronGeometry(R * 0.09, 0), neon("#e6fbff", 1.8), 6);
    flakes.frustumCulled = false; topper.add(flakes);
    const tmp = new THREE.Object3D();
    animate = (_dt, t, _speed, on) => {
      for (let i = 0; i < 6; i++) {
        const a = t * (on ? 4 : 1.4) + (i / 6) * Math.PI * 2, r = R * (on ? 2.2 : 1.55);
        tmp.position.set(Math.cos(a) * r, R * (0.3 + Math.sin(t * 2 + i) * 0.35), Math.sin(a) * r);
        tmp.rotation.set(t * 3 + i, t * 2, 0); tmp.scale.setScalar(on ? 1.4 : 1); tmp.updateMatrix(); flakes.setMatrixAt(i, tmp.matrix);
      }
      flakes.instanceMatrix.needsUpdate = true;
    };
  } else {
    // an antenna with a blinking light, and a glowing visor across the front
    const metal = new THREE.MeshStandardMaterial({ color: "#c9d2dc", metalness: 0.9, roughness: 0.25 });
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.04, R * 0.05, R * 1.1, 6), metal);
    mast.position.set(0, R * 1.45, R * 0.2); topper.add(mast);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(R * 0.13, 10, 8), neon("#ff3b4e", 2));
    bulb.position.set(0, R * 2.05, R * 0.2); topper.add(bulb);
    const visor = new THREE.Mesh(new THREE.TorusGeometry(R * 1.03, R * 0.1, 6, 24, Math.PI * 0.7), neon(def.colours.accent, 2.2));
    visor.rotation.set(Math.PI / 2, 0, Math.PI * 1.15 + Math.PI / 2); visor.position.y = R * 0.18; topper.add(visor);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 1.5, R * 0.05, 6, 32), neon(def.colours.accent, 1.8, 0.8));
    ring.rotation.x = Math.PI / 2; ring.visible = false; topper.add(ring);
    animate = (_dt, t, _speed, on) => {
      (bulb.material as THREE.MeshBasicMaterial).color.set(on ? "#46ff8f" : "#ff3b4e").multiplyScalar(Math.floor(t * (on ? 8 : 2)) % 2 ? 2.2 : 0.6);
      ring.visible = on; ring.scale.setScalar(1 + ((t * 2) % 1) * 0.8); ring.position.y = -R * 0.6;
      ((ring.material as THREE.MeshBasicMaterial).opacity = 0.9 - ((t * 2) % 1) * 0.8);
    };
  }

  let yaw = 0;
  return {
    mesh, topper,
    update(dt, t, vel, powerOn) {
      topper.position.copy(mesh.position);
      topper.visible = mesh.visible;
      const speed = Math.hypot(vel.x, vel.z);
      // turn to face the way it rolls (the topper's front is -z), smoothly
      if (speed > 0.3) {
        const want = Math.atan2(-vel.x, -vel.z);
        let d = want - yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        yaw += d * Math.min(1, dt * 10);
      }
      topper.rotation.set(0, yaw, 0);
      animate(dt, t, speed, powerOn);
    }
  };
}

/* ---------- A flat preview for the title screen ---------- */

/** The ball drawn as a shaded disc on a 2D canvas, for the ball picker. */
export function ballPreview(def: BallDef, size = 120): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d")!, r = size * 0.33, cx = size / 2, cy = size * 0.62;
  const { map } = paint(def, 256, 128);
  g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
  // the visible half of the texture, squashed towards the edges like a sphere
  for (let x = -r; x < r; x++) {
    const u = Math.asin(x / r) / Math.PI + 0.5, sx = Math.floor((u * 0.5 + 0.12) * map.width) % map.width;
    g.drawImage(map, sx, 0, 1, map.height, cx + x, cy - r, 1, r * 2);
  }
  const shade = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  shade.addColorStop(0, "rgba(255,255,255,.55)"); shade.addColorStop(0.35, "rgba(255,255,255,0)"); shade.addColorStop(1, "rgba(0,0,0,.45)");
  g.fillStyle = shade; g.fillRect(cx - r, cy - r, r * 2, r * 2);
  g.restore();
  // the topper, in 2D
  if (def.id === "samurai") {
    g.fillStyle = "#f5f1e6"; g.fillRect(cx - r * 0.95, cy - r * 0.62, r * 1.9, r * 0.22);
    g.fillStyle = "#d81b2c"; g.beginPath(); g.arc(cx, cy - r * 0.51, r * 0.08, 0, 7); g.fill();
    g.fillStyle = "#f5f1e6"; g.save(); g.translate(cx + r * 0.9, cy - r * 0.5); g.rotate(0.5); g.fillRect(0, 0, r * 0.55, r * 0.14); g.rotate(0.35); g.fillRect(0, r * 0.05, r * 0.5, r * 0.13); g.restore();
    g.fillStyle = "#16121a"; g.save(); g.translate(cx + r * 0.15, cy - r * 1.05); g.rotate(-0.6); g.beginPath(); g.ellipse(0, 0, r * 0.32, r * 0.14, 0, 0, 7); g.fill(); g.restore();
  } else if (def.id === "frost") {
    g.fillStyle = "rgba(201,242,255,.95)"; g.strokeStyle = "#5fd3ff"; g.lineWidth = 1.5;
    for (let i = -2; i <= 2; i++) { const x = cx + i * r * 0.3, hgt = r * (i % 2 ? 0.45 : 0.7); g.beginPath(); g.moveTo(x - r * 0.12, cy - r * 0.86); g.lineTo(x + i * 3, cy - r * 0.86 - hgt); g.lineTo(x + r * 0.12, cy - r * 0.86); g.closePath(); g.fill(); g.stroke(); }
  } else {
    g.strokeStyle = "#c9d2dc"; g.lineWidth = r * 0.08; g.beginPath(); g.moveTo(cx + r * 0.1, cy - r); g.lineTo(cx + r * 0.1, cy - r * 1.55); g.stroke();
    g.fillStyle = "#ff3b4e"; g.beginPath(); g.arc(cx + r * 0.1, cy - r * 1.6, r * 0.13, 0, 7); g.fill();
    g.strokeStyle = def.colours.accent; g.lineWidth = r * 0.16; g.lineCap = "round"; g.beginPath(); g.arc(cx, cy - r * 0.05, r * 1.0, Math.PI * 0.62, Math.PI * 0.38, true); g.stroke();
  }
  return c;
}

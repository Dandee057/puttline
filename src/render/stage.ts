import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { Theme, Particles } from "./themes.ts";

/**
 * Renderer, sky, water (or lava, or space), light, scenery, particles and the camera rig. One per page; each
 * hole sets its theme. A bloom pass makes anything emissive glow; if the frame rate drops it switches itself off.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  readonly sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private below: THREE.Mesh;
  private belowTex: THREE.CanvasTexture;
  private scenery = new THREE.Group();
  private ambient: Ambient | null = null;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private theme: Theme | null = null;
  /** Quality: full (bloom), or low (no bloom, lower resolution) once the frame rate has struggled. */
  quality: "full" | "low" = "full";
  private slowFrames = 0;

  // Camera rig: it orbits a target point at a yaw, pitch and distance, and eases towards the goal values
  yaw = 0; pitch = 0.62; distance = 10;
  readonly target = new THREE.Vector3();
  goal = { yaw: 0, pitch: 0.62, distance: 10, target: new THREE.Vector3() };

  /** The size to draw at; `null` means "the canvas's size on the page". */
  private fixedSize: [number, number] | null = null;

  /**
   * `offscreen`: the cartridge build draws into a canvas that isn't on the page and copies each frame onto a
   * console screen, so it keeps the drawing buffer and draws at exactly the size it's given.
   */
  constructor(canvas: HTMLCanvasElement, opts: { offscreen?: boolean } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: !!opts.offscreen });
    this.renderer.setPixelRatio(opts.offscreen ? 1 : Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.hemi = new THREE.HemisphereLight("#ffffff", "#7a9a6a", 1.6);
    this.sun = new THREE.DirectionalLight("#fff4e0", 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.scenery);

    this.belowTex = ripples();
    this.below = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.1 }));
    this.below.rotation.x = -Math.PI / 2; this.below.position.y = -1.3; this.below.receiveShadow = true;
    this.scene.add(this.below);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setTheme(theme: Theme, bounds: { x0: number; z0: number; x1: number; z1: number }): void {
    this.theme = theme;
    this.scene.background = skyTexture(theme.sky);
    this.scene.fog = new THREE.Fog(theme.fog, theme.fogNear, theme.fogFar);
    this.renderer.toneMappingExposure = theme.exposure;
    this.hemi.color.set(theme.hemiSky); this.hemi.groundColor.set(theme.hemiGround); this.hemi.intensity = theme.hemiIntensity;
    this.sun.color.set(theme.sun); this.sun.intensity = theme.sunIntensity;
    this.bloom.strength = theme.bloom;

    const m = this.below.material as THREE.MeshStandardMaterial;
    this.below.visible = theme.below !== "void";
    m.color.set(theme.belowColor);
    m.map = this.belowTex;
    m.emissive.set(theme.below === "lava" ? theme.belowColor : "#000000");
    m.emissiveIntensity = theme.below === "lava" ? 0.75 : 0;
    m.emissiveMap = theme.below === "lava" ? this.belowTex : null;
    m.roughness = theme.below === "lava" ? 0.8 : 0.25;
    m.needsUpdate = true;

    // scenery and particles round this hole
    this.scenery.traverse((o) => { const x = o as THREE.Mesh; x.geometry?.dispose(); });
    this.scenery.clear();
    const cx = (bounds.x0 + bounds.x1) / 2, cz = (bounds.z0 + bounds.z1) / 2;
    const radius = Math.hypot(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0) / 2;
    let seed = 1234;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    theme.scenery(this.scenery, rand, {
      cx, cz, radius,
      spot(min = 6, max = 24) {
        const a = rand() * Math.PI * 2, d = radius + min + rand() * (max - min);
        return [cx + Math.cos(a) * d, cz + Math.sin(a) * d];
      }
    });
    this.scenery.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.receiveShadow = true; });
    if (this.ambient) { this.scene.remove(this.ambient.mesh); this.ambient.dispose(); }
    this.ambient = new Ambient(theme.particles, theme.particleColor, bounds);
    this.scene.add(this.ambient.mesh);
    this.frameShadows(bounds);
  }

  /** Point the sun's shadow camera at the hole being played. */
  frameShadows(bounds: { x0: number; z0: number; x1: number; z1: number }): void {
    const cx = (bounds.x0 + bounds.x1) / 2, cz = (bounds.z0 + bounds.z1) / 2;
    const r = Math.hypot(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0) / 2 + 3;
    this.sun.position.set(cx + 8, 18, cz + 10); this.sun.target.position.set(cx, 0, cz);
    const cam = this.sun.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 1; cam.far = 60;
    cam.updateProjectionMatrix();
  }

  resize(): void {
    const c = this.renderer.domElement;
    const [w, h] = this.fixedSize ?? [c.clientWidth, c.clientHeight];
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    // narrower screens get a wider view, so the hole still fits on a phone
    this.camera.fov = w / h < 0.8 ? 62 : 45;
    this.camera.updateProjectionMatrix();
  }

  /** Draw at a fixed size (the cartridge build, which has no canvas on the page). */
  setSize(w: number, h: number): void {
    if (this.fixedSize && this.fixedSize[0] === w && this.fixedSize[1] === h) return;
    this.fixedSize = [w, h];
    this.resize();
  }

  /** Ease the camera towards its goal; `snap` jumps straight there. */
  updateCamera(dt: number, snap = false): void {
    const k = snap ? 1 : 1 - Math.exp(-dt * 4);
    let dy = this.goal.yaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy)); // the short way round
    this.yaw += dy * k;
    this.pitch += (this.goal.pitch - this.pitch) * k;
    this.distance += (this.goal.distance - this.distance) * k;
    this.target.lerp(this.goal.target, k);
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.distance,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * cp * this.distance
    );
    this.camera.lookAt(this.target);
  }

  render(t: number, dt: number): void {
    this.belowTex.offset.set(t * 0.01, t * 0.006);
    if (this.theme?.below === "lava") (this.below.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.7 + Math.sin(t * 1.7) * 0.12;
    this.ambient?.update(dt, t);
    this.watchFrameRate(dt);
    if (this.quality === "full" && (this.theme?.bloom ?? 0) > 0) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  /** If frames keep taking over 45 ms, drop the bloom and render at a lower resolution. */
  private watchFrameRate(dt: number): void {
    if (this.quality === "low") return;
    this.slowFrames = dt > 0.045 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2);
    if (this.slowFrames > 90) {
      this.quality = "low";
      this.renderer.setPixelRatio(1);
      this.resize();
    }
  }
}

/** The yaw that puts the camera behind a point, looking along (dx, dz). */
export const yawFacing = (dx: number, dz: number) => Math.atan2(-dx, -dz);

function skyTexture([top, mid, horizon]: [string, string, string]): THREE.Texture {
  const c = document.createElement("canvas"); c.width = 4; c.height = 256;
  const g = c.getContext("2d")!, grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top); grad.addColorStop(0.55, mid); grad.addColorStop(1, horizon);
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft light ripples, scrolled slowly: water shimmer, or the cracks in lava. */
function ripples(): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#c8c8c8"; g.fillRect(0, 0, 256, 256);
  let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 220; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.04 + r() * 0.1})`; g.lineWidth = 1 + r() * 1.5;
    g.beginPath();
    const x = r() * 256, y = r() * 256, w = 10 + r() * 30;
    g.ellipse(x, y, w, w * 0.3, r() * 0.4, 0, Math.PI * 2); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(45, 45); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Things in the air: pollen, leaves, snow, rain, embers, sparkles. Instanced, a couple of hundred at most. */
class Ambient {
  readonly mesh: THREE.InstancedMesh;
  private ps: { p: THREE.Vector3; v: THREE.Vector3; spin: THREE.Vector3; r: THREE.Euler; phase: number }[] = [];
  private tmp = new THREE.Object3D();
  private box: { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number };
  private kind: Particles;
  constructor(kind: Particles, color: string, b: { x0: number; z0: number; x1: number; z1: number }) {
    this.kind = kind;
    const pad = 10;
    this.box = { x0: b.x0 - pad, x1: b.x1 + pad, z0: b.z0 - pad, z1: b.z1 + pad, y0: -1, y1: 12 };
    const count = kind === "rain" ? 260 : kind === "stars" ? 90 : 140;
    const geo = kind === "leaves" || kind === "petals" ? new THREE.PlaneGeometry(0.16, 0.11)
      : kind === "rain" ? new THREE.BoxGeometry(0.015, 0.5, 0.015)
      : kind === "squares" ? new THREE.PlaneGeometry(0.16, 0.16)
      : kind === "stars" ? new THREE.OctahedronGeometry(0.03, 0)
      : new THREE.SphereGeometry(kind === "snow" ? 0.05 : 0.035, 6, 4);
    // bright, untonemapped colours so the glowing kinds pick up bloom
    const glowing = kind === "embers" || kind === "squares" || kind === "stars" || kind === "pollen";
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(glowing ? 1.3 : 1), side: THREE.DoubleSide, transparent: true, opacity: kind === "rain" ? 0.45 : 0.9, toneMapped: !glowing, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, m, count);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      const p = this.spawn(new THREE.Vector3(), true);
      this.ps.push({ p, v: this.velocity(), spin: new THREE.Vector3(Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2), r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), phase: Math.random() * 10 });
    }
  }
  private spawn(p: THREE.Vector3, anywhere: boolean): THREE.Vector3 {
    const b = this.box, falls = ["leaves", "petals", "rain", "snow"].includes(this.kind), rises = this.kind === "embers" || this.kind === "squares";
    const y = anywhere ? b.y0 + Math.random() * (b.y1 - b.y0) : falls ? b.y1 : rises ? b.y0 : b.y0 + Math.random() * (b.y1 - b.y0);
    return p.set(b.x0 + Math.random() * (b.x1 - b.x0), y, b.z0 + Math.random() * (b.z1 - b.z0));
  }
  private velocity(): THREE.Vector3 {
    switch (this.kind) {
      case "rain": return new THREE.Vector3(0.6, -14, 0.3);
      case "snow": return new THREE.Vector3(0.2, -0.7, 0.1);
      case "leaves": case "petals": return new THREE.Vector3(0.5, -0.9, 0.2);
      case "embers": return new THREE.Vector3(0, 1.1 + Math.random(), 0);
      case "squares": return new THREE.Vector3(0, 0.6 + Math.random() * 0.5, 0);
      case "dust": return new THREE.Vector3(0.8, 0.02, 0.2);
      default: return new THREE.Vector3(0.15, 0.05, 0.1);
    }
  }
  update(dt: number, t: number): void {
    const b = this.box;
    this.ps.forEach((q, i) => {
      const sway = Math.sin(t * 1.3 + q.phase);
      q.p.x += (q.v.x + (this.kind === "leaves" || this.kind === "petals" || this.kind === "snow" ? sway * 0.6 : 0)) * dt;
      q.p.y += (q.v.y + (this.kind === "pollen" ? Math.sin(t + q.phase) * 0.15 : 0)) * dt;
      q.p.z += q.v.z * dt;
      if (q.p.y < b.y0 || q.p.y > b.y1 || q.p.x > b.x1 || q.p.x < b.x0 || q.p.z > b.z1 || q.p.z < b.z0) this.spawn(q.p, false);
      if (this.kind !== "rain") { q.r.x += q.spin.x * dt; q.r.y += q.spin.y * dt; q.r.z += q.spin.z * dt; }
      this.tmp.position.copy(q.p);
      this.tmp.rotation.copy(this.kind === "rain" ? new THREE.Euler(0, 0, -0.04) : q.r);
      const s = this.kind === "stars" ? 0.5 + Math.max(0, Math.sin(t * 3 + q.phase * 7)) * 0.9 : this.kind === "embers" ? 0.6 + Math.random() * 0.5 : this.kind === "squares" ? 0.7 : 1;
      this.tmp.scale.setScalar(s);
      this.tmp.updateMatrix();
      this.mesh.setMatrixAt(i, this.tmp.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

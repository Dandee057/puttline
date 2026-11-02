import * as THREE from "three";
import { COLORS } from "./world.ts";

/** Renderer, sky, water, light and the camera rig. One per page; holes come and go inside it. */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
  readonly sun: THREE.DirectionalLight;
  private water: THREE.Mesh;

  // Camera rig: it orbits a target point at a yaw, pitch and distance, and eases towards the goal values
  yaw = 0; pitch = 0.62; distance = 10;
  readonly target = new THREE.Vector3();
  goal = { yaw: 0, pitch: 0.62, distance: 10, target: new THREE.Vector3() };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog(COLORS.horizon, 45, 140);
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#7a9a6a", 1.6));
    this.sun = new THREE.DirectionalLight("#fff4e0", 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.water = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: COLORS.water, roughness: 0.25, metalness: 0.1 }));
    this.water.rotation.x = -Math.PI / 2; this.water.position.y = -1.3; this.water.receiveShadow = true;
    this.scene.add(this.water);
    addScenery(this.scene);
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
    const c = this.renderer.domElement, w = c.clientWidth, h = c.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // narrower screens get a wider view, so the hole still fits on a phone
    this.camera.fov = w / h < 0.8 ? 62 : 45;
    this.camera.updateProjectionMatrix();
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

  render(t: number): void {
    (this.water.material as THREE.MeshStandardMaterial).color.setHSL(0.53, 0.45, 0.55 + Math.sin(t * 0.6) * 0.01);
    this.renderer.render(this.scene, this.camera);
  }
}

/** The yaw that puts the camera behind a point, looking along (dx, dz). */
export const yawFacing = (dx: number, dz: number) => Math.atan2(-dx, -dz);

function skyTexture(): THREE.Texture {
  const c = document.createElement("canvas"); c.width = 4; c.height = 256;
  const g = c.getContext("2d")!, grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#8fd0ec"); grad.addColorStop(0.55, COLORS.sky); grad.addColorStop(1, COLORS.horizon);
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A few low-poly islands and clouds in the distance, so the course isn't floating in nothing. */
function addScenery(scene: THREE.Scene): void {
  const rand = (() => { let s = 99; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const island = new THREE.MeshStandardMaterial({ color: "#7cb35b", roughness: 1, flatShading: true });
  const rock = new THREE.MeshStandardMaterial({ color: "#c9b48a", roughness: 1, flatShading: true });
  const tree = new THREE.MeshStandardMaterial({ color: "#3f8f4f", roughness: 1, flatShading: true });
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2, d = 45 + rand() * 50, r = 3 + rand() * 6;
    const x = 10 + Math.cos(a) * d, z = 10 + Math.sin(a) * d;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.15, 1.2, 7), rock);
    base.position.set(x, -1.0, z); scene.add(base);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r, 0.4, 7), island);
    top.position.set(x, -0.2, z); scene.add(top);
    for (let k = 0; k < 3; k++) {
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.8 + rand(), 2.5 + rand() * 2, 6), tree);
      t.position.set(x + (rand() - 0.5) * r, 1.2, z + (rand() - 0.5) * r); scene.add(t);
    }
  }
  const cloud = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, flatShading: true, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 10; i++) {
    const g = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(2 + rand() * 2, 0), cloud);
      s.position.set(k * 2.4 - 3.6, rand(), rand() * 2); g.add(s);
    }
    const a = rand() * Math.PI * 2, d = 70 + rand() * 60;
    g.position.set(10 + Math.cos(a) * d, 18 + rand() * 14, 10 + Math.sin(a) * d);
    g.scale.y = 0.6; scene.add(g);
  }
}

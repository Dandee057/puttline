import * as THREE from "three";
import type { ThemeName } from "../course/parse.ts";

/**
 * Every hole has its own look: sky, light, colours, glowing trim, scenery round the course and particles in the
 * air. Night themes lean on the bloom pass, so anything emissive (neon trim, bumpers, lava, windows) glows.
 */

export type Particles = "pollen" | "leaves" | "dust" | "squares" | "petals" | "rain" | "snow" | "embers" | "stars";

export interface Theme {
  label: string;
  sky: [string, string, string];        // top, middle, horizon
  fog: string; fogNear: number; fogFar: number;
  sun: string; sunIntensity: number; hemiSky: string; hemiGround: string; hemiIntensity: number;
  exposure: number;
  /** "water" is the usual blue, "lava" glows, "void" is nothing at all (space). */
  below: "water" | "lava" | "void"; belowColor: string;
  green: [string, string];
  rail: string; trim: string; trimGlow: number;
  side: string; block: string; building: string; roof: string; slider: string; bumper: string;
  accent: string;                        // trail, beacon, tee ring
  bloom: number;                         // strength
  particles: Particles; particleColor: string;
  scenery: (g: THREE.Group, rand: () => number, around: Around) => void;
}

/** Where scenery may go: around the hole, not on it. */
export interface Around { cx: number; cz: number; radius: number; spot(min?: number, max?: number): [number, number] }

const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...extra });
const glow = (color: string, intensity = 2) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });

function put(g: THREE.Group, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, s = 1, ry = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z); mesh.scale.setScalar(s); mesh.rotation.y = ry;
  g.add(mesh); return mesh;
}

/** A floating island of rock with a grassy top, for scenery to stand on. */
function island(g: THREE.Group, x: number, z: number, r: number, top: string, rock: string, y = -0.4): number {
  put(g, new THREE.CylinderGeometry(r, r * 0.55, 1.6, 7), mat(rock), x, y - 0.9, z);
  put(g, new THREE.CylinderGeometry(r * 1.02, r, 0.3, 7), mat(top), x, y + 0.05, z);
  return y + 0.2;
}

function roundTree(g: THREE.Group, x: number, y: number, z: number, leaf: string, s = 1): void {
  put(g, new THREE.CylinderGeometry(0.12, 0.18, 1.2, 6), mat("#7a5232"), x, y + 0.6 * s, z, s);
  put(g, new THREE.IcosahedronGeometry(0.9, 0), mat(leaf), x, y + 1.6 * s, z, s, x);
}
function pine(g: THREE.Group, x: number, y: number, z: number, leaf: string, s = 1, snow = false): void {
  put(g, new THREE.CylinderGeometry(0.1, 0.14, 0.8, 6), mat("#6b4a2e"), x, y + 0.4 * s, z, s);
  for (let k = 0; k < 3; k++) {
    put(g, new THREE.ConeGeometry(0.9 - k * 0.22, 1.1, 7), mat(snow && k === 2 ? "#f4f8ff" : leaf), x, y + (0.9 + k * 0.6) * s, z, s);
  }
}

const THEMES: Record<ThemeName, Theme> = {
  meadow: {
    label: "Sunny Meadow",
    sky: ["#6ec6f0", "#b9e4f5", "#f3f0dc"], fog: "#e8f0e0", fogNear: 50, fogFar: 150,
    sun: "#fff3d6", sunIntensity: 2.8, hemiSky: "#ffffff", hemiGround: "#7a9a6a", hemiIntensity: 1.6, exposure: 1.05,
    below: "water", belowColor: "#58b4d1",
    green: ["#5cbf55", "#4fae4a"], rail: "#f6efe0", trim: "#ffd54f", trimGlow: 0.6,
    side: "#8d6e63", block: "#ef7d57", building: "#fbf7ef", roof: "#d6453d", slider: "#ffb300", bumper: "#ec4899",
    accent: "#ffffff", bloom: 0.25, particles: "pollen", particleColor: "#fff8c4",
    scenery(g, rand, A) {
      for (let i = 0; i < 9; i++) {
        const [x, z] = A.spot(6, 26), y = island(g, x, z, 2 + rand() * 2.5, "#6cc35d", "#b49a74");
        for (let k = 0; k < 2 + rand() * 3; k++) roundTree(g, x + (rand() - 0.5) * 3, y, z + (rand() - 0.5) * 3, rand() < 0.5 ? "#57a84b" : "#6fbf4f", 0.8 + rand() * 0.6);
        for (let k = 0; k < 6; k++) put(g, new THREE.SphereGeometry(0.12, 6, 4), mat(["#ffffff", "#ffd54f", "#f48fb1"][k % 3]), x + (rand() - 0.5) * 3.5, y + 0.1, z + (rand() - 0.5) * 3.5);
      }
    }
  },
  autumn: {
    label: "Autumn Woods",
    sky: ["#f59e63", "#f7c98b", "#fde8c8"], fog: "#f6d7ad", fogNear: 40, fogFar: 130,
    sun: "#ffc68a", sunIntensity: 2.6, hemiSky: "#ffe2c0", hemiGround: "#8a5a3a", hemiIntensity: 1.4, exposure: 1.05,
    below: "water", belowColor: "#3f8fa6",
    green: ["#7cab4a", "#6e9b40"], rail: "#a0683d", trim: "#ffb74d", trimGlow: 0.9,
    side: "#6d4c41", block: "#c0582f", building: "#f3e6d3", roof: "#9c3b22", slider: "#e0a030", bumper: "#e65100",
    accent: "#ffe0b2", bloom: 0.35, particles: "leaves", particleColor: "#e8742b",
    scenery(g, rand, A) {
      for (let i = 0; i < 10; i++) {
        const [x, z] = A.spot(6, 26), y = island(g, x, z, 2 + rand() * 2.5, "#8a6a2f", "#7a5a40");
        for (let k = 0; k < 3; k++) roundTree(g, x + (rand() - 0.5) * 3, y, z + (rand() - 0.5) * 3, ["#e8742b", "#d84315", "#f9a825", "#bf360c"][Math.floor(rand() * 4)], 0.9 + rand() * 0.7);
        put(g, new THREE.SphereGeometry(0.35, 6, 4), mat("#ef6c00"), x + 1, y + 0.3, z - 1);
      }
    }
  },
  desert: {
    label: "Desert Mesa",
    sky: ["#f0a35e", "#f6d29a", "#fff1d6"], fog: "#f5dfb6", fogNear: 45, fogFar: 150,
    sun: "#fff0d0", sunIntensity: 3.2, hemiSky: "#fff5e0", hemiGround: "#c08a50", hemiIntensity: 1.4, exposure: 1.08,
    below: "water", belowColor: "#3fb7b0",
    green: ["#62c26a", "#55b05c"], rail: "#d9875a", trim: "#ffe082", trimGlow: 0.7,
    side: "#b0643c", block: "#c1440e", building: "#f3e1c6", roof: "#b5482b", slider: "#f2b134", bumper: "#26a69a",
    accent: "#fff3d6", bloom: 0.3, particles: "dust", particleColor: "#ffe0a8",
    scenery(g, rand, A) {
      for (let i = 0; i < 9; i++) {
        const [x, z] = A.spot(8, 30), h = 4 + rand() * 9, r = 2 + rand() * 3;
        put(g, new THREE.CylinderGeometry(r * 0.8, r, h, 6), mat(["#c1683c", "#d9875a", "#b5582f"][i % 3]), x, h / 2 - 1.3, z, 1, rand() * 3);
        put(g, new THREE.CylinderGeometry(r * 0.82, r * 0.82, 0.3, 6), mat("#e8b07a"), x, h - 1.3, z, 1, rand() * 3);
      }
      for (let i = 0; i < 10; i++) {
        const [x, z] = A.spot(4, 18);
        const y = island(g, x, z, 1.2, "#e8c68a", "#c9a46a");
        const c = mat("#3f8f4f");
        put(g, new THREE.CylinderGeometry(0.22, 0.25, 1.8, 7), c, x, y + 0.9, z);
        put(g, new THREE.CylinderGeometry(0.14, 0.16, 0.8, 7), c, x + 0.4, y + 1.1, z).rotation.z = 0.3;
      }
    }
  },
  arcade: {
    label: "Neon Arcade",
    sky: ["#0d0221", "#261447", "#4b1d6b"], fog: "#1a0b33", fogNear: 35, fogFar: 120,
    sun: "#b388ff", sunIntensity: 1.2, hemiSky: "#7c4dff", hemiGround: "#1a0033", hemiIntensity: 1.1, exposure: 1.0,
    below: "void", belowColor: "#12002a",
    green: ["#1f6f6a", "#1a605c"], rail: "#1c1c2e", trim: "#00e5ff", trimGlow: 3,
    side: "#2a1a4a", block: "#ff2fa0", building: "#2a2a44", roof: "#ff2fa0", slider: "#ffe600", bumper: "#ff2fa0",
    accent: "#00e5ff", bloom: 0.85, particles: "squares", particleColor: "#ff7cf5",
    scenery(g, rand, A) {
      // a neon grid floor far below and glowing arches round the course
      const grid = new THREE.GridHelper(400, 100, "#ff2fa0", "#7c4dff");
      grid.position.y = -6; (grid.material as THREE.Material).transparent = true; (grid.material as THREE.LineBasicMaterial).opacity = 0.5;
      g.add(grid);
      for (let i = 0; i < 12; i++) {
        const [x, z] = A.spot(6, 24), c = ["#00e5ff", "#ff2fa0", "#ffe600", "#76ff03"][i % 4];
        const ring = put(g, new THREE.TorusGeometry(2 + rand() * 2, 0.12, 8, 40), glow(c, 3), x, 1 + rand() * 4, z);
        ring.rotation.y = rand() * Math.PI;
        put(g, new THREE.BoxGeometry(0.5, 8 + rand() * 6, 0.5), glow(c, 1.5), x + 4, -2, z - 3);
      }
    }
  },
  tulips: {
    label: "Tulip Fields",
    sky: ["#7ec8f2", "#c4e6f7", "#fbf3e4"], fog: "#eef3ea", fogNear: 50, fogFar: 150,
    sun: "#fff7e0", sunIntensity: 2.8, hemiSky: "#ffffff", hemiGround: "#7a9a6a", hemiIntensity: 1.6, exposure: 1.05,
    below: "water", belowColor: "#5aa9cf",
    green: ["#5cbf55", "#4fae4a"], rail: "#f4f1ea", trim: "#ff80ab", trimGlow: 0.7,
    side: "#8d6e63", block: "#5c6bc0", building: "#fbf7ef", roof: "#d6453d", slider: "#ffb300", bumper: "#ec4899",
    accent: "#ffffff", bloom: 0.25, particles: "petals", particleColor: "#ff8fb3",
    scenery(g, rand, A) {
      const colours = ["#e53935", "#fdd835", "#ec407a", "#ff7043", "#ab47bc", "#ffffff"];
      for (let i = 0; i < 8; i++) {
        const [x, z] = A.spot(6, 24), y = island(g, x, z, 3 + rand() * 2, "#5aa34a", "#8d7a5a");
        const c = colours[i % colours.length];
        for (let k = 0; k < 28; k++) {
          const tx = x + (rand() - 0.5) * 5, tz = z + (rand() - 0.5) * 5;
          if (Math.hypot(tx - x, tz - z) > 3) continue;
          put(g, new THREE.CylinderGeometry(0.03, 0.03, 0.5, 4), mat("#3e8e41"), tx, y + 0.25, tz);
          put(g, new THREE.SphereGeometry(0.16, 6, 4), mat(c), tx, y + 0.55, tz).scale.y = 1.4;
        }
      }
      // a second windmill in the distance
      const [x, z] = A.spot(18, 26), y = island(g, x, z, 3, "#5aa34a", "#8d7a5a");
      put(g, new THREE.CylinderGeometry(1, 1.4, 4, 8), mat("#7b4b2a"), x, y + 2, z);
      put(g, new THREE.ConeGeometry(1.3, 1.6, 8), mat("#3e2a1e"), x, y + 4.8, z);
    }
  },
  city: {
    label: "City Lights",
    sky: ["#070b1f", "#1b2650", "#3b3f7a"], fog: "#141a3a", fogNear: 35, fogFar: 140,
    sun: "#9fb4ff", sunIntensity: 1.2, hemiSky: "#8090ff", hemiGround: "#151530", hemiIntensity: 1.2, exposure: 1.0,
    below: "water", belowColor: "#0e1a3a",
    green: ["#3f8f5a", "#377f50"], rail: "#2b2f3f", trim: "#ffd600", trimGlow: 2.2,
    side: "#30344a", block: "#e53935", building: "#cfd8dc", roof: "#37474f", slider: "#ffd600", bumper: "#00e5ff",
    accent: "#ffd600", bloom: 0.9, particles: "rain", particleColor: "#9fb4ff",
    scenery(g, rand, A) {
      const lights = (c: string) => glow(c, 1.6);
      for (let i = 0; i < 26; i++) {
        const [x, z] = A.spot(10, 40), h = 6 + rand() * 22, w = 2 + rand() * 3, d = 2 + rand() * 3;
        put(g, new THREE.BoxGeometry(w, h, d), mat(["#1e2235", "#272b42", "#1a1d2e"][i % 3]), x, h / 2 - 4, z);
        // rows of lit windows on each building
        const lit = lights(rand() < 0.5 ? "#ffe082" : "#80d8ff");
        for (let k = 0; k < 5; k++) put(g, new THREE.BoxGeometry(w * 1.01, 0.18, d * 1.01), lit, x, -4 + h * (0.2 + k * 0.15), z);
        if (rand() < 0.4) put(g, new THREE.SphereGeometry(0.2, 6, 4), glow("#ff1744", 4), x, h - 4 + 0.3, z);
      }
    }
  },
  ice: {
    label: "Ice Cave",
    sky: ["#9bd3f2", "#d6eefa", "#f4fbff"], fog: "#e4f3fb", fogNear: 40, fogFar: 130,
    sun: "#f0f8ff", sunIntensity: 2.6, hemiSky: "#ffffff", hemiGround: "#8fb8d0", hemiIntensity: 1.7, exposure: 1.05,
    below: "water", belowColor: "#7fc6e6",
    green: ["#62c08e", "#55b081"], rail: "#e8f6ff", trim: "#40c4ff", trimGlow: 1.5,
    side: "#9fbfd3", block: "#7ec8f2", building: "#f4fbff", roof: "#4f8fbf", slider: "#80deea", bumper: "#40c4ff",
    accent: "#b3e5fc", bloom: 0.55, particles: "snow", particleColor: "#ffffff",
    scenery(g, rand, A) {
      const crystal = new THREE.MeshStandardMaterial({ color: "#a5e1ff", emissive: "#40c4ff", emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85, flatShading: true });
      for (let i = 0; i < 9; i++) {
        const [x, z] = A.spot(6, 26), y = island(g, x, z, 2 + rand() * 2, "#f4fbff", "#9fbfd3");
        for (let k = 0; k < 3; k++) pine(g, x + (rand() - 0.5) * 3, y, z + (rand() - 0.5) * 3, "#2e7d5b", 0.8 + rand() * 0.5, true);
        for (let k = 0; k < 3; k++) {
          const c = put(g, new THREE.OctahedronGeometry(0.6 + rand() * 0.8, 0), crystal, x + (rand() - 0.5) * 4, y + 0.6, z + (rand() - 0.5) * 4);
          c.scale.y = 2 + rand(); c.rotation.z = (rand() - 0.5) * 0.6;
        }
      }
    }
  },
  volcano: {
    label: "Volcano",
    sky: ["#1a0605", "#5a1408", "#b8401a"], fog: "#3a0f08", fogNear: 30, fogFar: 120,
    sun: "#ffd0a8", sunIntensity: 2.6, hemiSky: "#ffb38a", hemiGround: "#3a1a10", hemiIntensity: 1.6, exposure: 1.05,
    below: "lava", belowColor: "#e8521c",
    green: ["#5cae4e", "#4f9c43"], rail: "#2b2522", trim: "#ff6d00", trimGlow: 2.6,
    side: "#3b2f2a", block: "#4e342e", building: "#5d4037", roof: "#bf360c", slider: "#ff9100", bumper: "#ff3d00",
    accent: "#ffab40", bloom: 1.0, particles: "embers", particleColor: "#ff9e40",
    scenery(g, rand, A) {
      const rock = mat("#2f2420");
      for (let i = 0; i < 14; i++) {
        const [x, z] = A.spot(5, 24);
        const r = put(g, new THREE.DodecahedronGeometry(1 + rand() * 2, 0), rock, x, -1 + rand() * 0.6, z, 1, rand() * 3);
        r.scale.y = 0.6 + rand();
      }
      // a volcano on the horizon, glowing at the top
      const [x, z] = A.spot(34, 40);
      put(g, new THREE.ConeGeometry(16, 20, 10, 1, true), mat("#3b2a24"), x, 7, z);
      put(g, new THREE.CylinderGeometry(3.2, 3.2, 0.6, 10), glow("#ff6d00", 3), x, 16.8, z);
      put(g, new THREE.SphereGeometry(2.4, 8, 6), glow("#ff3d00", 2.5), x, 18, z);
    }
  },
  space: {
    label: "Outer Space",
    sky: ["#02010a", "#0b0a2a", "#21104a"], fog: "#0b0a2a", fogNear: 60, fogFar: 220,
    sun: "#c5cae9", sunIntensity: 1.8, hemiSky: "#9fa8ff", hemiGround: "#1a1040", hemiIntensity: 1.2, exposure: 1.0,
    below: "void", belowColor: "#000000",
    green: ["#3a8f7a", "#337f6c"], rail: "#23233a", trim: "#b388ff", trimGlow: 3,
    side: "#2a2a44", block: "#7c4dff", building: "#d1c4e9", roof: "#7c4dff", slider: "#00e5ff", bumper: "#ff4081",
    accent: "#b388ff", bloom: 0.9, particles: "stars", particleColor: "#ffffff",
    scenery(g, rand, A) {
      // stars all round
      const pts: number[] = [];
      for (let i = 0; i < 1600; i++) {
        const u = rand() * 2 - 1, t = rand() * Math.PI * 2, r = 150 + rand() * 40, s = Math.sqrt(1 - u * u);
        pts.push(A.cx + r * s * Math.cos(t), r * u * 0.8, A.cz + r * s * Math.sin(t));
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      g.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: "#d8dcff", size: 0.6, sizeAttenuation: true, fog: false })));
      // planets
      const planets: [string, number, boolean][] = [["#7e57c2", 9, true], ["#ff7043", 4, false], ["#26c6da", 6, true], ["#ffd54f", 2.5, false]];
      for (const [c, size, ring] of planets) {
        const [x, z] = A.spot(40, 70);
        const p = put(g, new THREE.SphereGeometry(size, 24, 16), new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, emissive: c, emissiveIntensity: 0.15 }), x, 6 + rand() * 20, z);
        if (ring) {
          const r = new THREE.Mesh(new THREE.RingGeometry(size * 1.4, size * 2.1, 48), new THREE.MeshBasicMaterial({ color: "#e1bee7", side: THREE.DoubleSide, transparent: true, opacity: 0.55, fog: false }));
          r.rotation.x = Math.PI / 2.4; p.add(r);
        }
      }
      for (let i = 0; i < 10; i++) {
        const [x, z] = A.spot(6, 24);
        const a = put(g, new THREE.DodecahedronGeometry(0.6 + rand() * 1.4, 0), mat("#5d5a7a"), x, -1 + rand() * 6, z);
        a.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      }
    }
  }
};

export const themeFor = (name: ThemeName | undefined): Theme => THEMES[name ?? "meadow"];
export const ALL_THEMES = THEMES;

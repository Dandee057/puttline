import * as THREE from "three";
import "./style.css";
import { buildHole, type Course } from "./course/build.ts";
import { HOLES } from "./course/holes.ts";
import { CELL, cellCentre, type HoleDef } from "./course/parse.ts";
import type { Event, Sim } from "./game/physics.ts";
import { maxStrokes, scoreName, toPar, totals } from "./game/rules.ts";
import { distanceField } from "./game/route.ts";
import { isMuted, setMuted, sfx, unlockAudio } from "./audio.ts";
import { Stage, yawFacing } from "./render/stage.ts";
import { HoleView } from "./render/world.ts";
import { themeFor } from "./render/themes.ts";

/**
 * The game: one hole at a time. Physics runs at a fixed step, the picture at whatever the screen can do.
 *   intro   the camera flies from the flag back to the tee
 *   aim     waiting for a putt
 *   rolling the ball is moving
 *   holed   it's in: banner, then the next hole
 */

type Phase = "title" | "intro" | "aim" | "rolling" | "holed" | "done";

// The physics engine is the biggest part of the download: load it alongside, so the title appears straight away
let physics: typeof import("./game/physics.ts") | null = null;
const physicsReady = import("./game/physics.ts").then(async (m) => { await m.initPhysics(); physics = m; });

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("game");
const stage = new Stage(canvas);
const PARS = HOLES.map((h) => h.par);

const game = {
  phase: "title" as Phase,
  index: 0,
  scores: [] as (number | undefined)[],
  aces: [] as boolean[],
  strokes: 0,
  def: HOLES[0] as HoleDef,
  course: null as Course | null,
  sim: null as Sim | null,
  view: null as HoleView | null,
  field: null as Map<unknown, number> | null,
  introT: 0,
  holedT: 0,
  overview: false,
  acc: 0
};

/* ---------- Holes ---------- */

function loadHole(i: number): void {
  game.view && (stage.scene.remove(game.view.group), game.view.dispose());
  game.sim?.free();
  game.index = i; game.def = HOLES[i]; game.strokes = 0;
  game.course = buildHole(game.def);
  game.sim = new physics!.Sim(game.course, game.def);
  const theme = themeFor(game.def.theme);
  game.view = new HoleView(game.course, game.def, theme);
  game.field = distanceField(game.course);
  stage.scene.add(game.view.group);
  stage.setTheme(theme, game.course.bounds);
  game.overview = false; $("overview").setAttribute("aria-pressed", "false");
  game.phase = "intro"; game.introT = 0;
  hud();
  banner(`Hole ${i + 1}`, `${game.def.name} · Par ${game.def.par} · ${theme.label}`, 2400);
  if (game.def.shortcut) setTimeout(() => { if (game.index === i && game.strokes === 0) toast(`Risky shortcut: ${game.def.shortcut}. Hole in one or bust.`, 3600); }, 2600);
}

async function startCourse(): Promise<void> {
  if (!physics) {
    const btn = $<HTMLButtonElement>("play"); btn.disabled = true; btn.textContent = "Loading…";
    await physicsReady;
    btn.disabled = false; btn.textContent = "Play";
  }
  document.body.classList.remove("on-title");
  if (titleView) { stage.scene.remove(titleView.group); titleView.dispose(); titleView = null; }
  game.scores = []; game.aces = [];
  $("title").classList.add("hidden");
  $("card").classList.add("hidden");
  loadHole(0);
}

function finishHole(score: number, pickedUp = false): void {
  game.scores[game.index] = score;
  game.phase = "holed"; game.holedT = 0;
  // through the golden hole, or (on a jump hole, which has none) any hole in one
  const ace = score === 1 && !pickedUp, viaShortcut = !!game.sim?.warped || !game.course?.gold;
  const name = pickedUp ? "Picked up" : ace ? "HOLE IN ONE!" : scoreName(score, game.def.par);
  const t = totals(game.scores, PARS);
  banner(name, `${ace && viaShortcut ? `${game.def.shortcut} · ` : ""}${score} stroke${score === 1 ? "" : "s"} · ${toPar(t.strokes, t.par)} overall`, ace ? 3200 : 2600);
  $("banner").classList.toggle("gold", ace);
  if (ace) game.aces[game.index] = true;
  if (!pickedUp) {
    game.view!.celebrate(ace);
    sfx.cup();
    if (ace) setTimeout(() => sfx.ace(), 400);
    else if (score < game.def.par) setTimeout(() => sfx.fanfare(), 450);
  }
  saveBest(game.index, score);
  hud();
}

function nextHole(): void {
  if (game.index + 1 < HOLES.length) loadHole(game.index + 1);
  else { game.phase = "done"; saveBestTotal(); showCard(true); }
}

/* ---------- Each frame ---------- */

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = now / 1000;
  const { sim, view, course } = game;
  if (sim && view && course) {
    // fixed-step physics, catching up to real time (at most a few steps a frame if the tab was slow)
    game.acc += dt;
    let n = 0;
    const DT = physics!.DT;
    while (game.acc >= DT && n++ < 8) { game.acc -= DT; handle(sim.step()); }
    if (n >= 8) game.acc = 0;
    view.update(sim, dt, t);
    if (game.phase === "aim" && aiming) view.showAim(aiming.dir, aiming.power); else view.showAim(null, 0);
    cameraFor(dt);
    if (game.phase === "holed" && (game.holedT += dt) > 2.8) nextHole();
  } else {
    // Title: a slow turn over the first hole
    stage.goal.yaw += dt * 0.08;
    stage.updateCamera(dt);
  }
  stage.render(t, dt);
  requestAnimationFrame(frame);
}

function handle(events: Event[]): void {
  for (const e of events) {
    if (e.type === "hit") {
      if (e.what === "bumper") { sfx.bumper(); game.view!.flashBumper(); }
      else if (e.what === "blade" || e.what === "slider") sfx.thunk(e.speed);
      else sfx.wall(e.speed);
    } else if (e.type === "warp") { sfx.warp(); game.view!.sparkle("gold"); }
    else if (e.type === "warped") game.view!.sparkle("cup");
    else if (e.type === "sunk" && (game.phase === "rolling" || game.phase === "aim")) { aiming = null; meter(0, false); finishHole(game.strokes); }
    else if (e.type === "out" && game.phase === "rolling") {
      sfx.splash();
      game.strokes++;
      toast("Out of bounds: one stroke penalty");
      setTimeout(() => { game.sim?.place(game.sim.lastRest); afterRest(); }, 900);
      hud();
    } else if (e.type === "rest" && game.phase === "rolling") afterRest();
  }
}

function afterRest(): void {
  if (game.phase !== "rolling") return;
  if (game.strokes >= maxStrokes(game.def.par)) { finishHole(maxStrokes(game.def.par), true); return; }
  game.phase = "aim";
  faceTheWay();
  hud();
}

/* ---------- Camera ---------- */

const ease = (k: number) => k * k * (3 - 2 * k);

function cameraFor(dt: number): void {
  const { course, sim } = game;
  if (!course || !sim) return;
  const b = course.bounds, size = Math.max(b.x1 - b.x0, b.z1 - b.z0);
  const centre = new THREE.Vector3((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
  const ball = new THREE.Vector3(...sim.ballPosition());
  if (game.phase === "intro") {
    // from high over the flag, down to behind the ball
    game.introT += dt;
    const k = ease(Math.min(1, game.introT / 2.6));
    const hole = new THREE.Vector3(...course.hole);
    const [dx, dz] = wayToGo();
    stage.goal.target.copy(hole).lerp(ball, k);
    stage.goal.pitch = 1.05 + (0.62 - 1.05) * k;
    stage.goal.distance = size * 0.9 + (zoom - size * 0.9) * k;
    stage.goal.yaw = yawFacing(dx, dz);
    stage.updateCamera(dt, true);
    if (game.introT >= 2.6) { game.phase = "aim"; hint(true); }
    return;
  }
  if (game.overview) {
    // fit the hole's bounding sphere inside the narrower of the two view angles
    const r = Math.hypot(b.x1 - b.x0, b.z1 - b.z0) / 2 + 0.6;
    const v = THREE.MathUtils.degToRad(stage.camera.fov) / 2, h = Math.atan(Math.tan(v) * stage.camera.aspect);
    stage.goal.target.copy(centre);
    stage.goal.yaw = 0; // tee at the bottom, cup at the top
    stage.goal.pitch = 1.2;
    stage.goal.distance = r / Math.sin(Math.min(v, h));
  } else {
    stage.goal.target.copy(ball);
    stage.goal.pitch = 0.62;
    stage.goal.distance = zoom;
  }
  stage.updateCamera(dt);
}

/** Which way to look from the ball: along the walking route to the cup a few squares ahead (round corners). */
function wayToGo(): [number, number] {
  const { course, sim, field } = game;
  if (!course || !sim || !field) return [0, -1];
  const p = sim.ballPosition(), g = course.grid;
  let cell = g.at(Math.floor(p[0] / CELL), Math.floor(p[2] / CELL));
  for (let k = 0; k < 3 && cell && !cell.cup; k++) {
    const here = cell;
    const next = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dc, dr]) => g.at(here.c + dc, here.r + dr))
      .filter((c) => c && field.has(c) && field.get(c)! < field.get(here)!)
      .sort((a, b) => field.get(a!)! - field.get(b!)!)[0];
    if (!next) break;
    cell = next;
  }
  const [tx, tz] = cell ? cellCentre(cell) : [course.hole[0], course.hole[2]];
  const dx = tx - p[0], dz = tz - p[2];
  return Math.hypot(dx, dz) < 0.5 ? [course.hole[0] - p[0] || 0, course.hole[2] - p[2] || -1] : [dx, dz];
}

function faceTheWay(): void {
  const [dx, dz] = wayToGo();
  stage.goal.yaw = yawFacing(dx, dz);
}

/* ---------- Aiming and camera input ---------- */

let zoom = 9;
let aiming: { id: number; x0: number; y0: number; dir: THREE.Vector2 | null; power: number } | null = null;
let turning: { id: number; x: number } | null = null;
const touches = new Map<number, { x: number; y: number }>();
let pinch: { d: number; x: number } | null = null;

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
  unlockAudio();
  canvas.setPointerCapture(e.pointerId);
  if (e.pointerType === "touch") {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) { aiming = null; meter(0, false); pinch = pinchState(); return; }
  }
  if (game.phase === "intro") { game.introT = 2.6; return; } // a tap skips the fly-in
  if (e.button === 2 || e.button === 1) { turning = { id: e.pointerId, x: e.clientX }; return; }
  if (game.phase === "aim") aiming = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dir: null, power: 0 };
});
canvas.addEventListener("pointermove", (e) => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && touches.size === 2) {
    const now = pinchState();
    zoom = clampZoom(zoom * (pinch.d / now.d));
    stage.goal.yaw -= (now.x - pinch.x) * 0.008;
    pinch = now;
    return;
  }
  if (turning?.id === e.pointerId) { stage.goal.yaw -= (e.clientX - turning.x) * 0.008; turning.x = e.clientX; return; }
  if (aiming?.id !== e.pointerId) return;
  // Pull back like a slingshot: the shot goes the opposite way to the drag, relative to the camera
  const dx = e.clientX - aiming.x0, dy = e.clientY - aiming.y0;
  const pull = Math.hypot(dx, dy), full = Math.min(innerWidth, innerHeight) * 0.38;
  aiming.power = Math.min(1, pull / full);
  const fwd = new THREE.Vector2(-Math.sin(stage.yaw), -Math.cos(stage.yaw)), right = new THREE.Vector2(-fwd.y, fwd.x);
  // screen right is camera right; screen down (dy > 0) means pulling back, so the ball goes forward
  const d = new THREE.Vector2().addScaledVector(right, -dx).addScaledVector(fwd, dy);
  aiming.dir = d.lengthSq() > 1e-6 ? d.normalize() : null;
  meter(aiming.power, pull > 6);
});
const end = (e: PointerEvent) => {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinch = null;
  if (turning?.id === e.pointerId) turning = null;
  if (aiming?.id !== e.pointerId) return;
  const a = aiming; aiming = null; meter(0, false);
  if (e.type === "pointerup" && a.dir && a.power >= 0.04 && game.phase === "aim") shoot(a.dir, a.power);
};
canvas.addEventListener("pointerup", end);
canvas.addEventListener("pointercancel", end);
canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoom = clampZoom(zoom * Math.exp(e.deltaY * 0.001)); }, { passive: false });

function pinchState() {
  const [a, b] = [...touches.values()];
  return { d: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2 };
}
const clampZoom = (z: number) => Math.max(4, Math.min(24, z));

function shoot(dir: THREE.Vector2, power: number): void {
  if (!game.sim) return;
  game.strokes++;
  game.sim.shoot(dir.x, dir.y, power);
  game.phase = "rolling";
  sfx.putt(power);
  hint(false);
  hud();
}

addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input, textarea")) return;
  const k = e.key.toLowerCase();
  if (k === "a" || k === "arrowleft") stage.goal.yaw += 0.25;
  else if (k === "d" || k === "arrowright") stage.goal.yaw -= 0.25;
  else if (k === "w" || k === "arrowup") zoom = clampZoom(zoom * 0.85);
  else if (k === "s" || k === "arrowdown") zoom = clampZoom(zoom / 0.85);
  else if (k === "o") toggleOverview();
  else if (k === "m") toggleMute();
  else if (k === "escape") { aiming = null; meter(0, false); }
  else if ((k === "enter" || k === " ") && game.phase === "title") startCourse();
});

$("rot-left").addEventListener("click", () => (stage.goal.yaw += Math.PI / 6));
$("rot-right").addEventListener("click", () => (stage.goal.yaw -= Math.PI / 6));
$("overview").addEventListener("click", toggleOverview);
$("mute").addEventListener("click", toggleMute);
$("scorecard-btn").addEventListener("click", () => showCard(false));
$("play").addEventListener("click", () => { unlockAudio(); startCourse(); });
$("card-again").addEventListener("click", () => { unlockAudio(); startCourse(); });
$("card-close").addEventListener("click", () => $("card").classList.add("hidden"));
$("card-copy").addEventListener("click", copyScore);

function toggleOverview(): void {
  if (game.phase === "intro") game.introT = 2.6;
  game.overview = !game.overview;
  $("overview").setAttribute("aria-pressed", String(game.overview));
  if (!game.overview) faceTheWay(); // back behind the ball, looking the way to go
}
function toggleMute(): void {
  setMuted(!isMuted());
  const b = $("mute"); b.textContent = isMuted() ? "♪̸" : "♪"; b.setAttribute("aria-label", isMuted() ? "Sound off" : "Sound on");
  b.setAttribute("aria-pressed", String(isMuted()));
}

/* ---------- Screen text ---------- */

function hud(): void {
  $("hud-hole").textContent = `Hole ${game.index + 1}/${HOLES.length}`;
  $("hud-name").textContent = game.def.name;
  $("hud-stroke").textContent = `Stroke ${Math.min(game.strokes + (game.phase === "holed" ? 0 : 1), maxStrokes(game.def.par))}`;
  $("hud-par").textContent = `Par ${game.def.par}`;
  const t = totals(game.scores, PARS);
  $("hud-total").textContent = toPar(t.strokes, t.par);
}

let bannerTimer = 0;
function banner(title: string, sub: string, ms: number): void {
  const el = $("banner");
  el.querySelector("b")!.textContent = title; el.querySelector("span")!.textContent = sub;
  el.classList.add("on");
  clearTimeout(bannerTimer); bannerTimer = window.setTimeout(() => el.classList.remove("on"), ms);
}
let toastTimer = 0;
function toast(text: string, ms = 2200): void {
  const el = $("toast"); el.textContent = text; el.classList.add("on");
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => el.classList.remove("on"), ms);
}
let hinted = false;
function hint(show: boolean): void {
  // the how-to hint shows on the first hole until the first putt
  $("hint").classList.toggle("gone", !show || hinted || game.index > 0);
  if (!show) hinted = true;
}
function meter(power: number, on: boolean): void {
  const el = $("meter");
  el.classList.toggle("on", on);
  (el.querySelector("i") as HTMLElement).style.width = `${power * 100}%`;
  el.querySelector("span")!.textContent = `${Math.round(power * 100)}%`;
  if (on) $("hint").classList.add("gone");
}

function showCard(final: boolean): void {
  const t = totals(game.scores, PARS), played = game.scores.filter((s) => s !== undefined).length;
  const head = `<tr><th>Hole</th>${HOLES.map((_, i) => `<th>${i + 1}</th>`).join("")}<th>Total</th></tr>`;
  const par = `<tr><td>Par</td>${PARS.map((p) => `<td>${p}</td>`).join("")}<td>${PARS.reduce((a, b) => a + b, 0)}</td></tr>`;
  const you = `<tr class="total"><td>You</td>${HOLES.map((h, i) => {
    const s = game.scores[i];
    const cls = s === undefined ? (i === game.index && !final ? "now" : "") : s < h.par ? "under" : s > h.par ? "over" : "";
    return `<td class="${cls}">${s ?? (i === game.index && !final ? "·" : "")}${game.aces[i] ? '<span class="star" title="Hole in one">★</span>' : ""}</td>`;
  }).join("")}<td>${played ? t.strokes : ""}</td></tr>`;
  const best = readBest();
  const bestRow = best.holes.some((x) => x) ? `<tr><td>Your best</td>${HOLES.map((_, i) => `<td>${best.holes[i] ?? ""}</td>`).join("")}<td>${best.total ?? ""}</td></tr>` : "";
  $("card-table").innerHTML = head + par + you + bestRow;
  $("card-title").textContent = final ? "Round complete" : "Scorecard";
  $("card-result").textContent = final
    ? `${t.strokes} strokes, ${toPar(t.strokes, t.par) === "E" ? "level par" : toPar(t.strokes, t.par)}.${best.total === t.strokes ? " A new personal best!" : ""}`
    : played ? `${toPar(t.strokes, t.par)} after ${played} hole${played === 1 ? "" : "s"}.` : "";
  $("card-close").classList.toggle("hidden", final);
  $("card-copy").classList.toggle("hidden", !final);
  $("card-again").textContent = final ? "Play again" : "Restart the round";
  $("card").classList.remove("hidden");
}

async function copyScore(): Promise<void> {
  const t = totals(game.scores, PARS);
  const holes = game.scores.map((s, i) => (game.aces[i] ? "⭐" : s! < PARS[i] ? "🟩" : s === PARS[i] ? "⬜" : "🟥")).join("");
  const text = `Puttline ⛳ ${t.strokes} (${toPar(t.strokes, t.par)})\n${holes}\n${location.origin + location.pathname}`;
  try { await navigator.clipboard.writeText(text); toast("Score copied"); } catch { prompt("Copy your score:", text); }
}

/* ---------- Personal bests, in this browser ---------- */

interface Best { holes: (number | null)[]; total: number | null }
function readBest(): Best {
  try { const b = JSON.parse(localStorage.getItem("puttline.best") ?? "null"); if (b && Array.isArray(b.holes)) return b; } catch { /* none */ }
  return { holes: [], total: null };
}
function writeBest(b: Best): void { try { localStorage.setItem("puttline.best", JSON.stringify(b)); } catch { /* storage unavailable */ } }
function saveBest(i: number, score: number): void {
  const b = readBest();
  if (b.holes[i] == null || score < b.holes[i]!) { b.holes[i] = score; writeBest(b); }
}
function saveBestTotal(): void {
  const b = readBest(), t = totals(game.scores, PARS).strokes;
  if (b.total == null || t < b.total) { b.total = t; writeBest(b); }
}

/* ---------- Start ---------- */

function showTitle(): void {
  const b = readBest();
  $("best").textContent = b.total != null ? `Your best round: ${b.total} (${toPar(b.total, PARS.reduce((a, c) => a + c, 0))})` : "";
  // the last hole behind the title, in space, slowly turning
  const def = HOLES[HOLES.length - 1], theme = themeFor(def.theme);
  const course = buildHole(def), view = new HoleView(course, def, theme);
  view.ball.visible = false;
  stage.scene.add(view.group);
  stage.setTheme(theme, course.bounds);
  const b0 = course.bounds;
  stage.goal.target.set((b0.x0 + b0.x1) / 2, 0, (b0.z0 + b0.z1) / 2);
  stage.goal.pitch = 0.6; stage.goal.distance = 30; stage.goal.yaw = 0.6;
  stage.updateCamera(0, true);
  titleView = view;
}
let titleView: HoleView | null = null;
addEventListener("resize", () => stage.resize());
stage.resize();
// ?debug: lets automated browser tests play an exact shot (the same ones the hole checker found)
if (new URLSearchParams(location.search).has("debug")) {
  (window as unknown as { puttline: object }).puttline = {
    shoot: (dx: number, dz: number, power: number) => { if (game.phase === "intro") game.introT = 2.6; if (game.phase === "aim" || game.phase === "intro") { game.phase = "aim"; shoot(new THREE.Vector2(dx, dz), power); } },
    state: () => ({ phase: game.phase, hole: game.index + 1, strokes: game.strokes, scores: game.scores, aces: game.aces })
  };
}
// ?hole=5 jumps straight to a hole (handy for practice, and for testing)
const jump = Number(new URLSearchParams(location.search).get("hole"));
if (jump >= 1 && jump <= HOLES.length) { $("title").classList.add("hidden"); document.body.classList.remove("on-title"); game.scores = []; await physicsReady; loadHole(jump - 1); }
else showTitle();
requestAnimationFrame(frame);

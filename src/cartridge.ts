import * as THREE from "three";
import { buildHole, type Course } from "./course/build.ts";
import { HOLES } from "./course/holes.ts";
import type { Cell, HoleDef } from "./course/parse.ts";
import { DT, initPhysics, Sim, type Event } from "./game/physics.ts";
import { maxStrokes, scoreName, totals } from "./game/rules.ts";
import { distanceField, wayToGo } from "./game/route.ts";
import { isMuted, setMuted, sfx, suspendAudio, unlockAudio } from "./audio.ts";
import { Stage, yawFacing } from "./render/stage.ts";
import { HoleView } from "./render/world.ts";
import { themeFor } from "./render/themes.ts";
import { BALLS, ballById, type BallDef } from "./game/balls.ts";
import { ballPreview } from "./render/balls.ts";

/**
 * Puttline as a console cartridge: the same course, physics and scenery as the web version, played with a
 * d-pad and two buttons instead of the mouse, for the handheld consoles on dandeegames.com and the arcade
 * cabinets in Three Lab.
 *
 * It speaks the cartridges' small engine API (state, update, drawScreen, press, hold, click…). The 3D scene
 * renders into its own off-screen WebGL canvas at the screen's exact size, then that frame and the HUD are drawn
 * onto the console's 2D canvas. This file is built as one script (`npm run build:cartridge`) that a tiny loader,
 * cartridge/puttline.js, fetches only when the cartridge goes in.
 *
 *   title: ◀ ▶ pick a ball (Ronin, Frostbite or Mag-9)
 *   ◀ ▶ aim   ▲ ▼ power   A putt   B overview
 *   while the ball rolls: A jump · B toot · ▲ or ▼ the ball's power · START redo (each once per hole)
 */

type Phase = "title" | "intro" | "aim" | "rolling" | "holed" | "done";
type Key = "left" | "right" | "up" | "down" | "jump" | "shoot";
type Power = "toot" | "jump" | "redo" | "special";

/** The engine API the cartridge sites expect (see gba.js on the website, cartridge.ts in Three Lab). */
export interface CartApi {
  state: "menu" | "game" | "over";
  soundOn: boolean;
  grid: boolean;
  hints: Record<string, string>;
  padLabels: Record<string, string>;
  update(dt: number): void;
  drawScreen(g: CanvasRenderingContext2D, w: number, h: number): void;
  draw(g: CanvasRenderingContext2D): void;
  press(k: "start" | "sound"): void;
  hold(k: string, down: boolean): void;
  click(x: number, y: number): void;
  release(): void;
  toMenu(): void;
  pause(p: boolean): void;
  stop(): void;
  debug?: () => unknown;
}

const FONT = '"Press Start 2P", ui-monospace, monospace';
const C = { white: "#ffffff", gold: "#ffd54f", green: "#7dff9a", red: "#ff6b6b", cyan: "#6ee7ff", grey: "#8b93a7", ink: "#0b1020" };
/** The ball's power in a few words, for the title screen (the pixel font is wide). */
const POWER_SHORT = { slash: "DASH AND CUT DOWN TREES", freeze: "ICE THE RIVERS", magnet: "A QUICK PULL TO THE CUP" } as const;
const PARS = HOLES.map((h) => h.par);
const COURSE_PAR = PARS.reduce((a, b) => a + b, 0);
const ZOOM = 9;
const ease = (k: number) => k * k * (3 - 2 * k);
/** Golf writes scores against par as E, −2, +3; the pixel font has no minus sign, so a hyphen. */
const toPar = (strokes: number, par: number) => { const d = strokes - par; return d === 0 ? "E" : d < 0 ? `-${-d}` : `+${d}`; };

/** Fills in the loader's placeholder API object with the real game. */
export function attach(api: CartApi): void {
  const canvas = document.createElement("canvas");
  let stage: Stage | null = null, glFailed = false;
  function ensureStage(w: number, h: number): Stage | null {
    if (glFailed) return null;
    if (!stage) {
      try { stage = new Stage(canvas, { offscreen: true }); } catch { glFailed = true; return null; }
      showTitle();
    }
    stage.setSize(w, h);
    return stage;
  }

  let physicsReady = false, pendingStart = false;
  void initPhysics().then(() => { physicsReady = true; if (pendingStart) startCourse(); });

  const game = {
    phase: "title" as Phase,
    index: 0,
    scores: [] as (number | undefined)[],
    aces: [] as boolean[],
    powers: { toot: true, jump: true, redo: true, special: true },
    ball: ballById(readBall()) as BallDef,
    lastShot: null as { from: [number, number, number]; strokes: number } | null,
    strokes: 0,
    def: HOLES[0] as HoleDef,
    course: null as Course | null,
    sim: null as Sim | null,
    view: null as HoleView | null,
    field: null as Map<Cell, number> | null,
    introT: 0, holedT: 0, outT: 0, acc: 0, time: 0, frameDt: 0,
    overview: false,
    newBest: false
  };
  let titleView: HoleView | null = null;
  let paused = false;

  // Aiming: a direction on the ground (dx, dz) and a power, both set with the d-pad
  const aim = { dir: new THREE.Vector2(0, -1), power: 0.5, turnT: 0 };
  const held = new Set<Key>();

  // Text on screen: a banner for the big moments, a toast for the small ones
  let banner: { title: string; sub: string; gold: boolean; until: number } | null = null;
  let toast: { lines: string[]; until: number } | null = null;
  const say = (title: string, sub: string, secs: number, gold = false) => (banner = { title, sub, gold, until: game.time + secs });
  const note = (lines: string[], secs = 2.2) => (toast = { lines, until: game.time + secs });

  /* ---------- The course ---------- */

  function clearScene(): void {
    if (!stage) return;
    if (game.view) { stage.scene.remove(game.view.group); game.view.dispose(); game.view = null; }
    if (titleView) { stage.scene.remove(titleView.group); titleView.dispose(); titleView = null; }
    game.sim?.free(); game.sim = null;
  }

  function showTitle(): void {
    if (!stage) return;
    clearScene();
    game.phase = "title"; api.state = "menu";
    // the last hole, in space, slowly turning behind the title
    const def = HOLES[HOLES.length - 1], theme = themeFor(def.theme), course = buildHole(def);
    titleView = new HoleView(course, def, theme, game.ball);
    titleView.ball.visible = false;
    stage.scene.add(titleView.group);
    stage.setTheme(theme, course.bounds);
    const b = course.bounds;
    stage.goal.target.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
    stage.goal.pitch = 0.6; stage.goal.distance = 30; stage.goal.yaw = 0.6;
    stage.updateCamera(0, true);
  }

  function startCourse(): void {
    if (!physicsReady || !stage) { pendingStart = true; return; }
    pendingStart = false;
    game.scores = []; game.aces = []; game.newBest = false;
    loadHole(0);
  }

  function loadHole(i: number): void {
    if (!stage) return;
    clearScene();
    game.index = i; game.def = HOLES[i]; game.strokes = 0;
    game.powers = { toot: true, jump: true, redo: true, special: true }; game.lastShot = null; game.outT = 0;
    game.course = buildHole(game.def);
    game.sim = new Sim(game.course, game.def);
    const theme = themeFor(game.def.theme);
    game.view = new HoleView(game.course, game.def, theme, game.ball);
    game.field = distanceField(game.course);
    stage.scene.add(game.view.group);
    stage.setTheme(theme, game.course.bounds);
    game.overview = false; game.acc = 0;
    game.phase = "intro"; game.introT = 0; api.state = "game";
    faceTheWay();
    toast = null;
    say(`HOLE ${i + 1}`, `${game.def.name} - PAR ${game.def.par}`, 2.4);
  }

  function finishHole(score: number, pickedUp = false): void {
    game.scores[game.index] = score;
    game.phase = "holed"; game.holedT = 0;
    const ace = score === 1 && !pickedUp, viaShortcut = !!game.sim?.warped || !game.course?.gold;
    const t = totals(game.scores, PARS);
    const name = pickedUp ? "PICKED UP" : ace ? "HOLE IN ONE!" : scoreName(score, game.def.par);
    say(name, ace && viaShortcut && game.def.shortcut ? game.def.shortcut : `${score} STROKE${score === 1 ? "" : "S"} - ${toPar(t.strokes, t.par)} OVERALL`, 3, ace);
    if (ace) game.aces[game.index] = true;
    if (!pickedUp) {
      game.view?.celebrate(ace);
      sfx.cup();
      if (ace) later(0.4, () => sfx.ace());
      else if (score < game.def.par) later(0.45, () => sfx.fanfare());
    }
    saveBest(game.index, score);
  }

  function nextHole(): void {
    if (game.index + 1 < HOLES.length) { loadHole(game.index + 1); return; }
    game.phase = "done"; api.state = "over";
    game.newBest = saveBestTotal();
    banner = null; toast = null;
  }

  // Small delays in game time, so pausing the console pauses them too
  const timers: { at: number; fn: () => void }[] = [];
  const later = (secs: number, fn: () => void) => timers.push({ at: game.time + secs, fn });

  /* ---------- Shots and power-ups ---------- */

  function faceTheWay(): void {
    const { course, sim, field } = game;
    if (!course || !sim || !field) return;
    const [dx, dz] = wayToGo(course, field, sim.ballPosition());
    aim.dir.set(dx, dz).normalize();
  }

  function shoot(): void {
    const sim = game.sim;
    if (!sim || game.phase !== "aim") return;
    game.lastShot = { from: sim.ballPosition(), strokes: game.strokes };
    game.strokes++;
    sim.shoot(aim.dir.x, aim.dir.y, aim.power);
    game.phase = "rolling";
    game.overview = false;
    if (banner && !banner.gold) banner = null;
    sfx.putt(aim.power);
  }

  function canUse(p: Power): boolean {
    const { sim } = game;
    if (!sim || !game.powers[p]) return false;
    if (p === "redo") return !!game.lastShot && (game.phase === "rolling" || game.phase === "aim") && sim.state !== "warp" && sim.state !== "sunk";
    // the cartridge has no spare button while aiming, so every ball's power is used while it rolls
    return game.phase === "rolling" && sim.state === "moving";
  }

  function usePower(p: Power): void {
    if (!canUse(p) || !game.sim || !game.view) return;
    const sim = game.sim, view = game.view;
    if (p === "toot" && sim.toot()) { sfx.toot(); view.puff(); note(["TOOT!"], 1.2); }
    else if (p === "jump" && sim.jump()) { sfx.boing(); view.ring(); note(["BOING!"], 1.2); }
    else if (p === "special") {
      const b = game.ball;
      if (b.power === "slash" && sim.slash()) { sfx.slash(); view.slash(); note(["SLASH!"], 1.2); }
      else if (b.power === "freeze" && sim.freeze()) { sfx.freeze(); view.freezeBurst(); note(["FREEZE!", "EVERYTHING STOPS"], 1.6); }
      else if (b.power === "magnet" && sim.magnet()) { sfx.magnet(); view.magnetOn(); note(["MAGNET ON!"], 1.4); }
      else return;
    } else if (p === "redo") {
      const shot = game.lastShot!;
      game.outT = 0;
      sim.place(shot.from);
      game.strokes = shot.strokes;
      game.lastShot = null;
      game.phase = "aim";
      sfx.rewind();
      note(["SHOT UNDONE", "TAKE IT AGAIN"]);
    } else return;
    game.powers[p] = false;
  }

  function handle(events: Event[]): void {
    const view = game.view;
    for (const e of events) {
      if (e.type === "hit") {
        if (e.what === "bumper") { sfx.bumper(); view?.flashBumper(); }
        else if (e.what === "blade" || e.what === "slider") sfx.thunk(e.speed);
        else sfx.wall(e.speed);
      } else if (e.type === "warp") { sfx.warp(); view?.sparkle("gold"); }
      else if (e.type === "warped") view?.sparkle("cup");
      else if (e.type === "cut") { sfx.cut(); view?.cutAt(e.at, e.tree); if (e.what === "tree") sfx.timber(); }
      else if (e.type === "thaw") { sfx.thaw(); view?.thaw(); }
      else if (e.type === "sunk" && (game.phase === "rolling" || game.phase === "aim")) finishHole(game.strokes);
      else if (e.type === "out" && game.phase === "rolling" && game.outT <= 0) {
        sfx.splash();
        game.strokes++;
        game.outT = 0.9;
        note(["OUT OF BOUNDS", "ONE STROKE PENALTY"]);
      } else if (e.type === "rest" && game.phase === "rolling") afterRest();
    }
  }

  function afterRest(): void {
    if (game.phase !== "rolling") return;
    if (game.strokes >= maxStrokes(game.def.par)) { finishHole(maxStrokes(game.def.par), true); return; }
    game.phase = "aim";
    faceTheWay();
  }

  /* ---------- Each frame ---------- */

  function update(dt: number): void {
    game.frameDt = dt;
    if (paused || !stage) return;
    dt = Math.min(0.05, dt);
    game.time += dt;
    for (let i = timers.length - 1; i >= 0; i--) if (game.time >= timers[i].at) { const t = timers.splice(i, 1)[0]; t.fn(); }
    if (banner && game.time > banner.until) banner = null;
    if (toast && game.time > toast.until) toast = null;

    const { sim, view } = game;
    if (!sim || !view || game.phase === "title" || game.phase === "done") {
      stage.goal.yaw += dt * 0.08;
      stage.updateCamera(dt);
      if (game.phase === "done") view?.update(sim!, dt, game.time);
      return;
    }

    game.acc += dt;
    let n = 0;
    while (game.acc >= DT && n++ < 8) { game.acc -= DT; handle(sim.step()); }
    if (n >= 8) game.acc = 0;

    if (game.outT > 0 && (game.outT -= dt) <= 0) { sim.place(sim.lastRest); afterRest(); }

    if (game.phase === "aim") {
      const turn = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
      if (turn) {
        // slow at first for fine aim, faster the longer it's held
        aim.turnT += dt;
        const a = turn * (0.3 + Math.min(1.6, aim.turnT * 1.4)) * dt;
        const right = new THREE.Vector2(-aim.dir.y, aim.dir.x);
        aim.dir.multiplyScalar(Math.cos(a)).addScaledVector(right, Math.sin(a)).normalize();
      } else aim.turnT = 0;
      const lift = (held.has("up") ? 1 : 0) - (held.has("down") ? 1 : 0);
      if (lift) aim.power = Math.max(0.05, Math.min(1, aim.power + lift * 0.6 * dt));
    }

    view.update(sim, dt, game.time);
    view.showAim(game.phase === "aim" ? aim.dir : null, aim.power);
    camera(dt);
    if (game.phase === "holed" && (game.holedT += dt) > 3) nextHole();
  }

  function camera(dt: number): void {
    const { course, sim } = game;
    if (!course || !sim || !stage) return;
    const b = course.bounds;
    const ball = new THREE.Vector3(...sim.ballPosition());
    if (game.phase === "intro") {
      // from high over the flag down to behind the ball
      game.introT += dt;
      const size = Math.max(b.x1 - b.x0, b.z1 - b.z0), k = ease(Math.min(1, game.introT / 2.6));
      stage.goal.target.copy(new THREE.Vector3(...course.hole)).lerp(ball, k);
      stage.goal.pitch = 1.05 + (0.62 - 1.05) * k;
      stage.goal.distance = size * 0.9 + (ZOOM - size * 0.9) * k;
      stage.goal.yaw = yawFacing(aim.dir.x, aim.dir.y);
      stage.updateCamera(dt, true);
      if (game.introT >= 2.6) game.phase = "aim";
      return;
    }
    if (game.overview) {
      const r = Math.hypot(b.x1 - b.x0, b.z1 - b.z0) / 2 + 0.6;
      const v = THREE.MathUtils.degToRad(stage.camera.fov) / 2, h = Math.atan(Math.tan(v) * stage.camera.aspect);
      stage.goal.target.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
      stage.goal.yaw = 0; stage.goal.pitch = 1.2;
      stage.goal.distance = r / Math.sin(Math.min(v, h));
    } else {
      stage.goal.target.copy(ball);
      stage.goal.pitch = 0.62;
      stage.goal.distance = ZOOM;
      // behind the ball, looking along the aim (and staying put while it rolls)
      if (game.phase === "aim") stage.goal.yaw = yawFacing(aim.dir.x, aim.dir.y);
    }
    stage.updateCamera(dt);
  }

  /* ---------- Drawing ---------- */

  function drawScreen(g: CanvasRenderingContext2D, W: number, H: number): void {
    const st = ensureStage(W, H);
    if (!st) {
      g.fillStyle = C.ink; g.fillRect(0, 0, W, H);
      text(g, "NO 3D", W / 2, H / 2 - 4, 8, C.red, "center");
      return;
    }
    st.render(game.time, Math.max(0.001, Math.min(0.1, game.frameDt || 1 / 60)));
    g.save(); g.imageSmoothingEnabled = true; g.drawImage(canvas, 0, 0, W, H); g.restore();

    const k = W / 320, s = Math.max(8, Math.round(7 * k)), pad = Math.max(3, Math.round(6 * k)), small = W < 300;
    if (game.phase === "title") return drawTitle(g, W, H, k, s);
    if (game.phase === "done") return drawCard(g, W, H, k, s);

    // HUD along the bottom (the console draws its controls hint across the top)
    const t = totals(game.scores, PARS);
    const stroke = Math.min(game.strokes + (game.phase === "holed" ? 0 : 1), maxStrokes(game.def.par));
    g.fillStyle = "rgba(5,8,20,.55)"; g.fillRect(0, H - s - pad * 2, W, s + pad * 2);
    text(g, small ? `H${game.index + 1} P${game.def.par}` : `HOLE ${game.index + 1}/9  PAR ${game.def.par}`, pad, H - s - pad, s, C.white);
    text(g, small ? `S${stroke} ${toPar(t.strokes, t.par)}` : `STROKE ${stroke}  ${toPar(t.strokes, t.par)}`, W - pad, H - s - pad, s, C.gold, "right");

    if (game.phase === "aim" && !game.overview) drawMeter(g, W, H, k, s, pad);
    if (game.phase === "aim" || game.phase === "rolling") drawPowers(g, W, H, k, s, pad, small);
    if (game.overview) text(g, small ? "MAP" : "OVERVIEW - B: BACK", W / 2, H - s * 2 - pad * 4, s, C.cyan, "center");

    if (toast) {
      const y = H * 0.58, lh = s * 1.6, bh = toast.lines.length * lh + pad;
      g.fillStyle = "rgba(5,8,20,.6)"; g.fillRect(0, y - pad / 2, W, bh);
      toast.lines.forEach((line, i) => text(g, line, W / 2, y + i * lh, fit(g, line, s, W * 0.94), C.white, "center"));
    }
    if (banner) {
      const ts = Math.max(10, Math.round(16 * k)), y = H * 0.2;
      g.fillStyle = banner.gold ? "rgba(60,40,0,.65)" : "rgba(5,8,20,.6)"; g.fillRect(0, y - pad, W, ts + s * 2.4 + pad * 2);
      const title = banner.title.toUpperCase(), sub = banner.sub.toUpperCase();
      text(g, title, W / 2, y, fit(g, title, ts, W * 0.94), banner.gold ? C.gold : C.white, "center");
      text(g, sub, W / 2, y + ts + s * 0.9, fit(g, sub, s, W * 0.94), banner.gold ? C.white : C.cyan, "center");
    }
  }

  function drawMeter(g: CanvasRenderingContext2D, _W: number, H: number, k: number, s: number, pad: number): void {
    const w = Math.max(5, Math.round(8 * k)), top = H * 0.24, h = H * 0.44, x = pad;
    g.fillStyle = "rgba(5,8,20,.6)"; g.fillRect(x - 2, top - 2, w + 4, h + 4);
    const fill = h * aim.power;
    g.fillStyle = `hsl(${Math.round(120 - aim.power * 120)}, 95%, 55%)`;
    g.fillRect(x, top + h - fill, w, fill);
    if (s * 4 < h) text(g, `${Math.round(aim.power * 100)}`, x + w / 2, top + h + pad, Math.max(8, Math.round(s * 0.8)), C.white, "center");
  }

  function drawPowers(g: CanvasRenderingContext2D, W: number, H: number, k: number, s: number, pad: number, small: boolean): void {
    const items: [Power, string, string][] = [["jump", "JUMP", "A"], ["toot", "TOOT", "B"], [ "special", game.ball.powerName.toUpperCase(), "UP"], ["redo", "REDO", small ? "ST" : "START"]];
    const fs = Math.max(8, Math.round(6 * k)), cw = small ? fs * 2.6 : fs * 6.4, ch = fs * 2.2, gap = Math.max(2, Math.round(3 * k));
    let x = W - pad - items.length * (cw + gap) + gap;
    const y = H - s - pad * 3 - ch;
    for (const [p, label, key] of items) {
      const have = game.powers[p], ok = canUse(p);
      g.fillStyle = ok ? "rgba(255,213,79,.92)" : "rgba(5,8,20,.6)"; g.fillRect(x, y, cw, ch);
      g.strokeStyle = have ? C.gold : "rgba(255,255,255,.25)"; g.lineWidth = Math.max(1, k * 0.8); g.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
      text(g, small ? label[0] : label, x + cw / 2, y + (ch - fs) / 2, fs, ok ? C.ink : have ? C.white : C.grey, "center", false);
      if (!have) { g.strokeStyle = C.grey; g.beginPath(); g.moveTo(x + 2, y + ch / 2); g.lineTo(x + cw - 2, y + ch / 2); g.stroke(); }
      if (ok && !small) text(g, key, x + cw / 2, y - fs * 1.4, Math.max(8, Math.round(fs * 0.8)), C.gold, "center");
      x += cw + gap;
    }
  }

  function drawTitle(g: CanvasRenderingContext2D, W: number, H: number, k: number, s: number): void {
    const ts = Math.max(12, Math.round(24 * k)), y = Math.round(H * 0.16);
    text(g, "PUTTLINE", W / 2, y, fit(g, "PUTTLINE", ts, W * 0.92), C.gold, "center");
    text(g, W < 300 ? "MINI GOLF" : "9 HOLES OF MINI GOLF", W / 2, y + ts * 1.5, s, C.white, "center");
    const best = readBest();
    if (best.total != null) text(g, `BEST ${best.total} (${toPar(best.total, COURSE_PAR)})`, W / 2, y + ts * 1.5 + s * 2, s, C.cyan, "center");
    // the ball picker: the chosen ball, its name and power, with arrows either side
    const under = y + ts * 1.5 + s * (best.total != null ? 3.2 : 1.4);
    const b = game.ball, size = Math.round(Math.min(H * 0.3, W * 0.2)), cy = Math.max(H * 0.5, under + size / 2);
    g.drawImage(preview(b), W / 2 - size / 2, cy - size / 2, size, size);
    const ax = size * 0.5 + s * 2, blink = Math.floor(game.time * 2.5) % 2 === 0;
    if (blink) { arrow(g, W / 2 - ax, cy, s, -1); arrow(g, W / 2 + ax, cy, s, 1); }
    let ty = cy + size / 2 + s * 0.4;
    text(g, b.name.toUpperCase(), W / 2, ty, s, b.colours.accent, "center");
    ty += s * 1.6;
    const pw = `${b.powerName.toUpperCase()}: ${POWER_SHORT[b.power]}`;
    text(g, pw, W / 2, ty, fit(g, pw, Math.max(8, Math.round(s * 0.8)), W * 0.94), C.white, "center");
    if (pendingStart || !physicsReady) text(g, "LOADING...", W / 2, ty + s * 1.8, s, C.white, "center");
  }

  const previews = new Map<string, HTMLCanvasElement>();
  const preview = (b: BallDef) => { let c = previews.get(b.id); if (!c) { c = ballPreview(b, 128); previews.set(b.id, c); } return c; };
  function arrow(g: CanvasRenderingContext2D, x: number, y: number, s: number, dir: number): void {
    g.fillStyle = C.gold; g.beginPath(); g.moveTo(x + dir * s * 0.6, y); g.lineTo(x - dir * s * 0.4, y - s * 0.7); g.lineTo(x - dir * s * 0.4, y + s * 0.7); g.closePath(); g.fill();
  }

  function pickBall(step: number): void {
    const i = BALLS.findIndex((b) => b.id === game.ball.id);
    game.ball = BALLS[(i + step + BALLS.length) % BALLS.length];
    try { localStorage.setItem("puttline.ball", game.ball.id); } catch { /* storage unavailable */ }
    sfx.wall(2);
  }

  function drawCard(g: CanvasRenderingContext2D, W: number, H: number, k: number, s: number): void {
    g.fillStyle = "rgba(5,8,20,.6)"; g.fillRect(0, 0, W, H);
    const t = totals(game.scores, PARS), ts = Math.max(10, Math.round(16 * k));
    let y = Math.round(H * 0.1);
    text(g, "ROUND COMPLETE", W / 2, y, fit(g, "ROUND COMPLETE", ts, W * 0.92), C.gold, "center");
    y += ts * 1.7;
    text(g, `${t.strokes} STROKES  ${toPar(t.strokes, t.par)}`, W / 2, y, s, C.white, "center");
    y += s * 1.8;
    if (game.newBest) { text(g, "NEW BEST!", W / 2, y, s, C.green, "center"); y += s * 1.8; }
    // the scorecard: one column per hole (hole, par, you), a star for a hole in one
    const labels = W >= 300, pad = Math.round(8 * k), lw = labels ? s * 4 : 0;
    const cw = (W - pad * 2 - lw) / HOLES.length, fs = Math.max(8, Math.round(Math.min(s, cw * 0.4))), row = fs * 1.9;
    y += s * 0.4;
    g.fillStyle = "rgba(5,8,20,.55)"; g.fillRect(pad / 2, y - fs * 0.6, W - pad, row * 3 + fs * 0.4);
    if (labels) ["HOLE", "PAR", "YOU"].forEach((l, r) => text(g, l, pad, y + row * r, fs, r === 2 ? C.white : C.grey));
    for (let i = 0; i < HOLES.length; i++) {
      const x = pad + lw + cw * i + cw / 2, sc = game.scores[i];
      text(g, String(i + 1), x, y, fs, C.grey, "center");
      text(g, String(PARS[i]), x, y + row, fs, C.grey, "center");
      const col = sc === undefined ? C.grey : game.aces[i] ? C.gold : sc < PARS[i] ? C.green : sc > PARS[i] ? C.red : C.white;
      text(g, game.aces[i] ? "*" : String(sc ?? "-"), x, y + row * 2, fs, col, "center");
    }
  }

  function text(g: CanvasRenderingContext2D, str: string, x: number, y: number, size: number, col: string, align: CanvasTextAlign = "left", shadow = true): void {
    g.font = `${size}px ${FONT}`; g.textAlign = align; g.textBaseline = "top";
    if (shadow) { g.fillStyle = "#000"; g.fillText(str, x + Math.max(1, size / 8), y + Math.max(1, size / 8)); }
    g.fillStyle = col; g.fillText(str, x, y);
  }
  /** The largest size (up to `size`) at which the text fits in `width`. */
  function fit(g: CanvasRenderingContext2D, str: string, size: number, width: number): number {
    g.font = `${size}px ${FONT}`;
    const w = g.measureText(str).width;
    return w <= width ? size : Math.max(6, Math.floor((size * width) / w));
  }

  /* ---------- Personal bests (shared with the web version when on the same site) ---------- */

  function readBall(): string | null { try { return localStorage.getItem("puttline.ball"); } catch { return null; } }

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
  function saveBestTotal(): boolean {
    const b = readBest(), t = totals(game.scores, PARS).strokes;
    if (b.total == null || t < b.total) { b.total = t; writeBest(b); return true; }
    return false;
  }

  /* ---------- Input ---------- */

  function press(k: "start" | "sound"): void {
    unlockAudio();
    if (k === "sound") { api.soundOn = !api.soundOn; setMuted(!api.soundOn); return; }
    if (game.phase === "title" || game.phase === "done") { startCourse(); return; }
    if (game.phase === "intro") { game.introT = 2.6; return; }
    if (game.phase === "holed") { if (game.holedT > 0.6) nextHole(); return; }
    usePower("redo");
  }

  function hold(k: string, down: boolean): void {
    if (k !== "left" && k !== "right" && k !== "up" && k !== "down" && k !== "jump" && k !== "shoot") return;
    if (!down) { held.delete(k); return; }
    unlockAudio();
    const fresh = !held.has(k);
    held.add(k);
    if (!fresh) return;
    if (game.phase === "title" && (k === "left" || k === "right")) { pickBall(k === "left" ? -1 : 1); return; }
    if (game.phase === "rolling" && (k === "up" || k === "down")) { usePower("special"); return; }
    const a = k === "jump", b = k === "shoot";
    if (!a && !b) return;
    switch (game.phase) {
      case "title": case "done": startCourse(); break;
      case "intro": game.introT = 2.6; break;
      case "aim":
        if (a) { if (game.overview) game.overview = false; else shoot(); }
        else { game.overview = !game.overview; if (!game.overview) faceTheWay(); }
        break;
      case "rolling": usePower(a ? "jump" : "toot"); break;
      case "holed": if (game.holedT > 0.6) nextHole(); break;
    }
  }

  api.soundOn = !isMuted();
  Object.assign(api, {
    update,
    drawScreen,
    draw: (g: CanvasRenderingContext2D) => drawScreen(g, 800, 400),
    press,
    hold,
    click: () => { if (game.phase === "title" || game.phase === "done") { unlockAudio(); startCourse(); } },
    release: () => held.clear(),
    toMenu: () => { held.clear(); paused = false; banner = null; toast = null; if (stage) showTitle(); else { game.phase = "title"; api.state = "menu"; } },
    pause: (p: boolean) => { paused = !!p; if (p) held.clear(); },
    stop: () => { paused = true; held.clear(); suspendAudio(); },
    // for automated tests: play an exact shot, and read the state
    debug: () => ({ ballId: game.ball.id, phase: game.phase, hole: game.index + 1, strokes: game.strokes, scores: game.scores, aces: game.aces, powers: game.powers, aim: [aim.dir.x, aim.dir.y, aim.power], ball: game.sim?.ballPosition(), ready: physicsReady }),
    debugShot: (dx: number, dz: number, power: number) => { if (game.phase === "intro") { game.introT = 2.6; game.phase = "aim"; } aim.dir.set(dx, dz).normalize(); aim.power = power; shoot(); },
    debugBall: (id: string) => { game.ball = ballById(id); },
    debugPower: () => usePower("special"),
    debugHole: (i: number) => { if (physicsReady) { game.scores = []; game.aces = []; loadHole(i - 1); } }
  });
}

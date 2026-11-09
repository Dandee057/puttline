/**
 * Sound effects, synthesised with the Web Audio API: no files to load. Browsers only allow audio after the
 * player interacts with the page, so the context starts on the first tap or click.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
try { muted = localStorage.getItem("puttline.muted") === "1"; } catch { /* storage unavailable */ }

export function unlockAudio(): void {
  if (ctx) { void ctx.resume(); return; }
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.6;
    master.connect(ctx.destination);
  } catch { ctx = null; }
}

/** Go quiet straight away (the cartridge build, when its console is switched to another game). */
export function suspendAudio(): void { if (ctx && ctx.state === "running") void ctx.suspend(); }

export const isMuted = () => muted;
export function setMuted(m: boolean): void {
  muted = m;
  try { localStorage.setItem("puttline.muted", m ? "1" : "0"); } catch { /* fine */ }
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.6, ctx.currentTime, 0.02);
}

function tone(freq: number, dur: number, vol: number, type: OscillatorType = "sine", endFreq?: number, delay = 0): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

let noiseBuffer: AudioBuffer | null = null;
function noise(dur: number, vol: number, filter: BiquadFilterType, freq: number, delay = 0): void {
  if (!ctx || !master) return;
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + delay, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noiseBuffer;
  f.type = filter; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t); src.stop(t + dur + 0.02);
}

const clamp01 = (v: number) => Math.max(0.02, Math.min(1, v));

export const sfx = {
  putt(power: number) {
    noise(0.05, 0.5 * clamp01(power + 0.3), "highpass", 2500);
    tone(1100, 0.08, 0.25 * clamp01(power + 0.3), "triangle", 700);
  },
  wall(speed: number) {
    const v = clamp01(speed / 8);
    tone(210, 0.12, 0.45 * v, "sine", 120);
    noise(0.04, 0.25 * v, "lowpass", 1200);
  },
  bumper() {
    tone(320, 0.22, 0.35, "sine", 760);
    tone(640, 0.18, 0.12, "triangle", 1200, 0.02);
  },
  thunk(speed: number) { tone(150, 0.16, 0.45 * clamp01(speed / 6), "triangle", 80); },
  cup() {
    [0, 0.07, 0.13].forEach((d, i) => tone(900 - i * 120, 0.05, 0.25, "square", 500, d));
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.5, 0.18, "sine", undefined, 0.22 + i * 0.09));
  },
  /** Into the golden hole: a rising whoosh, then a chime as it drops into the cup. */
  warp() { tone(220, 0.6, 0.22, "sine", 1760); noise(0.5, 0.15, "bandpass", 2400); },
  ace() { [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568].forEach((f, i) => { tone(f, 0.45, 0.16, "triangle", undefined, i * 0.08); tone(f * 2, 0.3, 0.05, "sine", undefined, i * 0.08 + 0.02); }); },
  /** Power-ups. A toot is a wobbly low buzz with a bit of air in it. */
  toot() {
    if (!ctx || !master) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), lfo = ctx.createOscillator(), depth = ctx.createGain(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = "sawtooth"; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.55);
    lfo.frequency.value = 26; depth.gain.value = 18; lfo.connect(depth).connect(o.frequency);
    f.type = "lowpass"; f.frequency.value = 650;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(f).connect(g).connect(master);
    o.start(t); lfo.start(t); o.stop(t + 0.65); lfo.stop(t + 0.65);
    noise(0.45, 0.08, "lowpass", 500);
  },
  boing() { tone(180, 0.18, 0.3, "sine", 720); tone(720, 0.25, 0.12, "triangle", 360, 0.16); },
  rewind() { tone(1400, 0.35, 0.18, "triangle", 220); noise(0.3, 0.06, "highpass", 3000); },
  splash() { noise(0.6, 0.5, "lowpass", 900); tone(300, 0.3, 0.1, "sine", 90); },
  fanfare() { [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, 0.35, 0.16, "triangle", undefined, i * 0.1)); },
  /** The three balls' powers. Samurai: the blade drawn (a metallic shing), and each cut (a swish and a clack). */
  slash() { noise(0.25, 0.3, "highpass", 5000); tone(2400, 0.4, 0.12, "triangle", 3200); tone(4800, 0.3, 0.05, "sine", undefined, 0.02); },
  cut() { noise(0.12, 0.35, "bandpass", 3500); tone(900, 0.08, 0.2, "square", 300); },
  /** Frost: a sparkling crackle as everything freezes, and a crunch when it thaws. */
  freeze() { [1568, 2093, 2637, 3136].forEach((f, i) => tone(f, 0.4, 0.08, "sine", f * 0.8, i * 0.05)); noise(0.6, 0.12, "highpass", 6000); },
  thaw() { noise(0.35, 0.25, "bandpass", 1200); tone(400, 0.2, 0.08, "triangle", 160); },
  /** A tree cut down: a crack, then the creak and thump as it falls. */
  timber() { noise(0.08, 0.4, "bandpass", 2200); tone(220, 0.5, 0.12, "sawtooth", 90, 0.08); noise(0.3, 0.35, "lowpass", 300, 0.55); },
  /** Mecha: the magnet powering up. */
  magnet() { tone(120, 0.6, 0.25, "sawtooth", 480); tone(240, 0.6, 0.08, "square", 960, 0.05); }
};

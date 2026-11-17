// Game sound effects, synthesised with the Web Audio API (no audio files).
// Card sounds are short bursts of filtered noise; chimes and fanfares are simple tones.
const KEY = 'pev-sfx';
let ctx = null, master = null, noiseBuf = null;
let muted = (() => { try { return localStorage.getItem(KEY) === 'off'; } catch { return false; } })();

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem(KEY, m ? 'off' : 'on'); } catch { /* */ }
  if (!m) unlock();
}

/** Browsers only allow sound after a tap/click: call this from any user gesture */
export function unlock() {
  if (!window.AudioContext && !window.webkitAudioContext) return null;
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
const ready = () => !muted && ctx && ctx.state === 'running';

/** Filtered noise burst — the "snap" / "swish" of a card */
function noise({ at = 0, dur = 0.08, freq = 2500, q = 0.9, type = 'bandpass', gain = 0.6, sweep = null, attack = 0.002 }) {
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.3); src.stop(t + dur + 0.02);
}
/** A tone with a quick attack and exponential release */
function tone({ at = 0, freq = 440, dur = 0.25, type = 'sine', gain = 0.25, to = null, attack = 0.008 }) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  /** Card put down on the felt */
  card(at = 0) {
    if (!ready()) return;
    noise({ at, dur: 0.07, freq: 3200, q: 0.7, gain: 0.5 });
    noise({ at: at + 0.005, dur: 0.12, freq: 260, q: 1.2, type: 'lowpass', gain: 0.35 });
  },
  /** Card slid off the deck */
  draw() {
    if (!ready()) return;
    noise({ dur: 0.22, freq: 900, sweep: 4200, q: 0.6, gain: 0.32, attack: 0.03 });
    noise({ at: 0.2, dur: 0.06, freq: 3000, q: 0.8, gain: 0.25 });
  },
  /** Riffle shuffle, then a few cards dealt */
  shuffle() {
    if (!ready()) return;
    for (let i = 0; i < 26; i++) noise({ at: i * 0.022 + Math.random() * 0.008, dur: 0.035, freq: 2600 + Math.random() * 1800, q: 1.4, gain: 0.22 });
    noise({ at: 0.62, dur: 0.12, freq: 220, type: 'lowpass', q: 1, gain: 0.4 });
    for (let i = 0; i < 5; i++) sfx.card(0.85 + i * 0.13);
  },
  /** Lai (follow) — card snap plus a bright rising "zing" */
  lai() {
    if (!ready()) return;
    sfx.card();
    [660, 880, 1320].forEach((f, i) => tone({ at: 0.04 + i * 0.06, freq: f, dur: 0.22, type: 'triangle', gain: 0.16 }));
    tone({ at: 0.04, freq: 1800, to: 3600, dur: 0.25, type: 'sine', gain: 0.05 });
  },
  /** Kaeng! — drum hit and a short brassy chord */
  kaeng() {
    if (!ready()) return;
    tone({ freq: 150, to: 45, dur: 0.45, type: 'sine', gain: 0.7, attack: 0.003 });
    noise({ dur: 0.18, freq: 1200, q: 0.5, gain: 0.35 });
    [261.6, 329.6, 392].forEach((f) => tone({ at: 0.12, freq: f, dur: 0.7, type: 'sawtooth', gain: 0.06, attack: 0.02 }));
    [523.2, 659.3].forEach((f) => tone({ at: 0.12, freq: f, dur: 0.6, type: 'square', gain: 0.025, attack: 0.02 }));
  },
  /** It is your turn */
  turn() {
    if (!ready()) return;
    tone({ freq: 880, dur: 0.35, gain: 0.18 });
    tone({ at: 0.12, freq: 1318.5, dur: 0.5, gain: 0.16 });
  },
  win() {
    if (!ready()) return;
    [523.2, 659.3, 784, 1046.5].forEach((f, i) => tone({ at: i * 0.11, freq: f, dur: 0.3, type: 'triangle', gain: 0.22 }));
    [523.2, 659.3, 784, 1046.5].forEach((f) => tone({ at: 0.46, freq: f, dur: 1.1, type: 'triangle', gain: 0.1 }));
    for (let i = 0; i < 10; i++) tone({ at: 0.5 + i * 0.07, freq: 2000 + Math.random() * 2000, dur: 0.12, gain: 0.03 });
  },
  lose() {
    if (!ready()) return;
    [392, 370, 349.2, 311.1].forEach((f, i) => tone({ at: i * 0.2, freq: f, dur: i === 3 ? 0.8 : 0.24, type: 'triangle', gain: 0.18 }));
  },
  /** Someone joined the room */
  join() {
    if (!ready()) return;
    tone({ freq: 587.3, dur: 0.15, gain: 0.14 }); tone({ at: 0.08, freq: 880, dur: 0.22, gain: 0.14 });
  },
  /** Tiny click for picking a card / pressing a button */
  tick() {
    if (!ready()) return;
    noise({ dur: 0.025, freq: 5000, q: 2, gain: 0.18 });
  },
};

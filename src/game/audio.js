/* ============================================================
   AUDIO — tiny synth (placeholder until generated SFX land).
   Lazily created on first user gesture; every call guarded.
   ============================================================ */

let ACTX = null;
let muted = false;

function ctx() {
  if (!ACTX) ACTX = new (window.AudioContext || window.webkitAudioContext)();
  if (ACTX.state === "suspended") ACTX.resume();
  return ACTX;
}

function tone(freq, dur, type = "sine", gain = 0.06, when = 0, glideTo = null) {
  if (muted) return;
  try {
    const ac = ctx();
    const t = ac.currentTime + when;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(ac.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  } catch (e) {
    /* audio unavailable — fine */
  }
}

function noise(dur, gain = 0.05, when = 0, lp = 1200) {
  if (muted) return;
  try {
    const ac = ctx();
    const t = ac.currentTime + when;
    const len = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = lp;
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(ac.destination);
    src.start(t);
  } catch (e) { /* fine */ }
}

export const SFX = {
  click: () => tone(240, 0.06, "square", 0.04),
  good: () => { tone(523, 0.1, "triangle", 0.07); tone(784, 0.16, "triangle", 0.07, 0.09); },
  bad: () => { tone(131, 0.22, "sawtooth", 0.06); noise(0.18, 0.04, 0, 700); },
  big: () => { tone(523, 0.12, "triangle", 0.08); tone(659, 0.12, "triangle", 0.08, 0.11); tone(1047, 0.3, "triangle", 0.09, 0.22); },
  tick: () => tone(1180, 0.04, "square", 0.03),
  jump: () => tone(330, 0.18, "triangle", 0.06, 0, 660),
  land: () => noise(0.12, 0.06, 0, 500),
  hit: () => { tone(98, 0.3, "sawtooth", 0.08); noise(0.25, 0.07, 0, 900); },
  correct: () => {
    tone(523, 0.1, "triangle", 0.09);
    tone(659, 0.1, "triangle", 0.09, 0.08);
    tone(784, 0.12, "triangle", 0.1, 0.16);
    tone(1047, 0.34, "triangle", 0.11, 0.24);
    noise(0.18, 0.03, 0.24, 5200);
  },
  wrongBuzz: () => {
    tone(160, 0.28, "sawtooth", 0.09, 0, 92);
    tone(110, 0.3, "square", 0.07, 0.05, 70);
    noise(0.22, 0.05, 0, 500);
  },
  slowIn: () => tone(880, 0.5, "sine", 0.05, 0, 140),
  slowOut: () => tone(140, 0.35, "sine", 0.05, 0, 880),
  heart: () => { tone(70, 0.09, "sine", 0.05); tone(70, 0.09, "sine", 0.05, 0.16); },
  flag: () => {
    tone(523, 0.14, "triangle", 0.08);
    tone(659, 0.14, "triangle", 0.08, 0.13);
    tone(784, 0.14, "triangle", 0.08, 0.26);
    tone(1047, 0.42, "triangle", 0.1, 0.39);
  },
};

export function setMuted(m) { muted = m; }
export function isMuted() { return muted; }

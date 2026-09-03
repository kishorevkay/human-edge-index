const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class AudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.music = null;
    this.effects = null;
    this.filter = null;
    this.pad = [];
    this.sequenceTimer = null;
    this.muted = false;
    this.started = false;
    this.chordIndex = 0;
  }

  async start() {
    if (this.started) {
      await this.resume();
      return;
    }
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;

    this.context = new Context();
    this.master = this.context.createGain();
    this.music = this.context.createGain();
    this.effects = this.context.createGain();
    this.filter = this.context.createBiquadFilter();
    const compressor = this.context.createDynamicsCompressor();
    this.compressor = compressor;

    this.master.gain.value = this.muted ? 0 : 0.72;
    this.music.gain.value = 0.22;
    this.effects.gain.value = 0.72;
    this.filter.type = "lowpass";
    this.filter.frequency.value = 1700;
    this.filter.Q.value = 0.35;

    this.music.connect(this.filter);
    this.filter.connect(compressor);
    this.effects.connect(compressor);
    compressor.connect(this.master);
    this.master.connect(this.context.destination);

    this.startPad();
    this.started = true;
    await this.resume();
  }

  async resume() {
    if (this.context?.state === "suspended") await this.context.resume();
  }

  startPad() {
    if (!this.context || this.pad.length) return;
    const now = this.context.currentTime;
    const base = [130.81, 164.81, 196.0, 246.94];

    this.pad = base.map((frequency, index) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = index % 2 ? "sine" : "triangle";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = index % 2 ? 4 : -4;
      gain.gain.value = 0.0001;
      gain.gain.exponentialRampToValueAtTime(index === 0 ? 0.026 : 0.014, now + 2.4);
      oscillator.connect(gain);
      gain.connect(this.music);
      oscillator.start(now);
      return { oscillator, gain };
    });

    const chords = [
      [130.81, 164.81, 196.0, 246.94],
      [110.0, 146.83, 196.0, 220.0],
      [98.0, 130.81, 164.81, 196.0],
      [116.54, 146.83, 174.61, 220.0],
    ];

    this.sequenceTimer = window.setInterval(() => {
      if (!this.context || this.context.state !== "running") return;
      this.chordIndex = (this.chordIndex + 1) % chords.length;
      const t = this.context.currentTime;
      chords[this.chordIndex].forEach((frequency, index) => {
        this.pad[index].oscillator.frequency.cancelScheduledValues(t);
        this.pad[index].oscillator.frequency.setValueAtTime(this.pad[index].oscillator.frequency.value, t);
        this.pad[index].oscillator.frequency.exponentialRampToValueAtTime(frequency, t + 1.8);
      });
      this.bell(chords[this.chordIndex][2] * 2, 0.55, 0.012);
    }, 4400);
  }

  stop() {
    window.clearInterval(this.sequenceTimer);
    this.sequenceTimer = null;
    for (const voice of this.pad) {
      try { voice.oscillator.stop(); } catch (_) { /* already stopped */ }
    }
    this.pad = [];
    if (this.context) {
      this.context.close();
      this.context = null;
    }
    this.started = false;
  }

  setMuted(value) {
    this.muted = value;
    if (!this.master || !this.context) return;
    const t = this.context.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(value ? 0 : 0.72, t, 0.04);
  }

  tone(frequency, duration = 0.12, options = {}) {
    if (!this.context || !this.effects || this.muted) return;
    const {
      type = "sine",
      gain = 0.08,
      delay = 0,
      glide = null,
      destination = this.effects,
    } = options;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const amp = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), start);
    if (glide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, glide), start + duration);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(clamp(gain, 0.0001, 0.45), start + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(amp);
    amp.connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.04);
  }

  noise(duration = 0.18, options = {}) {
    if (!this.context || !this.effects || this.muted) return;
    const { gain = 0.06, delay = 0, lowpass = 900 } = options;
    const start = this.context.currentTime + delay;
    const length = Math.max(1, Math.floor(this.context.sampleRate * duration));
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      const fade = 1 - i / length;
      data[i] = (Math.random() * 2 - 1) * fade;
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const amp = this.context.createGain();
    source.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.value = lowpass;
    amp.gain.setValueAtTime(gain, start);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(amp);
    amp.connect(this.effects);
    source.start(start);
  }

  bell(frequency, duration = 0.5, gain = 0.025, delay = 0) {
    this.tone(frequency, duration, { type: "sine", gain, delay });
    this.tone(frequency * 2.01, duration * 0.7, { type: "sine", gain: gain * 0.38, delay: delay + 0.01 });
  }

  // --- Real SFX samples (delivered 2026-08-14). The synth below stays as the
  // fallback for anything without a file, or if a sample fails to decode. ---
  sample(name, volume = 0.85) {
    if (this.muted) return false;
    try {
      if (!this._samples) this._samples = {};
      let a = this._samples[name];
      if (!a) {
        a = new Audio(`/assets/human-instincts/sfx/${name}.mp3`);
        a.preload = "auto";
        this._samples[name] = a;
      }
      const node = a.cloneNode();     // clone so rapid taps can overlap
      // iOS makes HTMLMediaElement.volume READ-ONLY — assignments are silently
      // ignored and the getter keeps returning 1, so every designed level was
      // being thrown away and everything played at full blast on iPhone. Route
      // through a WebAudio gain node instead, which iOS does honour.
      node.volume = volume;                       // still the cheap path elsewhere
      if (this.context && this.compressor) {
        try {
          const src = this.context.createMediaElementSource(node);
          const g = this.context.createGain();
          g.gain.value = volume;
          src.connect(g); g.connect(this.compressor);
          node.volume = 1;                        // gain node owns the level now
        } catch { /* already routed, or unsupported — element volume stands */ }
      }
      const p = node.play();
      if (p && p.catch) p.catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  click() {
    if (this.sample("tap", 0.6)) return;
    this.tone(310, 0.055, { type: "triangle", gain: 0.055, glide: 430 });
  }

  reveal() { this.sample("reveal", 0.7); }
  tick() { this.sample("tick", 0.35); }
  levelUp() { this.sample("levelup", 0.85); }
  badge() { this.sample("badge", 0.85); }

  hover() {
    this.tone(620, 0.035, { type: "sine", gain: 0.012 });
  }

  transition() {
    this.tone(220, 0.26, { type: "sine", gain: 0.045, glide: 520 });
    this.noise(0.22, { gain: 0.018, lowpass: 3200 });
  }

  success() {
    if (this.sample("correct", 0.8)) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((note, index) => {
      this.bell(note, 0.34 + index * 0.04, 0.055, index * 0.09);
    });
  }

  failure() {
    // deliberately gentle — a soft thud, never a buzzer. We are not punishing people.
    if (this.sample("wrong", 0.6)) return;
    this.tone(170, 0.34, { type: "sawtooth", gain: 0.08, glide: 74 });
    this.tone(112, 0.32, { type: "square", gain: 0.045, delay: 0.05, glide: 62 });
    this.noise(0.28, { gain: 0.065, lowpass: 560 });
  }

  lever() {
    this.tone(190, 0.08, { type: "square", gain: 0.06, glide: 92 });
    this.noise(0.13, { gain: 0.07, delay: 0.05, lowpass: 430 });
  }

  conveyorStop() {
    this.tone(96, 0.72, { type: "sawtooth", gain: 0.04, glide: 34 });
    this.noise(0.52, { gain: 0.035, lowpass: 480 });
  }

  boxesCrash() {
    [0, 0.08, 0.17].forEach((delay, index) => {
      this.noise(0.22, { gain: 0.075 - index * 0.012, delay, lowpass: 520 + index * 220 });
      this.tone(82 + index * 18, 0.18, { type: "triangle", gain: 0.035, delay, glide: 48 });
    });
  }

  scan() {
    this.tone(420, 0.32, { type: "sine", gain: 0.05, glide: 1180 });
    this.tone(1480, 0.08, { type: "sine", gain: 0.055, delay: 0.34 });
  }

  alarm() {
    [0, 0.2, 0.4].forEach((delay) => {
      this.tone(760, 0.13, { type: "square", gain: 0.052, delay });
      this.tone(620, 0.13, { type: "square", gain: 0.042, delay: delay + 0.1 });
    });
  }

  brake() {
    this.noise(0.48, { gain: 0.07, lowpass: 1800 });
    this.tone(220, 0.42, { type: "sawtooth", gain: 0.035, glide: 88 });
  }

  impact() {
    this.tone(74, 0.42, { type: "sine", gain: 0.11, glide: 38 });
    this.noise(0.38, { gain: 0.09, lowpass: 720 });
  }

  /* Ambient bed — 57s "Analog Thoughts", crossfaded so the loop join is silent.
     Mixed deliberately low: it should register as momentum under the clock, not
     as music you're listening to. If it ever needs tuning, this default is the
     single knob. */
  ambientStart(volume = 0.17) {
    if (this.muted) return;
    if (this._ambient && !this._ambient.paused) return;
    try {
      // Built once and reused. Creating a new Audio() per call re-downloaded
      // the whole 900KB track on every mute toggle.
      if (!this._ambient) {
        this._ambient = new Audio("/assets/human-instincts/sfx/ambient-loop.mp3");
        this._ambient.loop = true;
        this._ambient.preload = "auto";
      }
      const a = this._ambient;
      // Same iOS read-only-volume trap as sample(). Without the gain node the
      // bed opened at full volume on iPhone — roughly 6x the intended level,
      // over the pad and every effect.
      if (this.context && this.compressor && !this._ambientGain) {
        try {
          this._ambientSrc = this.context.createMediaElementSource(a);
          this._ambientGain = this.context.createGain();
          this._ambientGain.gain.value = 0;
          this._ambientSrc.connect(this._ambientGain);
          this._ambientGain.connect(this.compressor);
          a.volume = 1;
        } catch { this._ambientGain = null; }
      }
      const setLevel = (v) => {
        if (this._ambientGain) this._ambientGain.gain.value = v;
        else a.volume = v;
      };
      setLevel(0);
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
      if (this._ambientFade) clearInterval(this._ambientFade);
      const target = volume;
      let v = 0;
      this._ambientFade = setInterval(() => {
        v = Math.min(target, v + target / 25);
        setLevel(v);
        if (v >= target) { clearInterval(this._ambientFade); this._ambientFade = 0; }
      }, 60);
    } catch { /* autoplay policy — the game is fine without it */ }
  }

  ambientStop() {
    if (this._ambientFade) { clearInterval(this._ambientFade); this._ambientFade = 0; }
    const a = this._ambient;
    if (!a || a.paused) return;
    let v = this._ambientGain ? this._ambientGain.gain.value : a.volume;
    const out = setInterval(() => {
      v -= 0.02;
      if (v <= 0) {
        clearInterval(out);
        if (this._ambientGain) this._ambientGain.gain.value = 0;
        try { a.pause(); a.currentTime = 0; } catch {}
        return;
      }
      if (this._ambientGain) this._ambientGain.gain.value = Math.max(0, v);
      else a.volume = Math.max(0, v);
    }, 40);
  }
}

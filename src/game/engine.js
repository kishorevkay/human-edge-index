/* ============================================================
   HUMAN EDGE RUNNER — canvas engine
   Design resolution 1920x1080, letterboxed to window.
   Timescale-driven world: bullet-time is just ts -> 0.06.
   Every visual has a coded placeholder; approved sprites from
   /assets/ (see ASSET-BRIDGE.md) hot-swap in when present.
   ============================================================ */

import { SFX } from "./audio.js";

const W = 1920, H = 1080;
const GROUND = 900;
const RUNNER_X = 560;          // runner's fixed screen-ish anchor (world units)
const BASE_SPEED = 470;        // px/s world scroll
const GRAVITY = 3000;
const JUMP_VY = -1180;
const TRIGGER_DIST = 780;      // obstacle distance that opens the question
const FREEZE_DIST = 170;       // full time-freeze guard while question open
const JUMP_DIST = 380;         // distance at which a resolved-right runner vaults

const PAL = {
  ink: "#080B16", human: "#FFB454", humanDeep: "#D98E2B",
  machine: "#7FE3FF", machineDim: "#2A4E6B", bad: "#FF5470",
  mut: "#8B94B8", text: "#E9EDFB",
};

/* deterministic pseudo-random for procedural scenery */
function srand(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export class Engine {
  constructor(canvas, round, hooks) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.round = round;
    this.hooks = hooks; // { onQuestion, onImpact, onCleared, onFinale, onDead, onTick }

    this.assets = {};   // id -> HTMLImageElement (approved only)
    this.reset();

    this._raf = null;
    this._last = 0;
    this._resize = this.resizeToWindow.bind(this);
    window.addEventListener("resize", this._resize);
    this.resizeToWindow();
  }

  reset() {
    this.worldX = 0;
    this.ts = 1; this.tsTarget = 1;
    this.state = "idle"; // idle | running | question | resolving | finale | dead | done
    this.hearts = 3;
    this.runner = { y: GROUND, vy: 0, pose: "run", phase: 0, hitT: 0, blinkT: 0, landT: 0, trail: [] };
    this.shake = 0;
    this.zoom = 1; this.zoomTarget = 1;
    this.particles = [];
    this.popups = [];
    this.bubble = null; // { text, t }
    this.flagT = 0;
    this.doneT = 0;
    this.deadT = 0;
    this.pendingRight = false;
    this.eventIdx = 0;
    const start = 1900;
    this.obstacles = this.round.events.map((e, i) => ({
      ev: e, x: start + i * this.round.spacing, resolved: false, shattered: false, cleared: false,
    }));
    const last = this.obstacles[this.obstacles.length - 1];
    this.finaleX = last.x + 1800;
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    clearInterval(this._watchdog);
    window.removeEventListener("resize", this._resize);
  }

  resizeToWindow() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const vw = window.innerWidth, vh = window.innerHeight;
    const scale = Math.min(vw / W, vh / H);
    this.cv.width = Math.round(W * scale * dpr);
    this.cv.height = Math.round(H * scale * dpr);
    this.cv.style.width = `${Math.round(W * scale)}px`;
    this.cv.style.height = `${Math.round(H * scale)}px`;
    this.drawScale = scale * dpr;
  }

  async loadAssets() {
    try {
      const res = await fetch("/assets/manifest.json", { cache: "no-store" });
      if (!res.ok) return;
      const man = await res.json();
      const jobs = (man.assets || [])
        .filter((a) => a.status === "approved")
        .map((a) => new Promise((done) => {
          const img = new Image();
          img.onload = () => { this.assets[a.id] = { img, meta: a }; done(); };
          img.onerror = () => done();
          img.src = `/assets/${a.file}`;
        }));
      await Promise.all(jobs);
    } catch (e) { /* no manifest yet — placeholders carry the day */ }
  }

  start() {
    this.reset();
    this.state = "running";
    this._last = performance.now();
    cancelAnimationFrame(this._raf);
    clearInterval(this._watchdog);
    const step = (t) => {
      let dt = Math.min(0.5, (t - this._last) / 1000 || 0.016);
      this._last = t;
      // sub-step so physics stays stable at any real frame interval
      while (dt > 0) {
        this.update(Math.min(0.033, dt));
        dt -= 0.033;
      }
      this.render();
    };
    const loop = (t) => {
      step(t);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
    // rAF stalls when the tab is occluded/backgrounded — keep the sim
    // honest with a low-rate watchdog so the run never silently freezes.
    this._watchdog = setInterval(() => {
      const now = performance.now();
      if (now - this._last > 200) step(now);
    }, 100);
  }

  say(text, dur = 3.2) { this.bubble = { text, t: dur }; }

  /* ---------- called by the UI layer ---------- */
  resolve({ right, points }) {
    if (this.state !== "question") return;
    this.pendingRight = right;
    this.pendingPoints = points;
    this.state = "resolving";
    if (right) {
      // dopamine beat: hold cinematic slow-mo + punch-in for the vault,
      // snap back to full speed the moment the obstacle is cleared
      this.tsTarget = 0.5;
      this.zoomTarget = 1.34;
    } else {
      this.tsTarget = 1;
      this.zoomTarget = 1;
      SFX.slowOut();
    }
  }

  /* extend the question freeze (verdict -> name-the-flaw phase) */
  holdQuestion() { if (this.state === "question") this.tsTarget = 0.045; }

  update(dt) {
    // eased timescale + zoom (real-time, not world-time)
    this.ts += (this.tsTarget - this.ts) * Math.min(1, dt * 5.5);
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 4.5);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 26);
    if (this.bubble && (this.bubble.t -= dt) <= 0) this.bubble = null;

    const wdt = dt * this.ts;
    const r = this.runner;

    if (this.state === "dead") {
      this.deadT += dt;
      r.hitT += dt;
      this.updateFx(dt, wdt);
      return;
    }
    if (this.state === "done") { this.updateFx(dt, wdt); return; }

    const next = this.obstacles[this.eventIdx];

    // world scroll (stops at the flag pole)
    let speed = BASE_SPEED;
    if (this.state === "finale") {
      const toPole = this.finaleX - (this.worldX + RUNNER_X);
      speed = Math.max(0, Math.min(BASE_SPEED, toPole * 1.6));
      if (toPole <= 12 && r.y >= GROUND && this.flagT === 0) {
        this.flagT = 0.0001;
        r.pose = "victory";
        SFX.flag();
        this.burst(RUNNER_X, GROUND - 220, PAL.human, 60);
        this.hooks.onFinale && this.hooks.onFinale();
      }
    }
    this.worldX += speed * wdt;

    if (this.flagT > 0 && this.flagT < 1) this.flagT = Math.min(1, this.flagT + dt * 0.55);

    // runner physics
    r.phase += wdt * 11;
    if (r.y < GROUND || r.vy !== 0) {
      r.vy += GRAVITY * wdt;
      r.y += r.vy * wdt;
      if (r.y >= GROUND) {
        r.y = GROUND; r.vy = 0;
        if (r.pose === "jump") {
          r.pose = "run"; r.landT = 0.16;
          SFX.land(); this.burst(RUNNER_X, GROUND, PAL.mut, 10, 0.5);
        }
      }
    }
    if (r.hitT > 0) { r.hitT -= dt; if (r.hitT <= 0) r.pose = "run"; }
    if (r.landT > 0) r.landT -= dt;
    // afterimage trail while airborne
    if (r.pose === "jump") {
      r.trail.push({ y: r.y, wx: this.worldX, t: 0.3 });
    }
    for (const s of r.trail) s.t -= dt;
    r.trail = r.trail.filter((s) => s.t > 0).slice(-14);

    // question trigger
    if (this.state === "running" && next) {
      const gap = next.x - (this.worldX + RUNNER_X);
      if (gap <= TRIGGER_DIST) {
        this.state = "question";
        this.tsTarget = 0.06;
        this.zoomTarget = 1.16;
        SFX.slowIn();
        this.hooks.onQuestion && this.hooks.onQuestion(next.ev);
      }
    }

    // freeze guard: never let the obstacle reach the runner mid-question
    if (this.state === "question" && next) {
      const gap = next.x - (this.worldX + RUNNER_X);
      if (gap <= FREEZE_DIST) this.tsTarget = 0;
    }

    // resolving: play out the vault or the impact
    if (this.state === "resolving" && next) {
      const gap = next.x - (this.worldX + RUNNER_X);
      if (this.pendingRight) {
        if (gap <= JUMP_DIST && r.y >= GROUND && r.pose !== "jump") {
          r.pose = "jump"; r.vy = JUMP_VY; SFX.jump();
        }
        if (gap <= -120 && !next.cleared) {
          next.cleared = true; next.resolved = true;
          this.popup(`+${this.pendingPoints}`, PAL.human);
          this.burst(next.x - this.worldX, GROUND - 160, PAL.human, 26);
          this.advance();
        }
      } else {
        if (gap <= 30 && !next.shattered) {
          next.shattered = true; next.resolved = true;
          this.hearts -= 1;
          r.pose = "hit"; r.hitT = 0.7;
          this.shake = 1.4;
          SFX.hit(); SFX.heart();
          this.burst(next.x - this.worldX, GROUND - 120, PAL.bad, 40);
          this.popup(this.pendingPoints > 0 ? `+${this.pendingPoints}` : "+0", this.pendingPoints > 0 ? PAL.humanDeep : PAL.bad);
          if (this.hearts <= 0) {
            this.state = "dead";
            this.tsTarget = 0.25;
            this.hooks.onDead && this.hooks.onDead();
          } else {
            this.hooks.onImpact && this.hooks.onImpact(this.hearts);
            this.advance();
          }
        }
      }
    }

    this.updateFx(dt, wdt);
    this.hooks.onTick && this.hooks.onTick(dt);
  }

  advance() {
    this.eventIdx += 1;
    // snap back to full speed after the cinematic vault
    this.tsTarget = 1;
    this.zoomTarget = 1;
    if (this.ts < 0.8) SFX.slowOut();
    if (this.eventIdx >= this.obstacles.length) {
      this.state = "finale";
    } else {
      this.state = "running";
    }
    this.hooks.onCleared && this.hooks.onCleared(this.eventIdx);
  }

  finishDone() { this.state = "done"; }

  /* ---------- fx ---------- */
  burst(x, y, color, n = 20, spd = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (140 + Math.random() * 420) * spd;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 160, t: 0.7 + Math.random() * 0.5, color, s: 3 + Math.random() * 6 });
    }
  }
  popup(text, color) { this.popups.push({ text, color, x: RUNNER_X + 60, y: GROUND - 260, t: 1.3 }); }

  updateFx(dt, wdt) {
    for (const p of this.particles) { p.t -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 1400 * dt; }
    this.particles = this.particles.filter((p) => p.t > 0);
    for (const p of this.popups) { p.t -= dt; p.y -= 90 * dt; }
    this.popups = this.popups.filter((p) => p.t > 0);
  }

  /* ============================================================
     RENDER
     ============================================================ */
  render() {
    const c = this.ctx;
    c.setTransform(this.drawScale, 0, 0, this.drawScale, 0, 0);
    c.clearRect(0, 0, W, H);

    // camera: zoom around the action focus; drifts up with the jump arc
    const focusX = RUNNER_X + 260;
    const focusY = GROUND - 240 + (this.runner.y - GROUND) * 0.35;
    const shx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 22 : 0;
    const shy = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 16 : 0;
    c.save();
    c.translate(focusX + shx, focusY + shy);
    c.scale(this.zoom, this.zoom);
    c.translate(-focusX, -focusY);

    this.drawSky(c);
    this.drawLayer(c, 0.12, 1);   // far skyline
    this.drawLayer(c, 0.32, 2);   // mid buildings
    this.drawTower(c);
    this.drawTrack(c);
    this.drawObstacles(c);
    this.drawRunner(c);
    this.drawCompanion(c);

    for (const p of this.particles) {
      c.globalAlpha = Math.max(0, Math.min(1, p.t * 1.6));
      c.fillStyle = p.color;
      c.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s * 0.7);
    }
    c.globalAlpha = 1;

    for (const p of this.popups) {
      c.globalAlpha = Math.max(0, Math.min(1, p.t * 1.4));
      c.font = "700 64px 'Chakra Petch', sans-serif";
      c.fillStyle = p.color;
      c.textAlign = "center";
      c.shadowColor = p.color; c.shadowBlur = 24;
      c.fillText(p.text, p.x, p.y);
      c.shadowBlur = 0;
    }
    c.globalAlpha = 1;
    c.restore();

    // slow-mo vignette + scanline wash (screen space)
    const slow = 1 - Math.min(1, this.ts);
    if (slow > 0.05) {
      const g = c.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.85);
      g.addColorStop(0, "rgba(8,11,22,0)");
      g.addColorStop(1, `rgba(8,11,22,${0.55 * slow})`);
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      c.fillStyle = `rgba(127,227,255,${0.05 * slow})`;
      for (let y = 0; y < H; y += 6) c.fillRect(0, y, W, 2);
    }
  }

  drawSky(c) {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#060812");
    g.addColorStop(0.55, "#0A1020");
    g.addColorStop(1, "#0D1428");
    c.fillStyle = g;
    c.fillRect(-200, -200, W + 400, H + 400);
    const sheet = this.assets.bg_sky;
    if (sheet) {
      // full-cover seamless sky, barely drifting
      this.tile(c, sheet.img, 0.05, -80, H + 160);
      return;
    }
    // fallback stars
    const rand = srand(7);
    c.fillStyle = "rgba(233,237,251,.5)";
    const off = (this.worldX * 0.02) % (W + 400);
    for (let i = 0; i < 90; i++) {
      const x = ((rand() * (W + 400) - off) + W + 400) % (W + 400) - 200;
      const y = rand() * H * 0.55;
      const s = rand() * 2 + 0.4;
      c.globalAlpha = 0.25 + rand() * 0.5;
      c.fillRect(x, y, s, s);
    }
    c.globalAlpha = 1;
  }

  drawLayer(c, speed, tier) {
    const idKey = tier === 1 ? "bg_skyline" : "bg_midground";
    const sheet = this.assets[idKey];
    if (sheet) {
      // bottom-anchored city bands: skyline sits on the horizon,
      // midground overlaps the track edge slightly. Slightly faded so
      // gameplay elements (runner/obstacles) pop in front.
      const h = tier === 1 ? 620 : 700;
      const yBottom = tier === 1 ? GROUND + 10 : GROUND + 50;
      c.globalAlpha = tier === 1 ? 0.9 : 0.82;
      this.tile(c, sheet.img, speed, yBottom - h, h);
      c.globalAlpha = 1;
      return;
    }
    // procedural silhouettes
    const rand = srand(tier * 999);
    const span = 420;
    const baseY = tier === 1 ? GROUND - 160 : GROUND - 40;
    const off = this.worldX * speed;
    c.fillStyle = tier === 1 ? "#0B1326" : "#0E1830";
    const first = Math.floor(off / span) - 1;
    for (let i = first; i < first + Math.ceil(W / span) + 3; i++) {
      const rr = srand(i * 31 + tier * 7);
      const bw = 190 + rr() * 200;
      const bh = (tier === 1 ? 300 : 190) + rr() * (tier === 1 ? 380 : 240);
      const x = i * span - off;
      c.fillRect(x, baseY - bh, bw, bh + 200);
      // glowing windows
      c.fillStyle = tier === 1 ? "rgba(127,227,255,.10)" : "rgba(127,227,255,.16)";
      const cols = Math.floor(bw / 46), rows = Math.floor(bh / 64);
      for (let wx = 0; wx < cols; wx++) for (let wy = 0; wy < rows; wy++) {
        if (rr() > 0.62) c.fillRect(x + 16 + wx * 46, baseY - bh + 18 + wy * 64, 20, 30);
      }
      // antenna beacons
      if (rr() > 0.55) {
        c.fillStyle = "rgba(255,84,112,.7)";
        c.fillRect(x + bw / 2 - 2, baseY - bh - 34, 4, 34);
        c.beginPath(); c.arc(x + bw / 2, baseY - bh - 38, 5, 0, 7); c.fill();
      }
      c.fillStyle = tier === 1 ? "#0B1326" : "#0E1830";
    }
  }

  tile(c, img, speed, y, h) {
    const w = img.width * (h / img.height);
    const off = (this.worldX * speed) % w;
    for (let x = -off; x < W; x += w) c.drawImage(img, x, y, w, h);
  }

  drawTrack(c) {
    const sheet = this.assets.track_foreground;
    if (sheet) {
      // manifest collisionTop: the walkable line sits at that fraction
      // of the image height — align it exactly to GROUND
      const cTop = sheet.meta.collisionTop ?? 0.48;
      const h = 380;
      this.tile(c, sheet.img, 1, GROUND - cTop * h, h);
    } else {
      c.fillStyle = "#0A0E1C";
      c.fillRect(-200, GROUND, W + 400, H - GROUND + 200);
      // neon edge
      c.fillStyle = PAL.machineDim;
      c.fillRect(-200, GROUND, W + 400, 4);
      c.fillStyle = "rgba(127,227,255,.55)";
      c.fillRect(-200, GROUND, W + 400, 2);
      // dashed center guides scrolling
      const off = this.worldX % 160;
      c.fillStyle = "rgba(139,148,184,.25)";
      for (let x = -off; x < W; x += 160) c.fillRect(x, GROUND + 44, 70, 5);
      // faint under-glow grid
      c.fillStyle = "rgba(127,227,255,.05)";
      for (let x = -(this.worldX % 90); x < W; x += 90) c.fillRect(x, GROUND, 2, H - GROUND);
    }
  }

  /* ---------- obstacles ---------- */
  drawObstacles(c) {
    for (const o of this.obstacles) {
      const x = o.x - this.worldX;
      if (x < -500 || x > W + 600) continue;
      if (o.shattered) continue;
      const type = o.ev.obstacle;
      const spriteKey = type === "drone" ? "axiom_drone"
        : type === "scanner" ? "obstacle_scanner"
        : type === "spike" ? "obstacle_data_spike"
        : "obstacle_barrier";
      const sheet = this.assets[spriteKey];
      if (sheet) {
        const img = sheet.img;
        // grounding shadow + danger glow so obstacles pop off the midground
        const pulse = (Math.sin(performance.now() / 300) + 1) / 2;
        c.fillStyle = "rgba(0,0,0,.5)";
        c.beginPath(); c.ellipse(x, GROUND + 6, 150, 20, 0, 0, 7); c.fill();
        const glow = c.createRadialGradient(x, GROUND - 160, 30, x, GROUND - 160, 320);
        glow.addColorStop(0, `rgba(255,84,112,${0.10 + pulse * 0.08})`);
        glow.addColorStop(1, "rgba(255,84,112,0)");
        c.fillStyle = glow;
        c.fillRect(x - 340, GROUND - 500, 680, 520);
        if (type === "drone") {
          const bob = Math.sin(performance.now() / 260) * 14;
          const h = 360, w = img.width * (h / img.height);
          c.drawImage(img, x - w / 2, GROUND - 380 - h / 2 + bob, w, h);
        } else {
          const h = 460, w = img.width * (h / img.height);
          c.drawImage(img, x - w / 2, GROUND - h, w, h);
        }
        continue;
      }
      if (type === "scanner") this.phScanner(c, x);
      else if (type === "drone") this.phDrone(c, x);
      else this.phBarrier(c, x);
    }
  }

  phBillboard(c, x, o) {
    // support pylons + big panel leaning over the track
    c.fillStyle = "#131B33";
    c.fillRect(x - 24, GROUND - 400, 22, 400);
    c.fillRect(x + 106, GROUND - 400, 22, 400);
    const panelY = GROUND - 620, pw = 460, ph = 240;
    c.fillStyle = "#0D1530";
    c.strokeStyle = PAL.machineDim;
    c.lineWidth = 4;
    c.beginPath(); c.roundRect(x - pw / 2 + 50, panelY, pw, ph, 14); c.fill(); c.stroke();
    // glowing AXIOM eye on the panel
    c.fillStyle = PAL.machine;
    c.shadowColor = PAL.machine; c.shadowBlur = 26;
    c.beginPath(); c.arc(x + 50, panelY + ph / 2, 34, 0, 7); c.fill();
    c.shadowBlur = 0;
    c.fillStyle = PAL.ink;
    c.beginPath(); c.arc(x + 50, panelY + ph / 2, 15, 0, 7); c.fill();
    // hazard base blocking the track
    c.fillStyle = "#111A34";
    c.strokeStyle = PAL.bad;
    c.lineWidth = 3;
    c.beginPath(); c.roundRect(x - 60, GROUND - 150, 220, 150, 8); c.fill(); c.stroke();
    c.fillStyle = "rgba(255,84,112,.75)";
    for (let i = 0; i < 4; i++) c.fillRect(x - 44 + i * 52, GROUND - 138, 26, 10);
  }

  phScanner(c, x) {
    // checkpoint arch with sweeping beam
    c.fillStyle = "#111A34";
    c.strokeStyle = PAL.machineDim; c.lineWidth = 4;
    c.beginPath(); c.roundRect(x - 30, GROUND - 340, 46, 340, 8); c.fill(); c.stroke();
    c.beginPath(); c.roundRect(x + 150, GROUND - 340, 46, 340, 8); c.fill(); c.stroke();
    c.beginPath(); c.roundRect(x - 40, GROUND - 380, 246, 52, 10); c.fill(); c.stroke();
    const sweep = (Math.sin(performance.now() / 300) + 1) / 2;
    c.fillStyle = `rgba(127,227,255,${0.18 + sweep * 0.2})`;
    c.fillRect(x + 8, GROUND - 330, 150, 330);
    c.fillStyle = PAL.bad;
    c.shadowColor = PAL.bad; c.shadowBlur = 16;
    c.beginPath(); c.arc(x + 83, GROUND - 354, 10, 0, 7); c.fill();
    c.shadowBlur = 0;
  }

  phDrone(c, x) {
    const bob = Math.sin(performance.now() / 260) * 14;
    const y = GROUND - 210 + bob;
    // rotors
    c.fillStyle = "rgba(127,227,255,.4)";
    c.fillRect(x - 120, y - 64, 84, 8);
    c.fillRect(x + 36, y - 64, 84, 8);
    // body
    c.fillStyle = "#12203A";
    c.strokeStyle = PAL.machine; c.lineWidth = 3;
    c.beginPath(); c.roundRect(x - 80, y - 52, 160, 84, 18); c.fill(); c.stroke();
    // eye
    c.fillStyle = PAL.bad;
    c.shadowColor = PAL.bad; c.shadowBlur = 18;
    c.beginPath(); c.arc(x, y - 10, 16, 0, 7); c.fill();
    c.shadowBlur = 0;
    // package
    c.fillStyle = PAL.humanDeep;
    c.fillRect(x - 26, y + 40, 52, 44);
    c.strokeStyle = "#8a5a1a"; c.strokeRect(x - 26, y + 40, 52, 44);
  }

  phBarrier(c, x) {
    c.fillStyle = "#111A34";
    c.strokeStyle = PAL.machineDim; c.lineWidth = 4;
    c.beginPath(); c.roundRect(x - 20, GROUND - 250, 200, 250, 12); c.fill(); c.stroke();
    const pulse = (Math.sin(performance.now() / 220) + 1) / 2;
    c.fillStyle = `rgba(255,84,112,${0.5 + pulse * 0.4})`;
    c.shadowColor = PAL.bad; c.shadowBlur = 22;
    c.beginPath(); c.arc(x + 80, GROUND - 170, 26, 0, 7); c.fill();
    c.shadowBlur = 0;
    c.fillStyle = "rgba(127,227,255,.2)";
    for (let i = 0; i < 3; i++) c.fillRect(x + 8 + i * 58, GROUND - 110, 34, 80);
  }

  /* ---------- runner ---------- */
  drawRunner(c) {
    const r = this.runner;
    const sheet = this.assets.runner_sheet;
    const x = RUNNER_X, y = r.y;
    // amber afterimages along the vault arc
    if (sheet && r.trail.length > 2) {
      const meta = sheet.meta;
      const fw = meta.frameWidth || 320, fh = meta.frameHeight || 724;
      const fi = Math.max(0, (meta.frames || []).indexOf("jump"));
      for (let i = 0; i < r.trail.length - 1; i += 3) {
        const s = r.trail[i];
        const gx = x - (this.worldX - s.wx);
        c.globalAlpha = 0.05 + (s.t / 0.3) * 0.1;
        const dh = 330, dw = fw * (330 / fh);
        c.drawImage(sheet.img, fi * fw, 0, fw, fh, gx - dw / 2, s.y - dh * 0.92, dw, dh);
      }
      c.globalAlpha = 1;
    }
    if (sheet) {
      const meta = sheet.meta;
      const cols = meta.columns || 8;
      const fw = meta.frameWidth || sheet.img.width / cols;
      const fh = meta.frameHeight || sheet.img.height / (meta.rows || 1);
      const frames = meta.frames || [];
      let fi = 1 + (Math.floor(r.phase) % 4); // run_1..run_4
      if (r.pose === "jump") fi = frames.indexOf("jump");
      else if (r.pose === "hit") fi = frames.indexOf("hit");
      else if (r.pose === "victory") fi = frames.indexOf("victory");
      if (fi < 0) fi = 0;
      // squash on landing, stretch while rising — cheap, reads great
      let sx = 1, sy = 1;
      if (r.landT > 0) { const p = r.landT / 0.16; sy = 1 - 0.12 * p; sx = 1 + 0.1 * p; }
      else if (r.pose === "jump" && r.vy < -200) { sy = 1.06; sx = 0.96; }
      const dh = 330 * sy, dw = fw * (330 / fh) * sx;
      // soft ground shadow + amber rim glow: keeps the hero readable
      // against the dark city until the red-suit regen lands
      c.fillStyle = "rgba(0,0,0,.45)";
      c.beginPath();
      c.ellipse(x, GROUND + 5, 62, 12, 0, 0, 7);
      c.fill();
      c.shadowColor = "rgba(255,180,84,.85)";
      c.shadowBlur = 26;
      c.drawImage(
        sheet.img, fi * fw, 0, fw, fh,
        x - dw * (meta.anchor?.x ?? 0.5), y - dh * (meta.anchor?.y ?? 0.92),
        dw, dh
      );
      c.shadowBlur = 0;
      return;
    }
    // ---- procedural auditor ----
    c.save();
    c.translate(x, y);
    if (r.pose === "hit") c.rotate(-0.35 + Math.sin(r.phase * 3) * 0.06);
    const runP = r.pose === "run" ? Math.sin(r.phase) : 0;
    const runP2 = r.pose === "run" ? Math.sin(r.phase + Math.PI) : 0;
    const bobY = r.pose === "run" ? Math.abs(Math.cos(r.phase)) * -8 : r.pose === "jump" ? -6 : 0;

    c.lineCap = "round";
    // trailing scarf (human amber)
    c.strokeStyle = PAL.humanDeep;
    c.lineWidth = 10;
    c.beginPath();
    c.moveTo(-6, -180 + bobY);
    c.quadraticCurveTo(-60, -170 + bobY + runP * 6, -104, -150 + bobY + Math.sin(r.phase * 1.7) * 14);
    c.stroke();
    // legs
    c.strokeStyle = "#E8A448";
    c.lineWidth = 16;
    const legA = r.pose === "jump" ? { kx: 34, ky: -60, fx: 18, fy: -18 } : { kx: 26 * runP, ky: -52, fx: 44 * runP, fy: runP > 0 ? -6 : -2 };
    const legB = r.pose === "jump" ? { kx: -26, ky: -46, fx: -38, fy: -70 } : { kx: 26 * runP2, ky: -52, fx: 44 * runP2, fy: runP2 > 0 ? -6 : -2 };
    for (const L of [legB, legA]) {
      c.strokeStyle = L === legB ? "#B97F2E" : "#E8A448";
      c.beginPath();
      c.moveTo(0, -96 + bobY);
      c.quadraticCurveTo(L.kx, L.ky + bobY, L.fx, L.fy);
      c.stroke();
    }
    // torso
    const grad = c.createLinearGradient(0, -190, 0, -80);
    grad.addColorStop(0, PAL.human); grad.addColorStop(1, PAL.humanDeep);
    c.fillStyle = grad;
    c.beginPath(); c.roundRect(-26, -186 + bobY, 52, 96, 22); c.fill();
    // arms
    c.strokeStyle = "#FFC575"; c.lineWidth = 13;
    const armSwing = r.pose === "victory" ? -2.4 : runP2 * 0.9;
    c.beginPath();
    c.moveTo(0, -164 + bobY);
    if (r.pose === "victory") { c.lineTo(26, -216 + bobY); c.lineTo(34, -262 + bobY); }
    else { c.quadraticCurveTo(30, -150 + bobY + armSwing * 12, 46, -128 + bobY + armSwing * 26); }
    c.stroke();
    // head + visor
    c.fillStyle = "#1A1105";
    c.beginPath(); c.arc(6, -216 + bobY, 26, 0, 7); c.fill();
    c.fillStyle = PAL.machine;
    c.shadowColor = PAL.machine; c.shadowBlur = 12;
    c.beginPath(); c.roundRect(6, -226 + bobY, 26, 12, 6); c.fill();
    c.shadowBlur = 0;
    // speed lines
    if (r.pose === "run" && this.ts > 0.5) {
      c.strokeStyle = "rgba(255,180,84,.25)"; c.lineWidth = 4;
      for (let i = 0; i < 3; i++) {
        c.beginPath();
        c.moveTo(-46 - i * 26, -140 + i * 34 + bobY);
        c.lineTo(-96 - i * 34, -140 + i * 34 + bobY);
        c.stroke();
      }
    }
    c.restore();
  }

  /* AXIOM companion core — hovers ahead, taunts */
  drawCompanion(c) {
    const t = performance.now() / 1000;
    const x = RUNNER_X + 430 + Math.sin(t * 0.9) * 18;
    const y = 300 + Math.sin(t * 1.4) * 22;
    // core
    c.fillStyle = "#0D1830";
    c.strokeStyle = PAL.machine; c.lineWidth = 3;
    c.beginPath(); c.arc(x, y, 34, 0, 7); c.fill(); c.stroke();
    const pulse = (Math.sin(t * 3) + 1) / 2;
    c.fillStyle = PAL.machine;
    c.shadowColor = PAL.machine; c.shadowBlur = 20 + pulse * 14;
    c.beginPath(); c.arc(x, y, 12 + pulse * 3, 0, 7); c.fill();
    c.shadowBlur = 0;
    // orbit ring
    c.strokeStyle = "rgba(127,227,255,.35)";
    c.lineWidth = 2;
    c.beginPath(); c.ellipse(x, y, 52, 16, -0.4, 0, 7); c.stroke();
    // speech bubble
    if (this.bubble) {
      c.font = "500 22px 'IBM Plex Mono', monospace";
      const text = this.bubble.text;
      const wTxt = Math.min(560, c.measureText(text).width + 40);
      const bx = x - wTxt - 30, by = y - 26;
      c.globalAlpha = Math.min(1, this.bubble.t * 2);
      c.fillStyle = "rgba(13,24,48,.92)";
      c.strokeStyle = PAL.machineDim;
      c.beginPath(); c.roundRect(bx, by - 26, wTxt, 62, 12); c.fill(); c.stroke();
      c.fillStyle = "#9BC8DD";
      c.textAlign = "left";
      c.fillText(text, bx + 20, by + 12, wTxt - 40);
      c.globalAlpha = 1;
    }
  }

  drawTower(c) {
    const x = this.finaleX - this.worldX + 240;
    if (x > W + 900) return;
    const sheet = this.assets.finale_tower;
    if (sheet) {
      const h = 760, w = sheet.img.width * (h / sheet.img.height);
      c.drawImage(sheet.img, x - w / 2, GROUND - h, w, h);
    } else {
      // AXIOM control tower
      c.fillStyle = "#0F1730";
      c.strokeStyle = PAL.machineDim; c.lineWidth = 4;
      c.beginPath(); c.roundRect(x - 130, GROUND - 640, 260, 640, 14); c.fill(); c.stroke();
      c.beginPath(); c.roundRect(x - 170, GROUND - 700, 340, 80, 14); c.fill(); c.stroke();
      c.fillStyle = "rgba(127,227,255,.12)";
      for (let i = 0; i < 6; i++) c.fillRect(x - 100, GROUND - 600 + i * 92, 200, 40);
      const pulse = (Math.sin(performance.now() / 500) + 1) / 2;
      c.fillStyle = PAL.machine;
      c.shadowColor = PAL.machine; c.shadowBlur = 20 + pulse * 16;
      c.beginPath(); c.arc(x, GROUND - 660, 26, 0, 7); c.fill();
      c.shadowBlur = 0;
    }
    // flag pole at the pole position (runner stops at finaleX)
    const px = this.finaleX - this.worldX;
    c.strokeStyle = "#8B94B8"; c.lineWidth = 8; c.lineCap = "round";
    c.beginPath(); c.moveTo(px, GROUND); c.lineTo(px, GROUND - 420); c.stroke();
    c.fillStyle = PAL.human;
    c.beginPath(); c.arc(px, GROUND - 426, 10, 0, 7); c.fill();
    // the hoisted human flag
    const fT = this.flagT;
    if (fT > 0) {
      const fy = GROUND - 60 - (340 * Math.min(1, fT));
      const wave = Math.sin(performance.now() / 180) * 8;
      const sheetF = this.assets.human_flag;
      if (sheetF) {
        // fabric-first art on the canvas-drawn pole (per bridge notes)
        const h = 132, w = sheetF.img.width * (h / sheetF.img.height);
        c.drawImage(sheetF.img, px + 4, fy - h, w, h);
      } else {
        c.fillStyle = PAL.human;
        c.shadowColor = PAL.human; c.shadowBlur = 18;
        c.beginPath();
        c.moveTo(px + 4, fy - 100);
        c.quadraticCurveTo(px + 90, fy - 92 + wave, px + 170, fy - 100 + wave);
        c.lineTo(px + 170, fy - 10 + wave);
        c.quadraticCurveTo(px + 90, fy - 2 + wave, px + 4, fy - 10);
        c.closePath(); c.fill();
        c.shadowBlur = 0;
        // human glyph on the flag
        c.fillStyle = "#1A1105";
        c.font = "700 44px 'Chakra Petch', sans-serif";
        c.textAlign = "center";
        c.fillText("H", px + 88, fy - 38 + wave);
      }
    }
  }
}

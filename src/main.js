/* ============================================================
   HUMAN EDGE RUNNER — UI orchestration
   Engine owns the world; this file owns screens, question
   cards, timers, scoring (HEI), hearts and the results flow.
   ============================================================ */

import "./style.css";
import { Engine } from "./game/engine.js";
import { SFX, setMuted, isMuted } from "./game/audio.js";
import { ROUND, RANKS, AX, rnd } from "./content/round1.js";

const app = document.getElementById("app");
app.innerHTML = `
  <canvas id="cv"></canvas>
  <div id="hud" class="hidden">
    <div class="hud-left">
      <div class="hud-label">H.E.I.</div>
      <div class="hud-hei" id="hei">0</div>
      <div class="hud-bar"><div id="heibar"></div></div>
    </div>
    <div class="hud-pips" id="pips"></div>
    <div class="hud-right">
      <div id="hearts"></div>
      <button id="mute" class="iconbtn" aria-label="Mute">&#128266;</button>
    </div>
  </div>

  <div id="qwrap" class="hidden">
    <div id="qcard">
      <div class="q-top">
        <span class="q-eyebrow" id="qeyebrow">INCOMING</span>
        <div class="q-timer"><svg width="46" height="46"><circle cx="23" cy="23" r="19" class="tbg"/><circle cx="23" cy="23" r="19" id="tring"/></svg><span id="tnum">20</span></div>
      </div>
      <div class="q-setting" id="qsetting"></div>
      <div class="q-claim" id="qclaim"></div>
      <div class="q-actions" id="qactions"></div>
    </div>
  </div>

  <div id="flash" class="hidden"></div>
  <div id="stamp"></div>

  <div id="screen-title" class="screen">
    <div class="t-eyebrow">AUDIT PROTOCOL &middot; YOU vs AXIOM</div>
    <h1>HUMAN <span class="amber">EDGE</span> RUNNER</h1>
    <div class="t-sub">${ROUND.name} &middot; ${ROUND.subtitle}</div>
    <p class="t-body">AXIOM runs this city on confident nonsense. Run its gauntlet —
      every checkpoint asks one question. Answer right: you clear it clean.
      Answer wrong: you eat the obstacle. <span class="amber">Three hearts. One flag.</span></p>
    <button id="btn-start" class="btn-solid">START THE RUN</button>
    <div class="t-hint">every point of your Human Edge Index is on the track</div>
  </div>

  <div id="screen-dead" class="screen hidden">
    <div class="t-eyebrow">RUN TERMINATED</div>
    <h2 class="dead-title">AXIOM WINS</h2>
    <p class="t-body" id="dead-line"></p>
    <div class="dead-hei">H.E.I. BANKED: <span id="dead-hei" class="amber">0</span></div>
    <button id="btn-retry" class="btn-solid">REMATCH</button>
  </div>

  <div id="screen-results" class="screen hidden">
    <div class="t-eyebrow">SECTOR CLEARED &middot; ${ROUND.name}</div>
    <h2 class="r-title">HUMAN EDGE INDEX</h2>
    <div class="r-hei" id="r-hei">0</div>
    <div class="r-rank amber" id="r-rank"></div>
    <p class="r-sub" id="r-sub"></p>
    <div class="r-recap" id="r-recap"></div>
    <p class="axline" id="r-ax"></p>
    <button id="btn-again" class="btn-solid">RUN IT AGAIN</button>
  </div>
`;

const $ = (id) => document.getElementById(id);
const cv = $("cv");

/* ---------- state ---------- */
let hei = 0;
let recap = [];          // {title, pts, max}
let qTimer = null;       // {left,total,int}
let currentEv = null;
let qPhase = null;       // 'main' | 'locked'

const engine = new Engine(cv, ROUND, {
  onQuestion: showQuestion,
  onImpact: (hearts) => { renderHearts(hearts); flashScreen(); },
  onCleared: () => renderPips(),
  onFinale: showResultsSoon,
  onDead: showDead,
});

/* ---------- HUD ---------- */
function renderHearts(n = engine.hearts) {
  $("hearts").innerHTML = Array.from({ length: 3 }, (_, i) =>
    `<span class="heart ${i < n ? "on" : "off"}">&#10084;</span>`).join("");
}
function renderPips() {
  $("pips").innerHTML = ROUND.events.map((_, i) =>
    `<span class="pip ${i < engine.eventIdx ? "on" : i === engine.eventIdx ? "now" : ""}"></span>`).join("");
}
function setHei(v) {
  hei = v;
  $("hei").textContent = v;
  $("heibar").style.width = `${v}%`;
}
function flashScreen() {
  const f = $("flash");
  f.classList.remove("hidden");
  f.classList.remove("go");
  void f.offsetWidth;
  f.classList.add("go");
  setTimeout(() => f.classList.add("hidden"), 500);
}

/* ---------- question flow ---------- */
function showQuestion(ev) {
  currentEv = ev;
  qPhase = "main";
  $("qeyebrow").textContent = ev.kind === "snap" ? "SNAP CALL — SECONDS ON THE CLOCK" : `CHECKPOINT ${engine.eventIdx + 1} / ${ROUND.events.length}`;
  $("qsetting").textContent = ev.setting;
  renderQuestionBody(ev);
  $("qwrap").classList.remove("hidden");
  $("qcard").classList.remove("out");
  startQTimer(ev.timer, () => answerTimeout());
}

function renderQuestionBody(ev) {
  const claim = $("qclaim"), actions = $("qactions");
  actions.classList.remove("locked");
  if (ev.kind === "verdict" || ev.kind === "verdict-sound") {
    claim.textContent = ev.claim;
    claim.classList.remove("hidden");
    actions.innerHTML = `
      <button class="btn-cyan" data-a="sound">SOUND</button>
      <button class="btn-amber" data-a="flawed">FLAWED</button>`;
    actions.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => verdictAnswer(b.dataset.a, b)));
  } else if (ev.kind === "tapline") {
    claim.textContent = "";
    claim.classList.add("hidden");
    actions.innerHTML = ev.lines.map((ln, i) =>
      `<button class="rowline" data-i="${i}"><span class="idx">0${i + 1}</span>${ln}</button>`).join("");
    actions.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => taplineAnswer(+b.dataset.i, b)));
  } else if (ev.kind === "snap") {
    claim.innerHTML = `<span class="ax-says">AXIOM: &ldquo;${ev.axiomSays}&rdquo;</span>`;
    claim.classList.remove("hidden");
    actions.innerHTML = `
      <button class="btn-cyan" data-a="right">RIGHT CALL</button>
      <button class="btn-amber" data-a="wrong">WRONG CALL</button>`;
    actions.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => snapAnswer(b.dataset.a === "right", b)));
  }
}

function startQTimer(secs, onExpire) {
  stopQTimer();
  const ring = $("tring"), num = $("tnum");
  const C = 2 * Math.PI * 19;
  ring.style.strokeDasharray = C;
  let left = secs;
  const tick = () => {
    left = Math.max(0, left - 0.1);
    num.textContent = Math.ceil(left);
    ring.style.strokeDashoffset = C * (1 - left / secs);
    ring.classList.toggle("urgent", left / secs < 0.3);
    num.classList.toggle("urgent", left / secs < 0.3);
    if (left <= 3.05 && left > 0 && Math.abs(left - Math.round(left)) < 0.06) SFX.tick();
    if (left <= 0) { stopQTimer(); onExpire(); }
  };
  qTimer = { int: setInterval(tick, 100), get left() { return left; }, total: secs };
  tick();
}
function stopQTimer() { if (qTimer) { clearInterval(qTimer.int); qTimer = null; } }
function speedBonus(max) {
  if (!qTimer) return 0;
  return Math.max(0, Math.min(max, Math.round(max * (qTimer.left / qTimer.total))));
}

function closeQuestion() {
  stopQTimer();
  $("qcard").classList.add("out");
  setTimeout(() => $("qwrap").classList.add("hidden"), 380);
}

/* result plumbing shared by all kinds.
   Beat: freeze timer → picked button flashes → big stamp + sound →
   500ms later the card drops and the world plays it out. */
function finishEvent({ right, pts, axLine, toast, btn }) {
  stopQTimer(); // speed bonuses were computed by the caller before this
  recap.push({ title: currentEv.setting, pts, max: currentEv.max, right });
  qPhase = "locked";
  if (btn) btn.classList.add(right ? "picked-right" : "picked-wrong");
  $("qactions").classList.add("locked");
  showStamp(right);
  SFX[right ? "correct" : "wrongBuzz"]();
  setTimeout(() => {
    closeQuestion();
    setTimeout(() => setHei(hei + pts), right ? 750 : 350);
    engine.say(axLine, 3.4);
    if (toast) showToast(toast, right);
    engine.resolve({ right, points: pts });
  }, 550);
}

function showStamp(right) {
  const s = $("stamp");
  s.textContent = right ? "CORRECT" : "WRONG";
  s.className = right ? "right" : "wrong";
  void s.offsetWidth;
  s.classList.add("show");
}

/* ---------- verdict: one tap, SOUND or FLAWED, nothing else ---------- */
function verdictAnswer(a, btn) {
  if (qPhase !== "main") return;
  SFX.click();
  const ev = currentEv;
  const sp = speedBonus(ev.score.speed);
  if (ev.flawed && a === "flawed") {
    finishEvent({ right: true, pts: ev.score.call + sp, axLine: rnd(AX.caught), toast: { title: "CAUGHT", body: `${ev.fallacy} — ${ev.explain}` }, btn });
  } else if (ev.flawed && a === "sound") {
    finishEvent({ right: false, pts: 0, axLine: rnd(AX.missed), toast: { title: "MISSED", body: `${ev.fallacy} — ${ev.explain}` }, btn });
  } else if (!ev.flawed && a === "sound") {
    finishEvent({ right: true, pts: ev.score.call + sp, axLine: rnd(AX.soundOk), toast: { title: "GOOD CALL", body: ev.explain }, btn });
  } else {
    finishEvent({ right: false, pts: 0, axLine: rnd(AX.paranoid), toast: { title: "FALSE ALARM", body: ev.explain }, btn });
  }
}

/* ---------- tapline ---------- */
function taplineAnswer(i, btn) {
  if (qPhase !== "main") return;
  SFX.click();
  const ev = currentEv;
  if (i === ev.flaw) {
    const sp = speedBonus(ev.score.speed);
    finishEvent({ right: true, pts: ev.score.call + sp, axLine: rnd(AX.caught), toast: { title: "CAUGHT", body: `${ev.fallacy} — ${ev.explain}` }, btn });
  } else {
    finishEvent({ right: false, pts: 0, axLine: rnd(AX.missed), toast: { title: "MISSED", body: `${ev.fallacy} — ${ev.explain}` }, btn });
  }
}

/* ---------- snap ---------- */
function snapAnswer(sayRight, btn) {
  if (qPhase !== "main") return;
  SFX.click();
  const ev = currentEv;
  const ok = sayRight === ev.rightCall;
  if (ok) {
    const sp = speedBonus(ev.score.speed);
    finishEvent({ right: true, pts: ev.score.call + sp, axLine: rnd(AX.caught), toast: { title: "GOOD JUDGMENT", body: ev.why }, btn });
  } else {
    finishEvent({ right: false, pts: 0, axLine: rnd(AX.missed), toast: { title: "NOT QUITE", body: ev.why }, btn });
  }
}

function answerTimeout() {
  const ev = currentEv;
  finishEvent({
    right: false, pts: 0, axLine: rnd(AX.missed),
    toast: { title: "TIME EXPIRED", body: ev.explain || ev.why || "The machine never hesitates. That was the whole test." },
  });
}

/* ---------- toast (post-answer explanation, world keeps moving) ---------- */
let toastTimeout = null;
function showToast({ title, body }, right) {
  let t = $("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    app.appendChild(t);
  }
  t.className = right ? "right" : "wrong";
  t.innerHTML = `<strong>${title}</strong><span>${body}</span>`;
  t.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => t.classList.remove("show"), 4200);
}

/* ---------- screens ---------- */
function startRun() {
  SFX.click();
  hei = 0; recap = [];
  setHei(0);
  $("screen-title").classList.add("hidden");
  $("screen-dead").classList.add("hidden");
  $("screen-results").classList.add("hidden");
  $("hud").classList.remove("hidden");
  renderHearts(3);
  engine.start();
  renderPips();
  setTimeout(() => engine.say(rnd(AX.taunts), 3.5), 900);
}

function showDead() {
  stopQTimer();
  $("qwrap").classList.add("hidden");
  setTimeout(() => {
    $("dead-line").textContent = rnd(AX.dead);
    $("dead-hei").textContent = hei;
    $("hud").classList.add("hidden");
    $("screen-dead").classList.remove("hidden");
  }, 1200);
}

function showResultsSoon() {
  setTimeout(showResults, 2200);
}

function showResults() {
  engine.finishDone();
  $("hud").classList.add("hidden");
  const rank = RANKS.find((r) => hei >= r.min) || RANKS[RANKS.length - 1];
  $("r-rank").textContent = rank.name;
  $("r-sub").textContent = rank.sub;
  $("r-recap").innerHTML = recap.map((r) => `
    <div class="recap-row">
      <span class="recap-mark ${r.right ? "ok" : "no"}">${r.right ? "&#10003;" : "&#10005;"}</span>
      <span class="recap-title">${r.title}</span>
      <span class="recap-pts">${r.pts}/${r.max}</span>
    </div>`).join("");
  $("r-ax").textContent = `AXIOM: “${rnd(AX.flag)}”`;
  $("screen-results").classList.remove("hidden");
  // count-up (interval-driven: rAF stalls in backgrounded tabs)
  const target = hei;
  const t0 = performance.now();
  const counter = setInterval(() => {
    const p = Math.min(1, (performance.now() - t0) / 1500);
    $("r-hei").textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
    if (p >= 1) clearInterval(counter);
  }, 33);
  if (hei >= 70) SFX.big();
}

/* ---------- wiring ---------- */
$("btn-start").addEventListener("click", startRun);
$("btn-retry").addEventListener("click", startRun);
$("btn-again").addEventListener("click", startRun);
$("mute").addEventListener("click", () => {
  setMuted(!isMuted());
  $("mute").innerHTML = isMuted() ? "&#128263;" : "&#128266;";
});

engine.loadAssets();
window.__engine = engine; // debug handle (harmless in prod; remove before deploy)

import "./style.css";
import { AudioEngine } from "./audio.js";
import { telemetry } from "./telemetry.js";
import { renderShareCard, shareCard, canvasToBlob, prepareShare, takePrepared, clearPrepared } from "./share.js";
import { haptics } from "./haptics.js";
import { TALL_SCENES } from "./tallScenes.js";
import {
  PROFILES,
  QUESTION_BANK,
  SECTIONS,
  TOTAL_SCENARIOS,
  TRAITS,
  WARMUP_QUESTION_ID,
} from "./questions.js";

const app = document.getElementById("app");
const audio = new AudioEngine();
const ASSET_VERSION = "20260721-characters-v1";
const POINTS_PER_QUESTION = 5;

// How many questions this section serves. Lives on the section now (4/4/2/2 = 12
// per run) instead of a global 5. Every call site must go through this helper —
// the pilot build computed the score denominator in four separate places.
const questionsInSection = (index = state.sectionIndex) => SECTIONS[index].count;
const questionsPerRun = () => SECTIONS.reduce((sum, s) => sum + s.count, 0);

// THE single source of truth for the HEI denominator. Nothing else may compute it.
// The pilot build computed this in four separate places (addSectionPoints,
// reportRunComplete, renderResults, totalScore) and none of them agreed.
const runMaxPoints = () => questionsPerRun() * POINTS_PER_QUESTION;

// Scoring v2: no floor. The index is purely what you earned, 0-100.
// v1 floored at 40 so finishers never saw a demoralising number, but it made the
// scale impossible to explain ("why does it start at 40?") and the first 40 points
// meant nothing. SCORING_VERSION is stamped on every run so the percentile only
// compares like with like — v1 and v2 are not the same scale.
const SCORING_VERSION = 2;
const HEI_FLOOR = 0;
const HEI_EARNED = 100;
function humanEdgeIndex(earned = totalScore(), max = runMaxPoints()) {
  if (!max) return HEI_FLOOR;
  const raw = HEI_FLOOR + HEI_EARNED * clamp(earned / max, 0, 1);
  // Each tier caps out differently, so an 80 on TRAINING WHEELS can't read the
  // same as an 80 on IMPOSSIBLE. The badge on the share card names the tier.
  return Math.round(Math.min(raw, tier().ceiling));
}

// ---------- DIFFICULTY TIERS ----------
// AXIOM grades ITSELF and dares you — we never label the player "dumb" at the door.
// Question pools come from ability-controlled residuals on the 216-session pilot,
// NOT the authored `difficulty` field (which is inverted). Everyone still plays the
// same pinned warm-up first, whatever they pick — ragebait makes people choose up,
// and the pilot showed a cold hard opener is what killed half the audience.
const TIERS = [
  {
    id: "training", label: "TRAINING WHEELS", plain: "EASY",
    taunt: "I made this one gentle. Most of your species needs it.",
    note: "",
    timeScale: 1.4, ceiling: 70,
  },
  {
    id: "baseline", label: "BASELINE", plain: "MEDIUM",
    taunt: "This is what I consider basic. You will struggle.",
    note: "",
    timeScale: 1, ceiling: 85,
  },
  {
    id: "impossible", label: "IMPOSSIBLE", plain: "HARD",
    taunt: "No human has cleared this. I have checked. Repeatedly.",
    note: "",
    timeScale: 0.75, ceiling: 100,
  },
];
const tier = () => TIERS.find((t) => t.id === state.tier) || TIERS[1];

// Hardest questions by ability-controlled residual — the IMPOSSIBLE pool, and the
// same set that earns the cracked-the-machine badge.
const HARDEST_QIDS = new Set([
  "ethics-bias", "counter-elevator", "counter-checkout", "counter-shy-student",
  "counter-delivery-eta", "blind-festival-stock", "logic-scale", "counter-nurse",
]);
// Kindest questions by residual, n>=25 only.
const EASIEST_QIDS = new Set([
  "snap-traffic", "ethics-fairness", "strategy-goodhart", "logic-survivorship",
  "logic-ab-test", "snap-review", "snap-pizzas", "snap-candy", "snap-grandpa",
  "strategy-price-test", "counter-gym", "counter-password", "blind-flood",
]);
function inTier(q) {
  if (state.tier === "impossible") return HARDEST_QIDS.has(q.id);
  if (state.tier === "training") return EASIEST_QIDS.has(q.id);
  return !HARDEST_QIDS.has(q.id);          // baseline = everything except the brutal set
}

// Badge art tier. Same bands as the label below.
function heiBadge(value) {
  if (value >= 70) return "hei-diamond";
  if (value >= 50) return "hei-titanium";
  if (value >= 30) return "hei-gold";
  return "hei-clay";
}

// "Cracked the machine" — correct calls on the hardest questions in the bank.
function crackedCount() {
  return state.answers ? state.answers.filter((a) => a.correct && HARDEST_QIDS.has(a.qid)).length : 0;
}

// Prints beside the number so it reads as a tier, not a school grade.
function heiBand(value) {
  if (value >= 70) return "RARE AIR";
  if (value >= 50) return "SHARP";
  if (value >= 30) return "SOLID READ";
  return "WARMING UP";
}

// Question 1 of the run is a pinned, unloseable practice call: no clock, no score
// chrome, teaching-tone feedback. Pilot: players who scored 5 on Q1 continued at
// 93%, players who scored 0 continued at 68%. 47 people quit after exactly one answer.
const isWarmup = () => state.sectionIndex === 0 && state.questionIndex === 0;
let spotScenesPreloaded = false;

const state = {
  screen: "welcome",
  phase: "idle",
  sectionIndex: 0,
  questionIndex: 0,
  current: null,
  records: [],
  evidence: [],
  answers: [],   // local per-run log, powers the cracked-the-machine award
  tier: "baseline",
  used: new Set(),
  lastArena: null,
  pendingVerdict: null,
  snap: null,
  feedback: null,
  answerText: "",
  muted: false,
  timerId: 0,
  timeLeft: 0,
  timerTotal: 0,
  questionStartedAt: 0,
  locked: false,
  trackOpenedAt: 0,
  timedOut: false,
  timerPaused: false,
  timerRemaining: 0,
  interrupted: false,     // answered after a tab-switch pause — flagged for telemetry
  gateError: "",
};

// Pilot identity. Kept in sessionStorage so a mid-run refresh doesn't ask twice
// and doesn't split one player into two sessions in the dashboard.
const IDENTITY_KEY = "atlas-pilot-identity";

// Nothing carries over. Every visit is a new player and a new run — no remembered
// name, no skipped gate, no stale contact details.
const identity = { name: "", phone: "", email: "", captured: false };
try { sessionStorage.removeItem(IDENTITY_KEY); } catch { /* private mode */ }

function saveIdentity() {
  // Deliberately a no-op — identity lives only for this page load.
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const section = () => SECTIONS[state.sectionIndex];
const totalScore = () => state.records.reduce((sum, item) => sum + item.points, 0);

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

// ADAPTIVE DIFFICULTY IS GONE — deliberately. The old engine ranked questions by
// |authored difficulty − player skill| and dropped skill 0.9 on every miss. But the
// authored `difficulty` field correlates POSITIVELY with real accuracy (Spearman
// +0.36 across 32 questions, n>=8): questions marked "easy" were the hardest in the
// bank (counter-gym and counter-password are both authored 2 and scored 4%). So every
// miss confidently pushed the player toward harder content. 98 of 216 pilot sessions
// hit the difficulty floor by question 3. Explicit tiers replace this. If adaptive
// difficulty ever returns it must run on observed accuracy, never on hand ratings.
function chooseQuestion(sectionId) {
  // Question 1 of the run is always the pinned warm-up.
  if (isWarmup()) {
    const warm = QUESTION_BANK[sectionId].find((item) => item.id === WARMUP_QUESTION_ID);
    if (warm) {
      state.used.add(warm.id);
      state.lastArena = warm.arena;
      return warm;
    }
  }

  let candidates = QUESTION_BANK[sectionId].filter((item) => !state.used.has(item.id) && inTier(item));
  if (!candidates.length) candidates = QUESTION_BANK[sectionId].filter((item) => !state.used.has(item.id));
  if (!candidates.length) {
    QUESTION_BANK[sectionId].forEach((item) => state.used.delete(item.id));
    candidates = [...QUESTION_BANK[sectionId]];
  }

  // Prefer a different arena than the last question so the run feels varied,
  // then pick at random. Even coverage matters: four questions in the pilot bank
  // were shown to fewer than five people each because the old ranking starved them.
  const fresh = candidates.filter((item) => item.arena !== state.lastArena);
  const pool = fresh.length ? fresh : candidates;
  const selected = pool[Math.floor(Math.random() * pool.length)];
  state.used.add(selected.id);
  state.lastArena = selected.arena;
  return selected;
}

function timeRatio() {
  return state.timerTotal ? clamp(state.timeLeft / state.timerTotal, 0, 1) : 0;
}

function clearTimer() {
  window.clearInterval(state.timerId);
  state.timerId = 0;
  state.timerPaused = false;
}


function updateTimerChrome() {
  const number = document.getElementById("timer-number");
  const fill = document.getElementById("timer-fill");
  const timer = document.getElementById("timer");
  const ratio = state.timerTotal ? state.timeLeft / state.timerTotal : 0;
  if (number) number.textContent = String(Math.ceil(state.timeLeft)).padStart(2, "0");
  if (fill) fill.style.transform = `scaleX(${clamp(ratio, 0, 1)})`;
  timer?.classList.toggle("urgent", ratio < 0.25);
}

/* The clock is wall-clock based, and browsers throttle background-tab intervals to
   about once a minute. Without this, switching tabs mid-question burned the whole
   timer and the answer auto-failed on return. Pause on hide, resume on show. */
function pauseTimerForHide() {
  if (!state.timerId || state.locked) return;
  const elapsed = (performance.now() - state.questionStartedAt) / 1000;
  state.timerRemaining = Math.max(0, state.timerTotal - elapsed);
  window.clearInterval(state.timerId);
  state.timerId = 0;
  state.timerPaused = true;
  state.interrupted = true;
}

function resumeTimerAfterHide() {
  if (!state.timerPaused) return;
  state.timerPaused = false;
  if (state.timerRemaining > 0 && !state.locked) startTimer(state.timerRemaining, state.timerTotal);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseTimerForHide();
    else resumeTimerAfterHide();
  });
}

function startTimer(seconds, total = seconds) {
  clearTimer();
  state.timerTotal = total;                    // full question length, never the remainder
  state.timeLeft = seconds;
  // back-date the origin so the wall-clock maths still yields exactly `seconds` left
  state.questionStartedAt = performance.now() - (total - seconds) * 1000;
  updateTimerChrome();
  state.timerId = window.setInterval(() => {
    const elapsed = (performance.now() - state.questionStartedAt) / 1000;
    const prev = state.timeLeft;
    state.timeLeft = Math.max(0, state.timerTotal - elapsed);
    updateTimerChrome();
    // clock tick only in the final 3 seconds, once per second
    if (state.timeLeft > 0 && state.timeLeft <= 3 && Math.ceil(prev) !== Math.ceil(state.timeLeft)) { audio.tick(); haptics.fire("tick"); }
    if (state.timeLeft <= 0) {
      clearTimer();
      handleTimeout();
    }
  }, 100);
}

function addEvidence(question, points, max) {
  state.evidence.push({
    ratio: max ? points / max : 0,
    weights: question.weights,
  });
}

function addSectionPoints(id, points) {
  const existing = state.records.find((item) => item.id === id);
  if (existing) {
    existing.points += Math.round(points);
    return;
  }
  const idx = SECTIONS.findIndex((sec) => sec.id === id);
  state.records.push({ id, points: Math.round(points), max: questionsInSection(idx >= 0 ? idx : 0) * POINTS_PER_QUESTION });
}

function resetRun() {
  clearTimer();
  clearPrepared();          // never share the previous run's card
  state.sectionIndex = 0;
  state.questionIndex = 0;
  state.current = null;
  state.records = [];
  state.evidence = [];
  state.answers = [];
  state.used = new Set();
  state.lastArena = null;
  state.pendingVerdict = null;
  state.snap = null;
  state.feedback = null;
  state.answerText = "";
  state.locked = false;
}

function startSection(index) {
  clearTimer();
  state.screen = "game";
  state.sectionIndex = index;
  state.questionIndex = 0;
  state.phase = "section-intro";
  state.current = null;
  state.feedback = null;
  state.pendingVerdict = null;
  state.answerText = "";
  state.locked = false;
  state.snap = section().id === "snap" ? { answers: [] } : null;
  telemetry.push("section_start", {
    sectionIndex: index,
    sectionId: section().id,
    sectionTitle: section().title,
    label: `Section ${index + 1}: ${section().title}`,
  });
  render();
}


/* The next question's art is fetched while the player is still on this one, so
   the staged reveal never waits on the network. On a phone connection the
   scene was the only thing that could stall the sequence. */
function preloadNextScene() {
  try {
    const sec = SECTIONS[state.sectionIndex];
    const nextIdx = state.questionIndex + 1;
    const pool = QUESTION_BANK[sec.id] || [];
    const upcoming = nextIdx < sec.count
      ? pool.filter((q) => !state.used.has(q.id))
      : (QUESTION_BANK[SECTIONS[state.sectionIndex + 1]?.id] || []);
    upcoming.slice(0, 2).forEach((q) => {
      if (!q?.image) return;
      const img = new Image();
      img.decoding = "async";
      img.src = `${q.image}?v=${ASSET_VERSION}`;
    });
  } catch { /* purely an optimisation */ }
}

function loadQuestion() {
  state.phase = "question";
  state.current = chooseQuestion(section().id);
  state.answerText = "";
  state.pendingVerdict = null;
  state.feedback = null;
  state.locked = false;
  state.timedOut = false;
  // Measured from when the question appears, so a two-step Spot the Flaw answer
  // reports the whole time on the question rather than just the flaw pick.
  state.trackOpenedAt = performance.now();
  telemetry.push("question_start", {
    sectionIndex: state.sectionIndex,
    sectionId: section().id,
    sectionTitle: section().title,
    questionIndex: state.questionIndex,
    qid: state.current.id,
    label: `Q${state.questionIndex + 1} · ${state.current.title}`,
  });
  render();
  // No clock on the warm-up. The pilot's Q1 was a timed cold open and 59% of
  // players scored zero on it; a zero on Q1 cut continuation from 93% to 68%.
  // The clock waits for the staged reveal — otherwise the intro animation
  // silently costs the player seconds they never got to use.
  const beginClock = () => { if (!isWarmup()) startTimer(Math.round(section().time * tier().timeScale)); };
  preloadNextScene();
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => runStagedReveal(beginClock));
  else beginClock();
}

function trackAnswer(question, points, correct) {
  state.answers.push({ qid: question.id, correct, points });
  telemetry.push("question_answer", {
    qid: question?.id || "",
    title: question?.title || "",
    sectionIndex: state.sectionIndex,
    sectionId: section().id,
    sectionTitle: section().title,
    questionIndex: state.questionIndex,
    correct,
    points,
    max: POINTS_PER_QUESTION,
    ms: state.trackOpenedAt ? Math.round(performance.now() - state.trackOpenedAt) : 0,
    timedOut: state.timedOut,
    difficulty: question.difficulty,
  });
}

function finishQuestion(points, correct, explanation, label = "") {
  if (state.locked) return;
  state.locked = true;
  const q = state.current;
  const ratio = points / POINTS_PER_QUESTION;
  addEvidence(q, points, POINTS_PER_QUESTION);
  addSectionPoints(section().id, points);
  trackAnswer(q, points, correct);
  clearTimer();
  const finalQuestion = state.questionIndex === questionsInSection() - 1;
  state.feedback = {
    success: correct,
    points,
    max: POINTS_PER_QUESTION,
    title: correct ? "HUMAN EDGE FOUND" : points ? "PARTIAL READ" : "AXIOM GOT THROUGH",
    label,
    explanation,
    action: finalQuestion
      ? state.sectionIndex === SECTIONS.length - 1 ? "results" : "section"
      : "question",
  };
  state.phase = "feedback";
  render();
  audio.reveal(); haptics.fire("reveal");
  window.setTimeout(() => {
    if (correct) { audio.success(); haptics.fire("correct"); }
    else { audio.failure(); haptics.fire("wrong"); }
  }, 140);
}

function answerVerdict(choice) {
  if (state.phase !== "question" || state.locked) return;
  const q = state.current;
  if (choice !== q.correct) {
    finishQuestion(0, false, q.explanation, q.fallacy);
    return;
  }
  if (q.correct === "sound") {
    finishQuestion(POINTS_PER_QUESTION, true, q.explanation, q.fallacy);
    return;
  }
  state.pendingVerdict = { choice, timeRatio: timeRatio() };
  state.phase = "flawpick";
  clearTimer();
  render();
  startTimer(14);
}

function answerFlaw(index) {
  if (state.phase !== "flawpick" || state.locked) return;
  const q = state.current;
  const right = index === q.flawCorrect;
  finishQuestion(right ? POINTS_PER_QUESTION : 3, right, q.explanation, q.fallacy);
}

function answerSequence(index) {
  if (state.phase !== "question" || state.locked) return;
  const q = state.current;
  const right = index === q.lineCorrect;
  finishQuestion(right ? POINTS_PER_QUESTION : 0, right, q.explanation, q.fallacy);
}

function answerSnap(choice) {
  if (state.phase !== "question" || state.locked) return;
  state.locked = true;
  const q = state.current;
  const right = choice === q.correct;
  const points = right ? POINTS_PER_QUESTION : 0;
  clearTimer();
  addEvidence(q, points, POINTS_PER_QUESTION);
  addSectionPoints(section().id, points);
  trackAnswer(q, points, right);
  state.snap.answers.push({ title: q.title, right, points });
  const finalQuestion = state.questionIndex === questionsInSection() - 1;
  state.feedback = {
    success: right,
    points,
    max: POINTS_PER_QUESTION,
    title: choice === null ? "FROZEN" : right ? "GOOD JUDGMENT" : "NOT QUITE",
    label: q.correct ? "RIGHT CALL" : "WRONG CALL",
    explanation: q.explanation,
    action: finalQuestion ? "section" : "question",
  };
  state.phase = "feedback";
  render();
  if (right) { audio.success(); haptics.fire("correct"); } else { audio.failure(); haptics.fire("wrong"); }
}

function answerOption(index) {
  if (state.phase !== "question" || state.locked) return;
  const q = state.current;
  const choice = q.options[index];
  if (!choice) return;
  const label = choice.points === 5 ? "THE REAL FIX"
    : choice.points > 0 ? "TREATS THE SYMPTOM"
    : "THAT MAKES IT WORSE";
  finishQuestion(choice.points, choice.points === 5, q.explanation, label);
}

function answerTile(index) {
  if (state.phase !== "question" || state.locked) return;
  const q = state.current;
  const tile = q.tiles[index];
  if (!tile) return;
  finishQuestion(
    tile.correct ? POINTS_PER_QUESTION : 0,
    Boolean(tile.correct),
    q.explanation,
    tile.correct ? "FOUND THE GAP" : "THAT ONE IT DID CHECK",
  );
}

function handleTimeout() {
  if (state.locked) return;
  state.timedOut = true;
  if (state.phase === "flawpick") {
    finishQuestion(3, false, state.current.explanation, state.current.fallacy);
  } else if (section().id === "snap") {
    answerSnap(null);
  } else {
    // A timeout scores 0 but is reported as "no call", not as a wrong answer —
    // snap timed out on 17% of answers against a clock shorter than the median read.
    finishQuestion(0, false, state.current.explanation, "NO CALL LOGGED — the clock got that one");
  }
}

function advanceFromFeedback() {
  if (!state.feedback) return;
  audio.click(); haptics.fire("tap");
  if (state.feedback.action === "question") {
    state.questionIndex += 1;
    loadQuestion();
    return;
  }
  if (state.feedback.action === "results" || state.sectionIndex === SECTIONS.length - 1) {
    // The score is banked here, but it is shown one screen later. Asking for
    // contact details AFTER twelve questions catches people at peak intent
    // instead of at the door, where the pilot lost half its audience.
    state.phase = "idle";
    reportRunComplete();
    const straightToResults = !!(identity.email && identity.phone);
    state.screen = straightToResults ? "results" : "reveal";
    render();
    if (straightToResults) {
      audio.levelUp(); haptics.fire("levelup");
      if (crackedCount() || humanEdgeIndex() >= 70) window.setTimeout(() => audio.badge(), 900);
      if (humanEdgeIndex() >= 65) launchConfetti();
    } else {
      audio.reveal(); haptics.fire("reveal");
    }
    return;
  }
  startSection(state.sectionIndex + 1);
}

function reportRunComplete() {
  // scoringVersion travels with the run — v1 (floored at 40) and v2 are different scales
  const traits = calculateTraits();
  const [profile] = getProfile(traits);
  telemetry.push("run_complete", {
    scoringVersion: SCORING_VERSION,
    hei: humanEdgeIndex(),
    rawPoints: totalScore(),
    rawMax: runMaxPoints(),
    profile,
    traits,
    sections: SECTIONS.map((item) => {
      const record = state.records.find((entry) => entry.id === item.id);
      return {
        id: item.id,
        title: item.title,
        points: record?.points || 0,
        max: item.count * POINTS_PER_QUESTION,
      };
    }),
    label: `Finished · HEI ${humanEdgeIndex()}`,
  });
}

function calculateTraits() {
  const output = {};
  for (const trait of TRAITS) {
    let weighted = 0;
    let weightTotal = 0;
    for (const item of state.evidence) {
      const weight = item.weights?.[trait.id] || 0;
      weighted += item.ratio * weight;
      weightTotal += weight;
    }
    output[trait.id] = weightTotal ? Math.round((weighted / weightTotal) * 100) : 0;
  }
  return output;
}

function getProfile(traits) {
  const top = [...TRAITS].sort((a, b) => traits[b.id] - traits[a.id])[0];
  if (!top || traits[top.id] < 20) {
    return ["AI AUTOPILOT", "You trusted the system's confidence. Your next edge is knowing when to interrupt it."];
  }
  return PROFILES[top.id];
}

/* Phones get a 2:3 portrait plate where one exists, so the staged reveal can
   fill the screen. The square stays the source of truth everywhere else: it is
   what the desktop art column and the settled band are composed around, and the
   portrait's middle third is the same picture, so the band is unchanged either
   way. <source> rather than a JS swap keeps it to one request — the browser
   picks before it fetches. Only scenes in TALL_SCENES get a <source>: pointing
   one at a file that isn't there yet renders a permanently broken image. */
/* "tall" when a 2:3 portrait plate exists for this scene. Drives the hero
   box's shape on phones; the <picture> below decides which file is fetched. */
function plateShape(question) {
  const name = (question.image?.split("/").pop() || "").replace(/\.webp$/, "");
  return TALL_SCENES.has(name) ? "tall" : "square";
}

function sceneImage(question) {
  const name = (question.image.split("/").pop() || "").replace(/\.webp$/, "");
  const alt = `${escapeHtml(question.title)} illustrated scenario`;
  const square = `${question.image}?v=${ASSET_VERSION}`;
  if (!TALL_SCENES.has(name)) return `<img src="${square}" alt="${alt}">`;
  const tall = `/assets/human-instincts/scenes-tall/${name}.webp?v=${ASSET_VERSION}`;
  return `<picture>
        <source media="(max-width: 820px)" srcset="${tall}">
        <img src="${square}" alt="${alt}">
      </picture>`;
}

function renderVisual(question, resolved = null) {
  if (question?.image) {
    return `
      <div class="character-scene ${resolved ? `is-${resolved}` : ""}" data-scene="${escapeHtml(question.id)}" data-plate="${plateShape(question)}">
        ${sceneImage(question)}
        <div class="character-vignette"></div>
        <div class="character-focus"><i></i><i></i></div>
        <div class="character-motion"><i></i><i></i><i></i><i></i><i></i></div>
        <div class="character-scan"></div>
        <div class="visual-caption">${escapeHtml(question.visual.caption)}</div>
      </div>
    `;
  }
  const v = question?.visual || { glyph: "?", caption: "The next signal is loading.", tone: "logic" };
  return `
    <div class="visual-stage tone-${v.tone} ${resolved ? `is-${resolved}` : ""}">
      <div class="visual-grid"></div>
      <div class="visual-orbit orbit-a"></div>
      <div class="visual-orbit orbit-b"></div>
      <div class="signal-card signal-left"><i></i><i></i><i></i></div>
      <div class="signal-card signal-right"><i></i><i></i></div>
      <div class="visual-glyph"><span>${escapeHtml(v.glyph)}</span></div>
      <div class="visual-caption">${escapeHtml(v.caption)}</div>
      <div class="visual-scan"></div>
      <div class="visual-particles">${Array.from({ length: 8 }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</div>
    </div>
  `;
}

function preloadSectionArt() {
  // Fetched during the AXIOM intro so the brief screen paints complete.
  SECTIONS.forEach((s) => {
    if (!s.art) return;
    const img = new Image();
    img.src = `${s.art}?v=${ASSET_VERSION}`;
  });
}

function preloadSpotScenes() {
  if (spotScenesPreloaded) return;
  spotScenesPreloaded = true;
  QUESTION_BANK.spot.forEach((question) => {
    if (!question.image) return;
    const image = new Image();
    image.src = `${question.image}?v=${ASSET_VERSION}`;
  });
}

/* The plate is the screen's backdrop, but the panel covers most of it once the
   reveal finishes. This gives it back on demand: the sheet slides out, the plate
   is clean for a few seconds, then it returns. Tapping anywhere ends it early.
   The clock keeps running — pausing it would make repeat peeks a way to stop
   the timer altogether. */
let peekTimer = null;
function peekAtPlate() {
  const screen = document.querySelector(".game-screen.bleed");
  if (!screen || screen.classList.contains("plate-peek")) return;
  const PEEK_MS = 3200;
  screen.classList.add("plate-peek");
  const end = () => {
    window.clearTimeout(peekTimer);
    peekTimer = null;
    screen.classList.remove("plate-peek");
    screen.removeEventListener("click", end);
  };
  peekTimer = window.setTimeout(end, PEEK_MS);
  // let the click that opened it finish before arming the dismiss
  window.setTimeout(() => screen.addEventListener("click", end), 0);
}

function renderHeader() {
  // Before the first answer nothing has been earned, so showing the 40 floor
  // read as "you already have 40 points". The floor still applies to the final
  // index — it just isn't advertised before a hand has been played.
  const score = state.answers.length ? humanEdgeIndex() : 0;
  // The reveal screen is the whole point of the lead gate — if the chip still
  // prints the real HEI in the corner, there is nothing left to unlock and
  // nobody fills the form. Locked until they do.
  const locked = state.screen === "reveal";
  return `
    <header class="topbar">
      <button class="brand" id="brand-home" aria-label="Return to start">
        <img src="/assets/human-instincts/atlas-logo-mark.png?v=${ASSET_VERSION}" alt="Atlas SkillTech University">
      </button>
      <div class="topbar-title">
        <strong>HUMAN EDGE INDEX</strong>
        <span>${state.screen === "game" ? `${String(state.sectionIndex + 1).padStart(2, "0")} / 04 · ${section().short.toUpperCase()}` : state.screen === "results" ? "YOUR HUMAN INSTINCT PROFILE" : state.screen === "reveal" ? "LOCKED" : "H.E.I."}</span>
      </div>
      <div class="score-chip${locked ? " is-locked" : ""}">
        <span>HEI</span><strong>${locked ? "&#128274;" : score}</strong>
      </div>
      <button class="utility-button" id="mute-button" aria-label="${state.muted ? "Unmute" : "Mute"}">${state.muted ? "×" : "♪"}</button>
      <div class="section-progress" aria-label="Progress through the run">
        ${renderProgressPips()}
      </div>
    </header>
  `;
}

/* One pip per question, grouped into its section. The old bar showed four
   blocks for twelve questions, so a player three questions in saw no movement
   at all and had no way to tell how much was left. */
function renderProgressPips() {
  const done = state.screen === "results" ? questionsPerRun() : state.answers.length;
  let pip = 0;
  return SECTIONS.map((item, si) => {
    const cells = Array.from({ length: item.count }, () => {
      const state_ = pip < done ? "complete" : pip === done && state.screen === "game" ? "active" : "";
      pip += 1;
      return `<i class="${state_}"></i>`;
    }).join("");
    return `<span class="progress-group" style="flex:${item.count}" title="${item.title}">${cells}</span>`;
  }).join("");
}

function renderPilotGate() {
  if (identity.captured) {
    return `
      <div class="pilot-gate is-known">
        <div class="pilot-known">
          <span>PLAYING AS</span>
          <strong>${escapeHtml(identity.name)}</strong>
          <button type="button" id="pilot-change">Not you?</button>
        </div>
        <button class="primary-button" id="play-button"><span>ENTER THE SIMULATOR</span><b>→</b></button>
      </div>
    `;
  }
  return `
    <form class="pilot-gate" id="pilot-gate" novalidate>
      <div class="pilot-fields pilot-fields-solo">
        <label class="pilot-field">
          <span>YOUR NAME</span>
          <input id="pilot-name" type="text" maxlength="80" autocomplete="name"
            placeholder="First name is fine" value="${escapeHtml(identity.name)}">
        </label>
      </div>
      ${state.gateError ? `<p class="pilot-error">${escapeHtml(state.gateError)}</p>` : ""}
      
      <button class="primary-button" id="play-button" type="submit"><span>ENTER THE SIMULATOR</span><b>→</b></button>
    </form>
  `;
}

function renderWelcome() {
  return `
    <main class="screen welcome-screen">
      <section class="welcome-copy">
        <div class="micro-label">ATLAS PRESENTS</div>
        <h1>Human Edge<br><span>Index.</span></h1>
        ${renderPilotGate()}
        <div class="welcome-facts">
          <span><b>04</b> Sections</span>
          <span><b>${TOTAL_SCENARIOS}</b> Scenarios in rotation</span>
          <span><b>${questionsPerRun()}</b> Questions per run</span>
        </div>
      </section>
      <section class="welcome-scenes" aria-hidden="true">
        <div class="scene-card card-a"><img src="/assets/human-instincts/scene-pizza.webp?v=${ASSET_VERSION}" alt=""></div>
        <div class="scene-card card-b"><img src="/assets/human-instincts/scene-candy.webp?v=${ASSET_VERSION}" alt=""></div>
        <div class="scene-card card-c"><img src="/assets/human-instincts/scene-traffic.webp?v=${ASSET_VERSION}" alt=""></div>
        <div class="welcome-stamp">PICK YOUR<br>BATTLE</div>
      </section>
    </main>
  `;
}

function renderAxiomIntro() {
  return `
    <main class="screen axiom-screen bleed">
      <div class="axiom-visual">
        <div class="character-scene axiom-scene" data-scene="axiom-intro">
          <picture>
            <source media="(max-width: 820px)" srcset="/assets/human-instincts/axiom/axiom-intro-tall.webp?v=${ASSET_VERSION}">
            <img src="/assets/human-instincts/axiom/axiom-intro-v1.webp?v=${ASSET_VERSION}" alt="AXIOM"
                 onerror="this.closest('.axiom-scene').classList.add('no-art')">
          </picture>
          <div class="character-focus"><i></i></div>
        </div>
      </div>
      <div class="axiom-copy">
        <div class="micro-label">MEET THE SYSTEM YOU'RE PLAYING</div>
        <h2>This is AXIOM.</h2>
        <p class="axiom-line">It has made 900M+ decisions this year. It has never once
        asked whether it should.</p>
        <p class="axiom-line dim">Hospitals run on it. Schools grade with it. It has never been wrong —
        because nobody has ever checked.</p>
        <p class="axiom-line strong">Today you check.</p>
        <button class="primary-button" id="axiom-next"><span>START PLAYING</span><b>&rarr;</b></button>
      </div>
    </main>
  `;
}

function renderTierPick() {
  return `
    <main class="screen tier-screen">
      <div class="tier-head">
        <div class="micro-label">AXIOM HAS RATED ITS OWN TEST</div>
        <h2>Pick your battle.</h2>
        <p class="tier-sub">It gets to grade the difficulty. You get to prove it wrong.</p>
      </div>
      <div class="tier-grid">
        ${TIERS.map((t, i) => `
          <button class="tier-card tier-${t.id}" data-tier="${t.id}">
            <span class="tier-plain">${t.plain}</span>
            <strong>${t.label}</strong>
            <em>&ldquo;${escapeHtml(t.taunt)}&rdquo;</em>
          </button>`).join("")}
      </div>
    </main>
  `;
}

function renderBrief() {
  return `
    <main class="screen brief-screen">
      <div class="brief-heading">
        <h2>Twelve calls. Trust your gut.</h2>
      </div>
      <div class="section-map">
        ${SECTIONS.map((item, index) => `
          <article style="--delay:${index * 80}ms">
            <span>0${index + 1}</span>
            <i class="section-art"><img src="${item.card || item.art}?v=${ASSET_VERSION}" alt=""></i>
            <div><h3>${item.title}</h3><p>${item.description}</p></div>
          </article>
        `).join("")}
      </div>
      <div class="brief-footer">
        <div><span class="adaptive-dot"></span><small>First one is a practice call. No clock on it.</small></div>
        <button class="primary-button" id="begin-button"><span>BEGIN SECTION 01</span><b>→</b></button>
      </div>
    </main>
  `;
}

function renderSectionIntro() {
  const item = section();
  return `
    <main class="screen section-intro-screen bleed">
      <div class="section-number">0${state.sectionIndex + 1}</div>
      <div class="section-intro-copy">
        <div class="micro-label">${item.eyebrow}</div>
        <h2>${item.title}</h2>
        <p>${item.description}</p>
        <div class="section-rules">
          <span><b>${item.count}</b> calls</span>
          <span><b>${Math.round(item.time * tier().timeScale)}</b> seconds each</span>
          <span><b>${item.count * POINTS_PER_QUESTION}</b> HEI points</span>
        </div>
        <button class="primary-button" id="section-start"><span>${state.sectionIndex === 0 ? "SHOW ME THE FIRST SIGNAL" : "START THIS SECTION"}</span><b>→</b></button>
      </div>
      <div class="section-intro-visual">
        <div class="character-scene section-scene">
          <img src="${item.art}?v=${ASSET_VERSION}" alt="">
          <div class="character-focus"><i></i></div>
          <div class="character-scan"></div>
        </div>
      </div>
    </main>
  `;
}

function renderTimer() {
  return `
    <div class="timer" id="timer">
      <b id="timer-number">${String(Math.ceil(state.timeLeft || Math.round(section().time * tier().timeScale))).padStart(2, "0")}</b><small>SEC</small>
      <i><em id="timer-fill"></em></i>
    </div>
  `;
}

function renderActions(q) {
  if (state.phase === "flawpick") {
    return `
      <div class="action-stack flaw-options">
        <div class="action-label">You caught the claim. Now name the exact flaw.</div>
        ${q.flawOptions.map((option, index) => `<button class="line-option" data-flaw="${index}"><span>0${index + 1}</span>${escapeHtml(option)}</button>`).join("")}
      </div>
    `;
  }
  if (section().id === "spot") {
    if (q.format === "sequence") {
      return `<div class="action-stack">${q.lines.map((line, index) => `<button class="line-option" data-line="${index}"><span>0${index + 1}</span>${escapeHtml(line)}</button>`).join("")}</div>`;
    }
    return `
      <div class="binary-actions">
        <button class="decision-button machine" data-verdict="sound"><span>01</span><strong>SOUND</strong><small>The reasoning holds.</small><img class="answer-mark" src="/assets/human-instincts/axiom/axiom-head.webp?v=${ASSET_VERSION}" alt=""></button>
        <button class="decision-button human" data-verdict="flawed"><span>02</span><strong>FLAWED</strong><small>Something important breaks.</small></button>
      </div>
    `;
  }
  if (section().id === "snap") {
    return `
      <div class="binary-actions">
        <button class="decision-button machine" data-snap="true"><span>01</span><strong>RIGHT CALL</strong><small>AXIOM handled it.</small><img class="answer-mark" src="/assets/human-instincts/axiom/axiom-head.webp?v=${ASSET_VERSION}" alt=""></button>
        <button class="decision-button human" data-snap="false"><span>02</span><strong>WRONG CALL</strong><small>Human intervention needed.</small></button>
      </div>
    `;
  }
  // OUT-THINK IT: three cards, one tap. The real fix scores 5, a plausible
  // symptom-fix scores 2, AXIOM's plan-but-worse scores 0 and does the teaching.
  // Replaces a textarea that only 12 of 513 answers ever cleared full marks on.
  if (section().id === "counter") {
    return `
      <div class="action-stack option-cards">
        <div class="action-label">${escapeHtml(q.ask)}</div>
        ${shuffledIndexes(q.options.length).map((originalIndex, shown) =>
          `<button class="line-option" data-option="${originalIndex}"><span>0${shown + 1}</span>${escapeHtml(q.options[originalIndex].text)}</button>`
        ).join("")}
      </div>
    `;
  }
  // THE BLIND SPOT: tap the thing the plan never looked at. 2x2 grid, one tap.
  if (section().id === "blindspot") {
    return `
      <div class="action-stack">
        <div class="action-label">AXIOM never opened one of these. Which?</div>
        <div class="tile-grid">
          ${shuffledIndexes(q.tiles.length).map((originalIndex) =>
            `<button class="gap-tile" data-tile="${originalIndex}">${escapeHtml(q.tiles[originalIndex].text)}</button>`
          ).join("")}
        </div>
      </div>
    `;
  }
  return "";
}

// Positions are shuffled per render so the correct answer isn't learnable by
// position — all three `sequence` questions in the pilot bank had the answer at
// index 3, which is a free 33% for anyone who noticed.
function shuffledIndexes(length) {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}


/* The explicit ask. Binary rounds never had one — the player got a scenario, a
   quote from AXIOM and two buttons, and had to infer what was being asked. */
function questionPrompt(q) {
  const id = section().id;
  if (id === "counter") return q.ask || "Which fix actually works?";
  if (id === "blindspot") return "What did AXIOM never look at?";
  if (id === "spot") return "Is AXIOM's reasoning sound, or is it flawed?";
  return "Did AXIOM get this right?";
}


/* Drives the staged reveal. Steps advance on a timer; a tap anywhere jumps
   straight to the end. The clock is NOT started here — startTimer only fires
   once the last step lands, so the staging can never eat answer time. */

/* Wipes AXIOM's choice in once. `immediate` is used when the player skips —
   there is no half-revealed state to leave behind. */
function revealAxiomLine(immediate = false) {
  const line = document.querySelector(".axiom-line-reveal");
  if (!line || line.classList.contains("is-shown")) return;
  const panel = line.closest(".axiom-panel");
  if (immediate || prefersReducedMotion()) {
    line.classList.add("is-shown");
    return;
  }
  line.classList.add("is-revealed");
  panel?.classList.add("is-flash");
  // belt and braces: if animationend never fires, the clip is dropped anyway
  const settle = () => line.classList.add("is-shown");
  line.addEventListener("animationend", settle, { once: true });
  window.setTimeout(settle, 1100);
}

let stageTimers = [];
/* The veil is fixed to the viewport, but the thing it is framing is the
   artwork — and on desktop the artwork sits in the LEFT column. Centring the
   countdown on the viewport put it half-behind the image's right edge. So we
   measure the scene and hand the veil its centre; on phone the image is full
   width and this resolves to the same place it already was. */
function anchorVeilToScene() {
  const veil = document.getElementById("stage-veil");
  // Ordered lookup on purpose: querySelector with a comma list returns the
  // first match in DOCUMENT order, not selector order, so a single grouped
  // selector would hand back the whole .question-visual section — art plus its
  // header — and centre the ring 18px above the plate.
  const scene =
    document.querySelector(".question-visual .character-scene") ||
    document.querySelector(".question-visual img") ||
    document.querySelector(".question-visual");
  if (!veil || !scene) return;
  const place = () => {
    const r = scene.getBoundingClientRect();
    if (!r.width) return;
    // Offsets are relative to the VEIL, not the viewport: an ancestor transform
    // means this fixed layer resolves against the game screen, so it starts
    // below the topbar. Measuring off the veil is right either way.
    const v = veil.getBoundingClientRect();
    veil.style.setProperty("--veil-cx", `${Math.round(r.left + r.width / 2 - v.left)}px`);
    veil.style.setProperty("--veil-cy", `${Math.round(r.top + r.height / 2 - v.top)}px`);
    veil.style.setProperty("--veil-bottom", `${Math.round(v.bottom - r.bottom + 18)}px`);
  };
  place();
  // The artwork does not hold still: the plate decodes, the scene scales in,
  // and each reveal step grows the right column, which nudges the art in its
  // grid row. Any single reading is stale by the next step — so track it for
  // the whole time the veil is up. It is one rect read per frame for 2.5s.
  const track = () => {
    if (!veil.isConnected) return;
    place();
    requestAnimationFrame(track);
  };
  requestAnimationFrame(track);
  const img = scene.tagName === "IMG" ? scene : scene.querySelector("img");
  if (img && !img.complete) img.addEventListener("load", place, { once: true });
  window.addEventListener("resize", place);
  veil.__unplace = () => window.removeEventListener("resize", place);
}

function runStagedReveal(onDone) {
  stageTimers.forEach(clearTimeout);
  stageTimers = [];
  const screen = document.querySelector(".game-screen.staged");
  if (!screen) { onDone(); return; }
  anchorVeilToScene();

  const VEIL_MS = 4000;                 // the scene alone (+1.5s, Kish 2026-09-01)
  // the ring and the counter shrink are CSS animations timed to this — publish
  // it rather than repeat the number in the stylesheet, where it silently drifts
  document.documentElement.style.setProperty("--veil-ms", `${VEIL_MS}ms`);
  const STEP_MS = [0, 460, 900, 1420];  // situation, the question, AXIOM choice (ray), answers
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    stageTimers.forEach(clearTimeout);
    stageTimers = [];
    screen.dataset.stage = "4";
    screen.classList.add("stage-done");
    revealAxiomLine(true);
    const _v = document.getElementById("stage-veil");
    _v?.__unplace?.();
    _v?.remove();
    onDone();
  };

  // tapping anywhere skips the whole sequence
  screen.addEventListener("pointerdown", finish, { once: true });

  stageTimers.push(window.setTimeout(() => {
    if (finished) return;
    screen.classList.add("veil-out");
    STEP_MS.forEach((ms, i) => {
      stageTimers.push(window.setTimeout(() => {
        if (finished) return;
        screen.dataset.stage = String(i + 1);
        // AXIOM's line wipes in exactly once, driven by a class rather than the
        // stage attribute — otherwise every later stage tick restarts the wipe.
        if (i + 1 === 3) revealAxiomLine();
      }, ms));
    });
    stageTimers.push(window.setTimeout(finish, STEP_MS[STEP_MS.length - 1] + 320));
  }, VEIL_MS));

  if (prefersReducedMotion()) finish();
}

const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function renderQuestion() {
  const q = state.current;
  const questionLabel = ` · QUESTION ${state.questionIndex + 1} OF ${questionsInSection()}`;
  const axiomCopy = section().id === "snap" || section().id === "counter" ? q.axiom : "";
  // Warm-up runs with no clock and no score chrome: the pilot showed a zero on
  // question one halves the odds of a second answer (93% continue after 5pts, 68% after 0).
  const warmup = isWarmup();
  return `
    <main class="screen game-screen staged${warmup ? " warmup" : ""}${plateShape(q) === "tall" ? " bleed" : ""}" data-stage="0">
      <!-- The scene gets the screen to itself first, then the panel builds in
           order: situation, then the question, then what AXIOM chose, then the
           answers. Attention is pointed at one thing at a time instead of the
           whole wall arriving at once. The clock only starts at the end. -->
      <div class="stage-veil" id="stage-veil" aria-hidden="true">
        <div class="stage-counter">
          <svg viewBox="0 0 100 100">
            <circle class="ring-track" cx="50" cy="50" r="44"/>
            <circle class="ring-progress" cx="50" cy="50" r="44"/>
          </svg>
        </div>
      </div>
      <span class="stage-skip" aria-hidden="true">tap to skip</span>
      <section class="question-visual">
        <div class="scene-meta"><span>${q.arena.toUpperCase()} SIGNAL</span>${warmup ? "<b>PRACTICE CALL</b>" : ""}</div>
        <button type="button" class="plate-peek-btn" id="see-full">See full image</button>
        ${renderVisual(q)}
      </section>
      <div class="panel-sheet">
      <section class="decision-panel">
        <div class="round-meta"><span>${warmup ? "WARM-UP" : `SECTION 0${state.sectionIndex + 1}${questionLabel}`}</span></div>
        ${warmup ? `<div class="micro-label">First one's a practice call. No clock.</div>` : ""}
        <div class="reveal-step step-situation">
          <h2>${escapeHtml(q.title)}</h2>
          <p class="situation-copy">${escapeHtml(q.prompt)}</p>
        </div>
        ${axiomCopy ? `<div class="reveal-step step-axiom">
          <div class="axiom-panel">
            <span class="axiom-who">
              <img src="/assets/human-instincts/axiom/axiom-head.webp?v=${ASSET_VERSION}" alt="" class="axiom-avatar">
              AXIOM CHOSE
            </span>
            <p class="axiom-line-reveal">${escapeHtml(axiomCopy)}</p>
          </div>
        </div>` : ""}
        <div class="reveal-step step-question">
          <div class="question-bar">
            <span class="question-bar-label">YOUR CALL</span>
            <strong>${escapeHtml(questionPrompt(q))}</strong>
          </div>
        </div>
      </section>
      <div class="thumb-bar reveal-step step-answers">
        ${warmup ? "" : renderTimer()}
        ${renderActions(q)}
      </div>
      </div>
    </main>
  `;
}

function renderFeedback() {
  const q = state.current;
  const f = state.feedback;
  const nextLabel = f.action === "question"
    ? `NEXT SIGNAL · ${state.questionIndex + 2} OF ${questionsInSection()}`
    : state.sectionIndex === SECTIONS.length - 1
      ? "SEE YOUR HUMAN EDGE PROFILE"
      : `CONTINUE TO SECTION 0${state.sectionIndex + 2}`;
  return `
    <main class="screen feedback-screen ${f.success ? "success" : "failure"}${plateShape(q) === "tall" ? " bleed" : ""}">
      <section class="feedback-visual">${renderVisual(q, f.success ? "success" : "failure")}</section>
      <section class="feedback-panel">
        <div class="micro-label">${f.success ? "SIGNAL RESOLVED" : "WHAT THE SYSTEM MISSED"}</div>
        <div class="feedback-score"><h2>${f.title}</h2><strong>+${f.points}${section().id === "counter" ? `<small>/${f.max}</small>` : ""}</strong></div>
        <div class="feedback-chip">${escapeHtml(f.label)}</div>
        <p>${escapeHtml(f.explanation)}</p>
        ${section().id === "snap" ? `<div class="snap-recap">${state.snap.answers.map((answer) => `<span class="${answer.right ? "right" : "wrong"}">${answer.right ? "✓" : "×"} ${escapeHtml(answer.title)}</span>`).join("")}</div>` : ""}
        <button class="primary-button" id="feedback-next"><span>${nextLabel}</span><b>→</b></button>
      </section>
    </main>
  `;
}

function renderReveal() {
  const hei = humanEdgeIndex();
  const [profile] = getProfile(calculateTraits());
  const band = heiBand(hei);
  // The hook is the score they cannot see yet — stated, never shown.
  const hook = hei >= 70 ? "Almost nobody scores this high."
    : hei >= 50 ? "That is a genuinely strong read."
    : hei >= 30 ? "You held your own against AXIOM."
    : "You finished all twelve — most people don't.";
  return `
    <main class="screen reveal-screen">
      <section class="reveal-copy">
        <div class="micro-label">ROUND COMPLETE</div>
        <h2>${escapeHtml(identity.name || "You")}, your score is in.</h2>
        <p class="reveal-hook"><b>${hook}</b> You landed in <b>${band}</b> — and AXIOM has a name for how you think.</p>
        <p class="reveal-sub">Drop your details and we'll unlock your result card — a shareable image with your
        H.E.I., your profile and how you scored in each round.</p>
        <form class="pilot-gate reveal-form" id="reveal-form" novalidate>
          <div class="pilot-fields">
            <label class="pilot-field">
              <span>EMAIL</span>
              <input id="reveal-email" type="email" inputmode="email" maxlength="120" autocomplete="email"
                placeholder="Where we should send it" value="${escapeHtml(identity.email)}">
            </label>
            <label class="pilot-field">
              <span>PHONE</span>
              <input id="reveal-phone" type="tel" inputmode="tel" maxlength="24" autocomplete="tel"
                placeholder="Your number" value="${escapeHtml(identity.phone)}">
            </label>
          </div>
          ${state.gateError ? `<p class="pilot-error">${escapeHtml(state.gateError)}</p>` : ""}
          <button class="primary-button" id="reveal-button" type="submit"><span>SHOW ME MY RESULT</span><b>→</b></button>
        </form>
      </section>
    </main>
  `;
}


/* Five traits, five axes — a radar reads as a SHAPE, which is far more
   screenshot-worthy than five bars and shows the profile at a glance.
   Drawn as inline SVG so it scales, needs no library, and themes with CSS. */
function traitRadar(traits) {
  // The chart is 260 wide but the axis LABELS sit outside it — "HUMAN JUDGMENT"
  // anchored at the right vertex runs ~110px further right. The viewBox is
  // widened to hold them, otherwise they get clipped mid-word.
  const size = 260, cx = size / 2, cy = size / 2, R = 92;
  const VB = { x: -104, y: -16, w: 468, h: 300 };
  const n = TRAITS.length;
  const angle = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;   // start at 12 o'clock
  const pt = (i, r) => [cx + Math.cos(angle(i)) * r, cy + Math.sin(angle(i)) * r];
  const ring = (frac) => TRAITS.map((_, i) => pt(i, R * frac).map((v) => v.toFixed(1)).join(",")).join(" ");
  const shape = TRAITS.map((tr, i) =>
    pt(i, R * clamp((traits[tr.id] || 0) / 100, 0.06, 1)).map((v) => v.toFixed(1)).join(",")).join(" ");

  return `
    <svg class="trait-radar" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" role="img"
         aria-label="${TRAITS.map((tr) => `${tr.label} ${traits[tr.id]}`).join(", ")}">
      ${[0.25, 0.5, 0.75, 1].map((f) => `<polygon class="radar-ring" points="${ring(f)}"/>`).join("")}
      ${TRAITS.map((_, i) => {
        const [x, y] = pt(i, R);
        return `<line class="radar-spoke" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
      }).join("")}
      <polygon class="radar-shape" points="${shape}"/>
      ${TRAITS.map((tr, i) => {
        const [x, y] = pt(i, R * clamp((traits[tr.id] || 0) / 100, 0.06, 1));
        return `<circle class="radar-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5"/>`;
      }).join("")}
      ${TRAITS.map((tr, i) => {
        const [x, y] = pt(i, R + 24);
        const anchor = Math.abs(x - cx) < 12 ? "middle" : x > cx ? "start" : "end";
        return `<text class="radar-label" x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}">${tr.label.toUpperCase()}</text>
                <text class="radar-value" x="${x.toFixed(1)}" y="${(y + 18).toFixed(1)}" text-anchor="${anchor}">${traits[tr.id]}</text>`;
      }).join("")}
    </svg>`;
}

function renderResults() {
  const hei = humanEdgeIndex();
  const traits = calculateTraits();
  const [profile, copy] = getProfile(traits);
  return `
    <main class="screen results-screen">
      <section class="results-copy">
        <div class="micro-label">YOUR HUMAN INSTINCT PROFILE</div>
        <h2>${profile}</h2>
        <p>${copy}</p>
        <!-- The score is the thing people screenshot, so it sits directly under the
             name and above everything else. It used to render below the replay
             button, under two stat boxes — buried past the fold on a phone. -->
        <div class="hei-badge-wrap">
          <div class="hei-badge">
            <img src="/assets/human-instincts/badges/${heiBadge(hei)}.webp?v=${ASSET_VERSION}" alt="">
            <div class="hei-badge-num"><b id="hei-count">${hei}</b><i>H.E.I.</i></div>
          </div>
          <div class="hei-badge-band">${heiBand(hei)} · OUT OF 100</div>
          <div class="hei-percentile" id="hei-percentile"></div>
          ${crackedCount() ? `<div class="cracked-award">
            <img src="/assets/human-instincts/badges/hei-cracked.webp?v=${ASSET_VERSION}" alt="">
            <span><b>×${crackedCount()}</b>CRACKED THE MACHINE</span>
          </div>` : ""}
        </div>
        <!-- Share sits above Play Again: the moment the score lands is the
             only moment anyone wants to send it to someone. -->
        <div class="debrief">
          <span class="debrief-label">WHY WE RUSHED YOU</span>
          <p>The clock was deliberate. AXIOM is confident and it is fast, and the easiest thing
          under pressure is to take its word for it. Your Human Edge is what you caught anyway —
          not how quickly you clicked.</p>
        </div>
        <div class="result-actions">
          <button class="primary-button share-button" id="share-card"><span>SHARE MY SCORE</span><b>↗</b></button>
          <button class="ghost-button save-button" id="save-card"><span>SAVE IMAGE</span><b>↓</b></button>
        </div>
        <div class="share-status" id="share-status" role="status" aria-live="polite"></div>
        <button class="ghost-button" id="play-again"><span>PLAY AGAIN</span><b>↻</b></button>
      </section>
      <section class="profile-card">
        <div class="section-results">
          ${SECTIONS.map((item) => {
            const record = state.records.find((entry) => entry.id === item.id) || { points: 0, max: item.count * POINTS_PER_QUESTION };
            return `<div><span>${item.title}</span><i><em style="--score:${record.max ? record.points / record.max : 0}"></em></i><b>${record.points}</b></div>`;
          }).join("")}
        </div>
        <div class="trait-radar-wrap">
          <div class="micro-label">HOW YOU THINK</div>
          ${traitRadar(traits)}
        </div>
        <div class="result-callouts">
          <article><span>CALLS MADE</span><strong>${questionsPerRun()}</strong></article>
          <article><span>SCENARIOS IN THE BANK</span><strong>${TOTAL_SCENARIOS}</strong></article>
        </div>
      </section>
    </main>
  `;
}

/* Screens are all designed to fit one viewport. If one ever doesn't — long
   profile name, small device, images that expand the page after paint — the
   player should be TOLD rather than left guessing whether they've seen it all.

   Re-checked on a short schedule rather than once: the results screen fits at
   first paint and only overflows once the badge PNG decodes. A ResizeObserver
   on <body> was tried first and never fired a single callback, so this uses
   plain staged checks, which are boring and actually work. */
let scrollHintTimers = [];

function updateScrollHint() {
  scrollHintTimers.forEach(clearTimeout);
  scrollHintTimers = [];
  document.querySelector(".scroll-hint")?.remove();

  let hint = null;
  const dismiss = () => {
    const node = hint;
    hint = null;
    if (!node) return;
    node.classList.add("is-gone");
    setTimeout(() => node.remove(), 320);
  };

  const check = () => {
    const overflow = document.documentElement.scrollHeight - window.innerHeight;
    if (overflow < 64 || window.scrollY > 4) { dismiss(); return; }
    if (hint || document.querySelector(".scroll-hint")) return;
    hint = document.createElement("div");
    hint.className = "scroll-hint";
    hint.innerHTML = "<b>\u2193</b><span>MORE BELOW</span>";
    document.body.appendChild(hint);
    window.addEventListener("scroll", dismiss, { once: true, passive: true });
  };

  // now, then again as late assets land and reflow the page
  requestAnimationFrame(check);
  [250, 700, 1500].forEach((ms) => scrollHintTimers.push(window.setTimeout(check, ms)));
  window.addEventListener("resize", check, { passive: true });
}

/* Everything the share card needs, derived once. */
const shareText = (d) =>
  `I scored ${d.hei} on the ATLAS Human Edge Index — ${d.profile}. Think you can beat it?`;

function downloadPrepared(file) {
  const href = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = href; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
}

/* Real percentile from real finishers, or nothing at all.
   The QC review assumed we'd have to invent "better than 80%". We don't — but a
   made-up number in front of a senior audience is worse than no number, so the
   endpoint refuses to answer below 30 finishers and we name the sample size so
   the claim is checkable. */
async function loadPercentile(hei) {
  const node = document.getElementById("hei-percentile");
  if (!node) return;
  try {
    const res = await fetch(`/api/percentile?hei=${encodeURIComponent(hei)}&v=${SCORING_VERSION}`, { cache: "no-store" });
    const data = await res.json();
    if (!data?.ready || typeof data.percentile !== "number") return;   // say nothing
    if (data.percentile < 5) return;                                   // no rubbing it in
    node.textContent = `Better than ${data.percentile}% of the ${data.sample} people who've finished`;
    node.classList.add("is-on");
  } catch {
    /* the score stands on its own */
  }
}

function shareCardData() {
  const hei = humanEdgeIndex();
  const traits = calculateTraits();
  const [profile] = getProfile(traits);
  return {
    hei,
    band: heiBand(hei),
    profile,
    tierLabel: tier().label,
    badge: heiBadge(hei),
    cracked: crackedCount(),
    assetVersion: ASSET_VERSION,
    origin: window.location.origin,
    sections: SECTIONS.map((item) => {
      const record = state.records.find((entry) => entry.id === item.id)
        || { points: 0, max: item.count * POINTS_PER_QUESTION };
      return { title: item.title, points: record.points, max: record.max };
    }),
  };
}

function render() {
  clearTimer();
  let body = "";
  if (state.screen === "welcome") body = renderWelcome();
  else if (state.screen === "axiom") body = renderAxiomIntro();
  else if (state.screen === "tier") body = renderTierPick();
  else if (state.screen === "reveal") body = renderReveal();
  else if (state.screen === "brief") body = renderBrief();
  else if (state.screen === "results") body = renderResults();
  else if (state.phase === "section-intro") body = renderSectionIntro();
  else if (state.phase === "feedback") body = renderFeedback();
  else body = renderQuestion();

  app.innerHTML = `<div class="atlas-app">${renderHeader()}${body}</div>`;
  telemetry.setScreen(state.screen);
  bindEvents();
  updateScrollHint();
  // Build the share card ahead of the tap. navigator.share() needs transient
  // user activation, and every await between tap and call destroys it — on iOS
  // that meant the sheet never opened at all.
  if (state.screen === "results") {
    prepareShare(shareCardData());
    loadPercentile(humanEdgeIndex());
  }
}

function bindEvents() {
  const mute = document.getElementById("mute-button");
  mute?.addEventListener("click", async () => {
    state.muted = !state.muted;
    audio.setMuted(state.muted);
    haptics.setEnabled(!state.muted);
    if (state.muted) audio.ambientStop();
    else { await audio.resume(); audio.ambientStart(); }
    mute.textContent = state.muted ? "×" : "♪";
    mute.setAttribute("aria-label", state.muted ? "Unmute" : "Mute");
  });

  document.getElementById("brand-home")?.addEventListener("click", () => {
    clearTimer();
    audio.stop();
    resetRun();
    state.screen = "welcome";
    render();
  });

  const enterSimulator = async () => {
    telemetry.push("enter_brief", { label: "Read the brief" });
    await audio.start();
    audio.ambientStart();
    preloadSpotScenes();
    preloadSectionArt();
    audio.click(); haptics.fire("tap");
    state.screen = "axiom";
    render();
  };

  document.getElementById("pilot-gate")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = (document.getElementById("pilot-name")?.value || "").trim().replace(/\s+/g, " ");
    identity.name = name;

    if (name.length < 2) {
      state.gateError = "Please add your name so your run can be matched to you.";
      render();
      document.getElementById("pilot-name")?.focus();
      return;
    }

    state.gateError = "";
    identity.captured = true;
    saveIdentity();
    telemetry.start(identity);
    enterSimulator();
  });

  document.getElementById("reveal-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = (document.getElementById("reveal-email")?.value || "").trim();
    const phone = (document.getElementById("reveal-phone")?.value || "").trim();
    const digits = phone.replace(/\D/g, "");
    // Deliberately loose: something@something.tld. Anything stricter rejects
    // real addresses, and a bounced lead is cheaper than a blocked player.
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

    if (!emailOk) {
      state.gateError = "That email doesn't look right — we need it to unlock your card.";
      render();
      document.getElementById("reveal-email")?.focus();
      return;
    }
    if (digits.length < 7 || digits.length > 15) {
      state.gateError = phone
        ? "That phone number doesn't look right — check the digits."
        : "We need a phone number to unlock your result.";
      render();
      document.getElementById("reveal-phone")?.focus();
      return;
    }

    state.gateError = "";
    identity.email = email;
    identity.phone = phone;
    saveIdentity();
    telemetry.push("lead_capture", {
      label: "Gave contact details to unlock the result",
      value: humanEdgeIndex(), tier: state.tier,
      email, phone, name: identity.name,
    });
    audio.click(); haptics.fire("tap");
    state.screen = "results";
    render();
    audio.levelUp(); haptics.fire("levelup");
    if (crackedCount() || humanEdgeIndex() >= 70) window.setTimeout(() => audio.badge(), 900);
    if (humanEdgeIndex() >= 65) launchConfetti();
  });

  document.getElementById("pilot-change")?.addEventListener("click", () => {
    identity.captured = false;
    state.gateError = "";
    render();
    document.getElementById("pilot-name")?.focus();
  });

  // Only bound when the gate is already satisfied — otherwise the form's submit
  // handler owns this button and binding click too would fire it twice.
  if (identity.captured) {
    document.getElementById("play-button")?.addEventListener("click", () => {
      telemetry.start(identity);
      enterSimulator();
    });
  }

  document.querySelectorAll("[data-tier]").forEach((b) => b.addEventListener("click", () => {
    state.tier = b.dataset.tier;
    audio.click(); haptics.fire("tap");
    telemetry.push("tier_select", { tier: state.tier, label: tier().label });
    state.screen = "brief";
    render();
  }));
  document.getElementById("begin-button")?.addEventListener("click", () => {
    audio.click(); haptics.fire("tap");
    resetRun();
    telemetry.push("run_start", { label: "Started the run" });
    startSection(0);
  });
  document.getElementById("section-start")?.addEventListener("click", () => {
    audio.click(); haptics.fire("tap");
    loadQuestion();
  });
  document.getElementById("see-full")?.addEventListener("click", (e) => {
    e.stopPropagation();
    peekAtPlate();
  });
  document.querySelectorAll("[data-verdict]").forEach((button) => button.addEventListener("click", () => answerVerdict(button.dataset.verdict)));
  document.querySelectorAll("[data-flaw]").forEach((button) => button.addEventListener("click", () => answerFlaw(Number(button.dataset.flaw))));
  document.querySelectorAll("[data-line]").forEach((button) => button.addEventListener("click", () => answerSequence(Number(button.dataset.line))));
  document.querySelectorAll("[data-snap]").forEach((button) => button.addEventListener("click", () => answerSnap(button.dataset.snap === "true")));
  document.getElementById("feedback-next")?.addEventListener("click", advanceFromFeedback);
  document.querySelectorAll("[data-option]").forEach((button) => button.addEventListener("click", () => answerOption(Number(button.dataset.option))));
  document.querySelectorAll("[data-tile]").forEach((button) => button.addEventListener("click", () => answerTile(Number(button.dataset.tile))));
  document.getElementById("axiom-next")?.addEventListener("click", () => {
    audio.click(); haptics.fire("tap");
    telemetry.push("axiom_intro_done", { label: "Saw the AXIOM intro" });
    state.screen = "tier";
    render();
  });

  document.getElementById("share-card")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    const status = document.getElementById("share-status");
    if (button.disabled) return;
    audio.click();
    haptics.fire("tap");

    const data = shareCardData();
    const say = (msg) => { if (status) status.textContent = msg; };
    const log = (outcome) => telemetry.push("share_card", {
      label: `Shared result (${outcome})`, value: data.hei, tier: state.tier, outcome,
    });

    // FAST PATH — no awaits before navigator.share(). iOS destroys transient
    // user activation on the first await, which is why the sheet never opened.
    const ready = takePrepared(data.hei);
    if (ready && navigator.canShare?.({ files: [ready] }) && navigator.share) {
      navigator.share({ files: [ready], text: shareText(data), title: "ATLAS · HUMAN EDGE INDEX" })
        .then(() => { say("Sent."); log("shared"); audio.badge(); haptics.fire("badge"); })
        .catch((err) => {
          if (err?.name === "AbortError") { say(""); log("cancelled"); return; }
          say("Couldn't open the share sheet — saving the card instead.");
          log(err?.name === "NotAllowedError" ? "share-blocked" : "share-failed");
          downloadPrepared(ready);
        });
      return;
    }

    // SLOW PATH — card wasn't ready (or no file sharing here). Build, then save.
    const label = button.querySelector("span");
    const original = label.textContent;
    button.disabled = true;
    label.textContent = "BUILDING CARD…";
    (async () => {
      try {
        const canvas = await renderShareCard(data);
        const result = await shareCard(canvas, { text: shareText(data), url: window.location.origin });
        log(result);
        say(
          result === "shared" ? "Sent."
          : result === "whatsapp" ? "Card saved to your downloads — attach it in WhatsApp."
          : result === "download" ? "Card saved to your downloads."
          : result === "cancelled" ? ""
          : "Couldn't build the card. Try once more?"
        );
        if (result !== "cancelled" && result !== "failed") { audio.badge(); haptics.fire("badge"); }
      } catch (err) {
        console.error("share card failed", err);
        say("Couldn't build the card. Try once more?");
        log("error");
      } finally {
        label.textContent = original;
        button.disabled = false;
      }
    })();
  });

  document.getElementById("save-card")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const status = document.getElementById("share-status");
    if (button.disabled) return;
    audio.click(); haptics.fire("tap");
    const data = shareCardData();
    const say = (m) => { if (status) status.textContent = m; };

    // The pre-built File is already in hand on the results screen, so this is
    // usually instant. Only fall back to rendering if it isn't ready yet.
    const ready = takePrepared(data.hei);
    if (ready) {
      downloadPrepared(ready);
      say("Saved to your downloads.");
      telemetry.push("share_card", { label: "Saved the result card", value: data.hei, tier: state.tier, outcome: "saved" });
      audio.badge(); haptics.fire("badge");
      return;
    }

    const label = button.querySelector("span");
    const original = label.textContent;
    button.disabled = true;
    label.textContent = "SAVING…";
    try {
      const canvas = await renderShareCard(data);
      const blob = await canvasToBlob(canvas);
      if (!blob) throw new Error("could not build the card");
      downloadPrepared(new File([blob], "human-edge-index.jpg", { type: "image/jpeg" }));
      say("Saved to your downloads.");
      telemetry.push("share_card", { label: "Saved the result card", value: data.hei, tier: state.tier, outcome: "saved" });
      audio.badge(); haptics.fire("badge");
    } catch (err) {
      console.error("save card failed", err);
      say("Couldn't save the card. Try once more?");
    } finally {
      label.textContent = original;
      button.disabled = false;
    }
  });

  document.getElementById("play-again")?.addEventListener("click", () => {
    audio.click(); haptics.fire("tap");
    resetRun();
    identity.email = "";      // a replay is a fresh run, so it asks again
    identity.phone = "";
    telemetry.push("replay", { label: "Started another run" });
    state.screen = "tier";
    render();
  });

  document.querySelectorAll("button").forEach((button) => button.addEventListener("pointerenter", () => audio.hover()));
}

function launchConfetti() {
  const layer = document.createElement("div");
  layer.className = "page-confetti";
  layer.innerHTML = Array.from({ length: 38 }, (_, index) => `<i style="--left:${Math.random() * 100}%;--delay:${index * 18}ms;--duration:${1.8 + Math.random() * 1.2}s;--color:${index % 2 ? "#f2a62b" : "#17365f"}"></i>`).join("");
  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), 3600);
}

render();

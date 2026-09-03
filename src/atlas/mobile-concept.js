import "./mobile-concept.css";
import { tesseractLogoHTML, setTesseractState } from "./tesseract-logo.js";
import { AudioEngine } from "./audio.js";
import {
  BRAND,
  HOW_TO_PLAY,
  SCREEN_COPY,
  QUICK_GAME_CIVIS_LINES,
  QUICK_CASES,
  STORY_LEVELS,
  PERSONALITY_TYPES,
  getPersonalityForScore,
  drawStoryCase,
  quickGameScore,
  storyModeScore,
} from "./human-instincts-data.js";

const root = document.getElementById("mobile-concept");
const audio = new AudioEngine();

const LEADERBOARD_KEY = "atlas-human-instincts-leaderboard";
const QUESTION_SECONDS = 45;

const state = {
  phase: "title", // title | modeSelect | howToPlay | question | answer | levelTransition | result
  mode: null, // "quick" | "story"
  run: [], // resolved case list for this run, each: { case, levelIndex, levelCaseIndex }
  index: 0,
  answers: [], // { correct, timedOut }
  correctCount: 0,
  stickerCount: 0,
  chosen: null,
  wasTimeout: false,
  timeLeft: QUESTION_SECONDS,
  timerHandle: null,
};

function beingHTML(tone, expr = "idle", size = 72) {
  return `<div class="being tone-${tone} expr-${expr}" style="width:${size}px" data-being="${tone}">
    <i class="being-eye left"></i><i class="being-eye right"></i>
    <i class="being-brow left"></i><i class="being-brow right"></i>
    <i class="being-mouth"></i>
  </div>`;
}

function stopTimer() {
  if (state.timerHandle) {
    window.clearInterval(state.timerHandle);
    state.timerHandle = null;
  }
}

function ensureAudio() {
  audio.start().catch(() => {});
}

/* ---------------- TITLE / ATTRACT ---------------- */

function renderTitle() {
  root.innerHTML = `
    <main class="prototype-stage">
      <section class="phone-shell title-stage">
        <div class="title-topline">
          <div class="wordmark wordmark-light">
            <strong>${BRAND.wordmarkTop}</strong>
            <span>${BRAND.wordmarkBottom}</span>
          </div>
          <div class="atlas-live atlas-live-dark glass-chip">
            ${tesseractLogoHTML(22)}
            <span>ATLAS AI</span>
            <b>LIVE</b>
          </div>
        </div>

        <div class="title-duel">
          ${beingHTML("human", "idle", 88)}
          <span class="vs-glyph">VS</span>
          ${beingHTML("civis", "taunt", 88)}
        </div>

        <div class="title-copy">
          <div class="title-word">HUMAN EDGE INDEX</div>
          <h1 class="title-headline">ATLAS<br><em>HUMAN INSTINCTS</em></h1>
          <p class="title-promise">${BRAND.promise}</p>
        </div>

        <button class="title-cta glass-button" id="title-begin">TAP TO BEGIN</button>
        <div class="safe-area"></div>
      </section>
      <div class="desktop-label">MOBILE INTERACTION CONCEPT · 390 × 844</div>
    </main>
  `;

  document.getElementById("title-begin").addEventListener("click", () => {
    ensureAudio();
    audio.click();
    state.phase = "modeSelect";
    render();
  });
}

/* ---------------- MODE SELECT ---------------- */

function renderModeSelect() {
  root.innerHTML = `
    <main class="prototype-stage">
      <section class="phone-shell home-shell">
        <div class="paper-noise"></div>
        <header class="home-header">
          <div class="wordmark wordmark-light">
            <strong>ATLAS</strong>
            <span>HUMAN INSTINCTS</span>
          </div>
          <div class="atlas-live atlas-live-dark glass-chip">
            ${tesseractLogoHTML(20)}
            <span>ATLAS AI</span>
            <b>LIVE</b>
          </div>
        </header>

        <section class="home-hero">
          <div class="hero-atlas">${beingHTML("civis", "gloat", 88)}</div>
          <div class="hero-copy">
            <span>HUMAN EDGE INDEX · SEASON 01</span>
            <h1>Choose your run.</h1>
            <p>Same city. Same YES or NO choice. Same Human Edge Score.</p>
          </div>
        </section>

        <section class="mode-picker glass-panel">
          <div class="mode-heading">
            <div><span>SELECT GAME MODE</span><h2>Judge CIVIS.</h2></div>
          </div>

          <div class="mode-grid-v2">
            <button class="mode-card-v2 glass-button" data-launch-mode="quick">
              <span class="mode-icon">⚡</span>
              <span class="mode-copy"><strong>Quick Game</strong><span>5 decisions · no levels · ~2 min</span></span>
            </button>
            <button class="mode-card-v2 glass-button" data-launch-mode="story">
              <span class="mode-icon">🏙️</span>
              <span class="mode-copy"><strong>Story Mode</strong><span>12 decisions · 4 city areas</span></span>
            </button>
            <button class="mode-card-v2 glass-button is-locked" disabled>
              <span class="mode-icon">🌐</span>
              <span class="mode-copy"><strong>AtlasVerse</strong><span>The wider world of ATLAS</span></span>
              <span class="lock-chip glass-chip">COMING SOON</span>
            </button>
          </div>
        </section>
        <div class="safe-area"></div>
      </section>
      <div class="desktop-label">MOBILE INTERACTION CONCEPT · 390 × 844</div>
    </main>
  `;

  document.querySelectorAll("[data-launch-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      ensureAudio();
      audio.click();
      startRun(button.dataset.launchMode);
    });
  });
}

/* ---------------- HOW TO PLAY ---------------- */

function renderHowToPlay() {
  root.innerHTML = `
    <main class="prototype-stage">
      <section class="phone-shell home-shell">
        <div class="paper-noise"></div>
        <div class="howto-card glass-panel" style="margin: 60px 16px;">
          <div class="title-word" style="color:rgba(244,241,234,.6);font-size:12px;">HOW TO PLAY</div>
          <h2 style="margin:8px 0 4px;">Three taps. That's it.</h2>
          ${HOW_TO_PLAY.map((step, i) => `<div class="howto-step"><b>0${i + 1}</b>${step}</div>`).join("")}
          <button class="title-cta glass-button" id="howto-continue" style="margin-top:18px;width:100%;border-radius:16px;">LET'S GO</button>
        </div>
        <div class="safe-area"></div>
      </section>
      <div class="desktop-label">MOBILE INTERACTION CONCEPT · 390 × 844</div>
    </main>
  `;
  document.getElementById("howto-continue").addEventListener("click", () => {
    audio.click();
    state.phase = "question";
    render();
  });
}

/* ---------------- RUN SETUP ---------------- */

function startRun(mode) {
  state.mode = mode;
  state.index = 0;
  state.answers = [];
  state.correctCount = 0;
  state.stickerCount = 0;
  state.run = [];

  if (mode === "quick") {
    state.run = QUICK_CASES.map((c) => ({ case: c, levelIndex: null, levelCaseIndex: null }));
  } else {
    STORY_LEVELS.forEach((level, levelIndex) => {
      const served = [];
      for (let i = 0; i < 3; i += 1) {
        const c = drawStoryCase(level, served, state.correctCount / Math.max(1, state.index));
        served.push(c.id);
        state.run.push({ case: c, levelIndex, levelCaseIndex: i });
      }
    });
  }

  state.phase = "howToPlay";
  render();
}

function totalSegments() {
  return state.mode === "quick" ? 5 : 12;
}

function scoreBarHTML() {
  const total = totalSegments();
  const human = state.correctCount;
  const civis = state.answers.length - state.correctCount;
  const cells = Array.from({ length: total }, (_, i) => {
    if (i < human) return `<i class="filled-human"></i>`;
    if (i >= total - civis) return `<i class="filled-civis"></i>`;
    return `<i></i>`;
  }).join("");
  return `
    <div class="score-bar-v2">
      <span class="score-label" style="color:var(--human-blue)">YOU</span>
      <div class="score-track">${cells}</div>
      <span class="score-label" style="color:var(--civis-red)">CIVIS</span>
    </div>
  `;
}

/* ---------------- QUESTION ---------------- */

function renderQuestion() {
  const entry = state.run[state.index];
  const c = entry.case;
  state.chosen = null;
  state.wasTimeout = false;
  state.timeLeft = QUESTION_SECONDS;

  const levelTag =
    state.mode === "story"
      ? `<div class="level-tag">${STORY_LEVELS[entry.levelIndex].name} · CASE ${entry.levelCaseIndex + 1} OF 3</div>`
      : `<div class="level-tag">${SCREEN_COPY.quickCounter(state.index + 1)}</div>`;

  root.innerHTML = `
    <main class="prototype-stage">
      <section class="phone-shell game-shell">
        <div class="paper-noise"></div>
        <div class="stage-header">
          <button class="back-btn glass-chip" id="home-back" aria-label="Back to game modes">←</button>
          <div class="timer-ring" id="timer-ring" style="--pct:1"><span id="timer-text">45</span></div>
        </div>
        <div style="padding:10px 18px 0;">${scoreBarHTML()}</div>

        <section class="case-panel">
          <div class="case-visual">
            <img src="${c.image}" alt="${c.title}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="case-icon-fallback">${c.icon}</div>
          </div>
          ${levelTag}
          <h1 style="margin:10px 0 2px;">${c.situation}</h1>
          <div class="atlas-thought">
            <span>CIVIS DID</span>
            <p>"${c.civisDid}"</p>
          </div>
          <div class="decision-label">DID CIVIS MAKE THE RIGHT CALL?</div>
        </section>

        <div class="yesno-grid">
          <button class="glass-button choice-yes" data-choice="YES">YES</button>
          <button class="glass-button choice-no" data-choice="NO">NO</button>
        </div>
        <div class="safe-area"></div>
      </section>
      <div class="desktop-label">MOBILE INTERACTION CONCEPT · 390 × 844</div>
    </main>
  `;

  document.getElementById("home-back")?.addEventListener("click", () => {
    stopTimer();
    state.phase = "modeSelect";
    render();
  });

  document.querySelectorAll("[data-choice]").forEach((button) => {
    button.addEventListener("click", () => resolveAnswer(button.dataset.choice, c));
  });

  startQuestionTimer(c);
}

function startQuestionTimer(c) {
  stopTimer();
  const ring = document.getElementById("timer-ring");
  const text = document.getElementById("timer-text");
  state.timerHandle = window.setInterval(() => {
    state.timeLeft -= 1;
    if (ring && text) {
      ring.style.setProperty("--pct", String(state.timeLeft / QUESTION_SECONDS));
      text.textContent = String(state.timeLeft);
      if (state.timeLeft <= 10) {
        ring.classList.add("is-urgent");
        audio.tone(880, 0.06, { type: "square", gain: 0.05 });
      }
    }
    if (state.timeLeft <= 0) {
      stopTimer();
      resolveAnswer(null, c, true);
    }
  }, 1000);
}

/* ---------------- ANSWER / DUEL ---------------- */

function resolveAnswer(choice, c, timedOut = false) {
  stopTimer();
  if (state.chosen !== null) return;
  state.chosen = choice;
  state.wasTimeout = timedOut;
  const correct = !timedOut && choice === c.rightAnswer;
  state.answers.push({ correct, timedOut });
  if (correct) state.correctCount += 1;

  audio.transition();
  window.setTimeout(() => {
    correct ? audio.success() : audio.failure();
  }, 120);

  state.phase = "answer";
  render();
}

function renderAnswer() {
  const entry = state.run[state.index];
  const c = entry.case;
  const last = state.answers[state.answers.length - 1];
  const correct = last.correct;
  const civisLine = last.timedOut ? "Ha! Silence. My favourite answer." : c[correct ? "onYes" : "onNo"] || (state.chosen === "YES" ? c.onYes : c.onNo);
  const civisExpr = correct ? "protest" : "gloat";
  const humanExpr = correct ? "idle" : "surprised";

  root.innerHTML = `
    <main class="prototype-stage">
      <section class="phone-shell game-shell">
        <div class="paper-noise"></div>
        <div style="padding:16px 18px 0;">${scoreBarHTML()}</div>

        <div class="duel-stage">
          <div class="being-slot" id="human-slot">${beingHTML("human", humanExpr, 76)}</div>
          ${tesseractLogoHTML(34)}
          <div class="being-slot" id="civis-slot">${beingHTML("civis", civisExpr, 76)}</div>
        </div>
        <div class="duel-bubble civis-bubble" id="civis-bubble" style="margin:0 18px 14px;">CIVIS: "${civisLine}"</div>

        <div class="answer-stamp ${correct ? "is-correct" : "is-wrong"}">
          ${correct ? SCREEN_COPY.correct : last.timedOut ? "TOO SLOW. CIVIS takes this one." : SCREEN_COPY.wrong}
        </div>
        <p style="text-align:center;padding:0 26px;color:var(--ink);font:500 13px/1.5 'DM Sans',sans-serif;">${c.why}</p>

        <div class="sticker-actions">
          <button class="glass-button" id="save-sticker">${SCREEN_COPY.stickerCta}</button>
        </div>
        <div style="padding:0 18px 18px;">
          <button class="title-cta glass-button" id="next-case" style="width:100%;border-radius:16px;">${SCREEN_COPY.nextCta}</button>
        </div>
        <div class="safe-area"></div>
      </section>
      <div class="desktop-label">MOBILE INTERACTION CONCEPT · 390 × 844</div>
    </main>
  `;

  setTesseractState(root, correct ? "correct" : "wrong");

  window.requestAnimationFrame(() => {
    document.getElementById("human-slot")?.querySelector(".being")?.classList.add("is-clashing");
    document.getElementById("civis-slot")?.querySelector(".being")?.style.setProperty("--clash-dir", "-10px");
    document.getElementById("civis-slot")?.querySelector(".being")?.classList.add("is-clashing");
  });

  document.getElementById("save-sticker").addEventListener("click", () => saveSticker(c, civisLine, correct));
  document.getElementById("next-case").addEventListener("click", advanceAfterAnswer);
}

function advanceAfterAnswer() {
  audio.click();
  const entry = state.run[state.index];
  const isStory = state.mode === "story";
  const isLastOfLevel = isStory && entry.levelCaseIndex === 2;
  const isLastCase = state.index === state.run.length - 1;

  if (isLastCase) {
    state.phase = "result";
    render();
    return;
  }

  state.index += 1;

  if (isStory && isLastOfLevel) {
    state.phase = "levelTransition";
    render();
    return;
  }

  state.phase = "question";
  render();
}

/* ---------------- LEVEL TRANSITION (story only) ---------------- */

function renderLevelTransition() {
  const finishedLevel = STORY_LEVELS[state.run[state.index - 1].levelIndex];
  root.innerHTML = `
    <main class="prototype-stage">
      <section class="phone-shell home-shell">
        <div class="paper-noise"></div>
        <div class="howto-card glass-panel" style="margin:100px 16px;text-align:center;">
          ${beingHTML("civis", "protest", 72)}
          <h2 style="margin:14px 0 6px;">${finishedLevel.transition.copy}</h2>
          <div class="duel-bubble civis-bubble" style="margin:12px auto 0;display:inline-block;">CIVIS: "${finishedLevel.transition.civisLine}"</div>
          <button class="title-cta glass-button" id="level-continue" style="margin-top:20px;width:100%;border-radius:16px;">CONTINUE</button>
        </div>
        <div class="safe-area"></div>
      </section>
      <div class="desktop-label">MOBILE INTERACTION CONCEPT · 390 × 844</div>
    </main>
  `;
  document.getElementById("level-continue").addEventListener("click", () => {
    audio.click();
    state.phase = "question";
    render();
  });
}

/* ---------------- STICKER EXPORT (client-side canvas, no backend) ---------------- */

function saveSticker(c, civisLine, correct) {
  state.stickerCount += 1;
  audio.click();

  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 640;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = correct ? "#fdece7" : "#fff4e2";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = "160px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(c.icon, canvas.width / 2, 220);

  ctx.fillStyle = "#c62f3a";
  ctx.font = "700 30px 'Manrope', sans-serif";
  wrapText(ctx, `CIVIS: "${civisLine}"`, canvas.width / 2, 320, 520, 38);

  ctx.fillStyle = "#101c35";
  ctx.font = "700 20px 'DM Mono', monospace";
  ctx.fillText("HUMAN INSTINCTS · ATLAS", canvas.width / 2, canvas.height - 40);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `civis-reaction-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  let cy = y;
  words.forEach((word) => {
    const test = `${line}${word} `;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cy);
      line = `${word} `;
      cy += lineHeight;
    } else {
      line = test;
    }
  });
  ctx.fillText(line, x, cy);
}

/* ---------------- RESULT + LOCAL LEADERBOARD ---------------- */

function readLeaderboard() {
  try {
    return JSON.parse(window.localStorage.getItem(LEADERBOARD_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeLeaderboardEntry(score) {
  const board = readLeaderboard();
  board.push({ score, mode: state.mode, at: Date.now() });
  board.sort((a, b) => b.score - a.score);
  window.localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(board.slice(0, 10)));
  return board.slice(0, 5);
}

function renderResult() {
  const score = state.mode === "quick" ? quickGameScore(state.correctCount) : storyModeScore(state.correctCount, state.run.length);
  const personality = getPersonalityForScore(score);
  const top5 = writeLeaderboardEntry(score);

  root.innerHTML = `
    <main class="prototype-stage">
      <section class="phone-shell home-shell">
        <div class="paper-noise"></div>
        <div class="result-card glass-panel" style="margin:40px 16px;">
          ${beingHTML("civis", "protest", 64)}
          <div class="result-score">${score}</div>
          <div class="level-tag">YOUR HUMAN EDGE SCORE</div>
          <div class="result-type">${personality.type}</div>
          <div class="result-trait">${personality.trait}</div>
          <p class="result-what">${personality.what}</p>
          <div class="duel-bubble civis-bubble" style="margin:14px auto 0;display:inline-block;">CIVIS: "${personality.civisLine}"</div>

          <div class="result-actions">
            <button class="glass-button" id="share-result">${SCREEN_COPY.shareResult}</button>
            <button class="glass-button" id="view-stickers">${SCREEN_COPY.viewStickers} (${state.stickerCount})</button>
            <button class="title-cta glass-button" id="play-again">${SCREEN_COPY.playAgain}</button>
          </div>

          <div class="level-tag" style="margin-top:22px;">LOCAL LEADERBOARD (this device only)</div>
          <div class="leaderboard-list">
            ${top5.map((row, i) => `<div class="leaderboard-row glass-chip"><span>#${i + 1} · ${row.mode.toUpperCase()}</span><b>${row.score}</b></div>`).join("")}
          </div>
        </div>
        <div class="safe-area"></div>
      </section>
      <div class="desktop-label">MOBILE INTERACTION CONCEPT · 390 × 844</div>
    </main>
  `;

  document.getElementById("share-result").addEventListener("click", async () => {
    const message = `I got ${score}/100 on my Human Edge Score in ATLAS: HUMAN INSTINCTS. What's yours?`;
    if (navigator.share) {
      try { await navigator.share({ text: message }); return; } catch { /* user cancelled */ }
    }
    try {
      await navigator.clipboard.writeText(message);
      alert("Copied to clipboard: " + message);
    } catch {
      alert(message);
    }
  });

  document.getElementById("view-stickers").addEventListener("click", () => {
    alert(state.stickerCount ? `You saved ${state.stickerCount} CIVIS reaction(s) to your downloads.` : "No stickers saved yet — save one from an answer screen next run.");
  });

  document.getElementById("play-again").addEventListener("click", () => {
    audio.click();
    state.phase = "title";
    render();
  });
}

/* ---------------- ROUTER ---------------- */

function render() {
  if (state.phase === "title") return renderTitle();
  if (state.phase === "modeSelect") return renderModeSelect();
  if (state.phase === "howToPlay") return renderHowToPlay();
  if (state.phase === "question") return renderQuestion();
  if (state.phase === "answer") return renderAnswer();
  if (state.phase === "levelTransition") return renderLevelTransition();
  if (state.phase === "result") return renderResult();
}

render();

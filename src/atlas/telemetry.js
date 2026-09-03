// Pilot telemetry client.
//
// Fire-and-forget by design: every call is wrapped so a failing network, a
// blocked request or a missing API never interrupts the game. Events are batched
// on a short timer, with an immediate flush for the ones that matter and a
// sendBeacon on page-hide — that beacon is what turns "we stopped hearing from
// them" into a reliable "they quit at Section 3, Q2".

const ENDPOINT = "/api/track";
const FLUSH_INTERVAL_MS = 1500;
const HEARTBEAT_MS = 20_000;
// lead_capture is the single most valuable event in the app — if the player
// closes the tab before the batch timer fires, the contact details are gone.
const IMMEDIATE = new Set(["session_start", "run_complete", "run_start", "lead_capture", "share_card"]);
const STORAGE_KEY = "atlas-pilot-session";
// Stamped on every session so the dashboard can separate the Jul pilot (20 questions,
// free text, adaptive difficulty) from the Aug massy build (12 questions, all-tap).
// Without this the two cohorts average together and neither number means anything.
const BUILD = "v2-massy-2026-08";

function newId() {
  if (crypto?.randomUUID) return crypto.randomUUID().replaceAll("-", "").slice(0, 24);
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// A reload should continue the same session, otherwise one player would look
// like two and the funnel would over-count.
function loadSessionId() {
  try {
    const existing = sessionStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const fresh = newId();
    sessionStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return newId();
  }
}

class Telemetry {
  constructor() {
    this.enabled = false;
    this.sid = "";
    this.queue = [];
    this.flushTimer = 0;
    this.heartbeatTimer = 0;
    this.context = { screen: "welcome", build: BUILD };
  }

  start(identity) {
    if (this.enabled) return;
    this.enabled = true;
    this.sid = loadSessionId();

    this.push("session_start", {
      name: identity?.name || "",
      phone: identity?.phone || "",
      ua: navigator.userAgent,
      touch: navigator.maxTouchPoints > 0,
    });

    this.heartbeatTimer = window.setInterval(() => {
      this.push("heartbeat", { screen: this.context.screen });
    }, HEARTBEAT_MS);

    const leave = () => {
      if (document.visibilityState === "hidden") this.beacon();
    };
    document.addEventListener("visibilitychange", leave);
    window.addEventListener("pagehide", () => this.beacon());
  }

  setScreen(screen) {
    this.context.screen = screen;
  }

  push(type, payload = {}) {
    if (!this.enabled) return;
    this.queue.push({ type, ...payload });
    if (IMMEDIATE.has(type)) {
      this.flush();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = window.setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
    }
  }

  takeBatch() {
    window.clearTimeout(this.flushTimer);
    this.flushTimer = 0;
    const events = this.queue;
    this.queue = [];
    return events;
  }

  flush() {
    const events = this.takeBatch();
    if (!events.length) return;
    try {
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid: this.sid, events }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* never let telemetry break the run */
    }
  }

  // Last word before the tab goes away. sendBeacon survives unload; fetch does not.
  beacon() {
    if (!this.enabled) return;
    this.queue.push({ type: "page_hide", screen: this.context.screen });
    const events = this.takeBatch();
    const body = JSON.stringify({ sid: this.sid, events });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
        return;
      }
    } catch {
      /* fall through */
    }
    try {
      fetch(ENDPOINT, { method: "POST", body, keepalive: true });
    } catch {
      /* nothing more we can do */
    }
  }
}

export const telemetry = new Telemetry();

// Telemetry ingest. The game POSTs small batches of events here; each batch is
// folded into that session's document.
//
// Everything is bounded on purpose — this is a public endpoint, so payload size,
// event count, string lengths and array growth all have hard caps.

import { getSession, putSession, rateLimit } from "./_store.js";
import { clientIp } from "./_ip.js";

const MAX_BODY_BYTES = 32 * 1024;
const MAX_EVENTS_PER_BATCH = 60;
const MAX_ANSWERS = 40;
const MAX_TIMELINE = 160;

const EVENT_TYPES = new Set([
  "session_start",
  "enter_brief",
  "run_start",
  "section_start",
  "question_start",
  "question_answer",
  "run_complete",
  "replay",
  "heartbeat",
  "page_hide",
  "tier_select",
  "axiom_intro_done",
  "lead_capture",
  "share_card",
]);

const str = (value, max = 120) =>
  typeof value === "string" ? value.slice(0, max) : "";
const num = (value, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const int = (value, fallback = 0) => Math.trunc(num(value, fallback));

// Only our own pages may write. A browser always sends Origin on a cross-site
// POST, so a mismatch means someone else's page is trying to stuff our database.
// Server-side callers (no Origin at all) still pass — they hit the same caps.
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// "Chrome 126 · macOS · desktop" — enough to spot a device-specific drop-off
// without storing a full fingerprint.
function summariseDevice(ua = "", isTouch = false) {
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : /Firefox\//.test(ua) ? "Firefox"
    : "Browser";
  const os =
    /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Android/.test(ua) ? "Android"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Windows/.test(ua) ? "Windows"
    : /Linux/.test(ua) ? "Linux"
    : "Unknown OS";
  const form = /iPhone|Android.*Mobile/.test(ua) ? "mobile"
    : /iPad|Tablet/.test(ua) ? "tablet"
    : isTouch ? "touch" : "desktop";
  return `${browser} · ${os} · ${form}`;
}

function blankSession(sid, now) {
  return {
    sid,
    name: "",
    phone: "",
    email: "",
    leadAt: null,
    tier: "",
    device: "",
    startedAt: now,
    lastSeen: now,
    screen: "welcome",
    completed: false,
    scoringVersion: 1,   // pre-v2 runs floored at 40 and are a different scale
    completedAt: null,
    abandonBeacon: false,
    furthest: null,
    hei: 0,
    profile: "",
    traits: {},
    sections: [],
    answers: [],
    timeline: [],
    runs: 0,
  };
}

// Furthest = highest section reached, then highest question inside it. Used for
// the drop-off funnel, so it must only ever move forward.
function trackFurthest(doc, point) {
  const current = doc.furthest;
  const ahead =
    !current ||
    point.sectionIndex > current.sectionIndex ||
    (point.sectionIndex === current.sectionIndex && point.questionIndex > current.questionIndex);
  if (ahead) doc.furthest = point;
}

function applyEvent(doc, event, now) {
  const type = event.type;
  doc.lastSeen = now;

  switch (type) {
    case "session_start": {
      doc.name = str(event.name, 80) || doc.name;
      doc.phone = str(event.phone, 24) || doc.phone;
      doc.device = summariseDevice(str(event.ua, 400), Boolean(event.touch));
      doc.screen = "welcome";
      break;
    }
    case "enter_brief":
      doc.screen = "brief";
      break;
    case "tier_select":
      doc.tier = str(event.tier, 24) || doc.tier;
      break;
    case "axiom_intro_done":
      doc.screen = "axiom";
      break;
    case "lead_capture": {
      // Contact details are captured AFTER the run now, so this is the row that
      // actually matters for follow-up.
      doc.name = str(event.name, 80) || doc.name;
      doc.phone = str(event.phone, 24) || doc.phone;
      doc.email = str(event.email, 120) || doc.email;
      doc.tier = str(event.tier, 24) || doc.tier;
      doc.leadAt = now;
      break;
    }
    case "share_card":
      doc.sharedOutcome = str(event.outcome, 24) || doc.sharedOutcome || "";
      break;
    case "run_start":
      doc.screen = "game";
      doc.runs = (doc.runs || 0) + 1;
      break;
    case "section_start": {
      doc.screen = "game";
      const point = {
        sectionIndex: int(event.sectionIndex),
        sectionId: str(event.sectionId, 40),
        sectionTitle: str(event.sectionTitle, 80),
        questionIndex: 0,
      };
      doc.currentPoint = point;
      trackFurthest(doc, point);
      break;
    }
    case "question_start": {
      doc.screen = "game";
      const point = {
        sectionIndex: int(event.sectionIndex),
        sectionId: str(event.sectionId, 40),
        sectionTitle: str(event.sectionTitle, 80),
        questionIndex: int(event.questionIndex),
      };
      doc.currentPoint = point;
      trackFurthest(doc, point);
      break;
    }
    case "question_answer": {
      if (doc.answers.length < MAX_ANSWERS) {
        doc.answers.push({
          qid: str(event.qid, 60),
          title: str(event.title, 120),
          sectionId: str(event.sectionId, 40),
          sectionTitle: str(event.sectionTitle, 80),
          sectionIndex: int(event.sectionIndex),
          questionIndex: int(event.questionIndex),
          correct: Boolean(event.correct),
          points: int(event.points),
          max: int(event.max, 5),
          ms: int(event.ms),
          timedOut: Boolean(event.timedOut),
          difficulty: Math.round(num(event.difficulty) * 100) / 100,
          at: now,
        });
      }
      break;
    }
    case "run_complete": {
      doc.scoringVersion = int(event.scoringVersion, 1);
      doc.completed = true;
      doc.completedAt = now;
      doc.screen = "results";
      doc.hei = int(event.hei);
      doc.profile = str(event.profile, 80);
      if (event.traits && typeof event.traits === "object") {
        doc.traits = {};
        for (const [key, value] of Object.entries(event.traits).slice(0, 12)) {
          doc.traits[str(key, 40)] = int(value);
        }
      }
      if (Array.isArray(event.sections)) {
        doc.sections = event.sections.slice(0, 8).map((entry) => ({
          id: str(entry?.id, 40),
          title: str(entry?.title, 80),
          points: int(entry?.points),
          max: int(entry?.max, 25),
        }));
      }
      break;
    }
    case "replay":
      doc.screen = "brief";
      break;
    case "heartbeat":
      doc.screen = str(event.screen, 24) || doc.screen;
      break;
    case "page_hide":
      doc.screen = str(event.screen, 24) || doc.screen;
      doc.abandonBeacon = true;
      break;
  }

  doc.timeline.push({
    t: now,
    type,
    label: str(event.label, 120),
  });
  if (doc.timeline.length > MAX_TIMELINE) {
    doc.timeline = doc.timeline.slice(-MAX_TIMELINE);
  }
}

async function readBody(req) {
  // sendBeacon bodies arrive as a raw stream; JSON posts may already be parsed.
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("payload too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  if (!originAllowed(req)) {
    res.status(403).json({ error: "Cross-origin writes are not allowed." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");

  try {
    const allowed = await rateLimit(clientIp(req));
    if (!allowed) {
      res.status(429).json({ error: "Too many events from this address." });
      return;
    }

    const body = await readBody(req);
    const sid = str(body?.sid, 48);
    const events = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS_PER_BATCH) : [];
    if (!sid || !/^[A-Za-z0-9_-]+$/.test(sid)) {
      res.status(400).json({ error: "Missing or malformed sid." });
      return;
    }
    if (!events.length) {
      res.status(200).json({ ok: true, applied: 0 });
      return;
    }

    const now = Date.now();
    const doc = (await getSession(sid)) || blankSession(sid, now);

    let applied = 0;
    for (const event of events) {
      if (!event || !EVENT_TYPES.has(event.type)) continue;
      applyEvent(doc, event, now);
      applied += 1;
    }

    await putSession(sid, doc);
    res.status(200).json({ ok: true, applied });
  } catch (error) {
    res.status(400).json({ error: String(error.message || error) });
  }
}

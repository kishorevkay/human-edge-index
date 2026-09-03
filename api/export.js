// CSV export of every stored session — one row per player, for the team.
// `?scope=answers` gives the long form instead: one row per answered question.

import { listSessions } from "./_store.js";
import { requireKey } from "./_auth.js";
import { ACTIVE_WINDOW_MS } from "./_sections.js";

const cell = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const iso = (ms) => (ms ? new Date(ms).toISOString() : "");

export default async function handler(req, res) {
  const denied = await requireKey(req);
  if (denied) {
    res.status(denied[0]).json(denied[1]);
    return;
  }

  try {
    const url = new URL(req.url, "http://localhost");
    const scope = url.searchParams.get("scope") === "answers" ? "answers" : "players";
    const now = Date.now();
    const sessions = await listSessions(500);

    let header;
    let lines;

    if (scope === "answers") {
      header = [
        "name", "phone", "session_id", "section_no", "section", "question_no",
        "question_id", "question", "correct", "points", "max_points",
        "seconds_taken", "timed_out", "difficulty", "answered_at",
      ];
      lines = sessions.flatMap((doc) =>
        (doc.answers || []).map((answer) => [
          doc.name, doc.phone, doc.sid,
          answer.sectionIndex + 1, answer.sectionTitle || answer.sectionId,
          answer.questionIndex + 1, answer.qid, answer.title,
          answer.correct ? "yes" : "no", answer.points, answer.max,
          Math.round((answer.ms || 0) / 100) / 10,
          answer.timedOut ? "yes" : "no", answer.difficulty, iso(answer.at),
        ]),
      );
    } else {
      header = [
        "name", "phone", "status", "furthest_section_no", "furthest_question_no",
        "furthest_point", "questions_answered", "questions_correct", "accuracy_pct",
        "timeouts", "avg_seconds_per_question", "human_edge_index", "profile",
        "left_the_page", "device", "runs_started", "started_at", "last_seen",
        "completed_at", "session_id",
      ];
      lines = sessions.map((doc) => {
        const answers = doc.answers || [];
        const correct = answers.filter((a) => a.correct).length;
        const status = doc.completed
          ? "completed"
          : now - (doc.lastSeen || 0) < ACTIVE_WINDOW_MS
            ? "playing"
            : "abandoned";
        const point = doc.furthest;
        return [
          doc.name, doc.phone, status,
          point ? point.sectionIndex + 1 : 0,
          point ? point.questionIndex + 1 : 0,
          point ? `${point.sectionTitle || point.sectionId} Q${point.questionIndex + 1}` : "never started",
          answers.length, correct,
          answers.length ? Math.round((correct / answers.length) * 100) : 0,
          answers.filter((a) => a.timedOut).length,
          answers.length
            ? Math.round((answers.reduce((sum, a) => sum + (a.ms || 0), 0) / answers.length) / 100) / 10
            : 0,
          doc.hei || 0, doc.profile,
          doc.abandonBeacon && !doc.completed ? "yes" : "no",
          doc.device, doc.runs || 0,
          iso(doc.startedAt), iso(doc.lastSeen), iso(doc.completedAt),
          doc.sid,
        ];
      });
    }

    const csv = [header, ...lines].map((row) => row.map(cell).join(",")).join("\r\n");
    const stamp = new Date(now).toISOString().slice(0, 16).replace(/[:T]/g, "-");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="atlas-pilot-${scope}-${stamp}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(`﻿${csv}`);
  } catch (error) {
    res.status(500).json({ error: String(error.message || error) });
  }
}

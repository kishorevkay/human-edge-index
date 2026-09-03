// Aggregates every stored session into the shape the dashboard renders.
// Sessions are the source of truth; nothing here is precomputed, so the numbers
// can never drift from the raw data.

import { listSessions, hasRedis } from "./_store.js";
import { requireKey } from "./_auth.js";
import { SECTION_ORDER, ACTIVE_WINDOW_MS, QUESTIONS_PER_RUN } from "./_sections.js";

function statusOf(doc, now) {
  if (doc.completed) return "completed";
  if (now - (doc.lastSeen || 0) < ACTIVE_WINDOW_MS) return "playing";
  return "abandoned";
}

function furthestLabel(doc) {
  const point = doc.furthest;
  if (!point) return doc.name ? "Never started the run" : "Landed only";
  const section = String(point.sectionIndex + 1).padStart(2, "0");
  return `${section} · ${point.sectionTitle || point.sectionId} · Q${point.questionIndex + 1}`;
}

export default async function handler(req, res) {
  const denied = await requireKey(req);
  if (denied) {
    res.status(denied[0]).json(denied[1]);
    return;
  }

  try {
    const now = Date.now();
    const sessions = await listSessions(500);

    const rows = [];
    const questionMap = new Map();
    const dropPoints = new Map();

    let landed = 0;
    let identified = 0;
    let leads = 0;
    let startedRun = 0;
    let completed = 0;
    let playing = 0;
    let abandoned = 0;
    let heiTotal = 0;

    // How many players got at least as far as each section, and each question
    // inside it. Cumulative "reached" counts drive the funnel bars.
    const reachedSection = SECTION_ORDER.map(() => 0);
    // Sections have different lengths now (4/4/2/2), so each row is sized to its own section.
    const reachedQuestion = SECTION_ORDER.map((sec) => new Array(sec.count).fill(0));

    for (const doc of sessions) {
      const status = statusOf(doc, now);
      landed += 1;
      if (doc.name) identified += 1;
      if (doc.email && doc.phone) leads += 1;
      if (doc.furthest) startedRun += 1;
      if (status === "completed") {
        completed += 1;
        heiTotal += doc.hei || 0;
      } else if (status === "playing") playing += 1;
      else abandoned += 1;

      if (doc.furthest) {
        const { sectionIndex, questionIndex } = doc.furthest;
        for (let s = 0; s <= sectionIndex && s < SECTION_ORDER.length; s += 1) {
          reachedSection[s] += 1;
          const secCount = SECTION_ORDER[s].count;
          const limit = s < sectionIndex ? secCount - 1 : questionIndex;
          for (let q = 0; q <= limit && q < secCount; q += 1) {
            reachedQuestion[s][q] += 1;
          }
        }
      }

      // Where the people who did not finish actually stopped.
      if (status !== "completed") {
        const label = furthestLabel(doc);
        dropPoints.set(label, (dropPoints.get(label) || 0) + 1);
      }

      for (const answer of doc.answers || []) {
        const key = answer.qid || answer.title || "unknown";
        const entry = questionMap.get(key) || {
          qid: key,
          title: answer.title,
          sectionTitle: answer.sectionTitle || answer.sectionId,
          sectionIndex: answer.sectionIndex,
          served: 0,
          correct: 0,
          timeouts: 0,
          msTotal: 0,
          pointsTotal: 0,
          maxTotal: 0,
        };
        entry.served += 1;
        if (answer.correct) entry.correct += 1;
        if (answer.timedOut) entry.timeouts += 1;
        entry.msTotal += answer.ms || 0;
        entry.pointsTotal += answer.points || 0;
        entry.maxTotal += answer.max || 5;
        questionMap.set(key, entry);
      }

      const answers = doc.answers || [];
      const correctCount = answers.filter((a) => a.correct).length;
      rows.push({
        sid: doc.sid,
        name: doc.name || "(no name)",
        phone: doc.phone || "",
        email: doc.email || "",
        leadAt: doc.leadAt || null,
        tier: doc.tier || "",
        sharedOutcome: doc.sharedOutcome || "",
        device: doc.device || "",
        status,
        startedAt: doc.startedAt,
        lastSeen: doc.lastSeen,
        completedAt: doc.completedAt,
        furthest: furthestLabel(doc),
        furthestSection: doc.furthest ? doc.furthest.sectionIndex + 1 : 0,
        furthestQuestion: doc.furthest ? doc.furthest.questionIndex + 1 : 0,
        answered: answers.length,
        correct: correctCount,
        accuracy: answers.length ? Math.round((correctCount / answers.length) * 100) : 0,
        avgSeconds: answers.length
          ? Math.round((answers.reduce((sum, a) => sum + (a.ms || 0), 0) / answers.length) / 100) / 10
          : 0,
        timeouts: answers.filter((a) => a.timedOut).length,
        hei: doc.hei || 0,
        profile: doc.profile || "",
        traits: doc.traits || {},
        sections: doc.sections || [],
        runs: doc.runs || 0,
        closedTab: Boolean(doc.abandonBeacon) && status === "abandoned",
      });
    }

    const funnel = [
      { label: "Opened the game", count: landed },
      { label: "Entered their name", count: identified },
      { label: "Gave contact details", count: leads },
      { label: "Started the run", count: startedRun },
      ...SECTION_ORDER.map((section, index) => ({
        label: `Reached ${String(index + 1).padStart(2, "0")} · ${section.title}`,
        count: reachedSection[index],
      })),
      { label: `Finished all ${QUESTIONS_PER_RUN}`, count: completed },
    ].map((step) => ({
      ...step,
      pct: landed ? Math.round((step.count / landed) * 100) : 0,
    }));

    // Answer-level accuracy per section, across every session.
    const sectionAnswers = new Map();
    for (const doc of sessions) {
      for (const answer of doc.answers || []) {
        const entry = sectionAnswers.get(answer.sectionId) || { served: 0, correct: 0, msTotal: 0 };
        entry.served += 1;
        if (answer.correct) entry.correct += 1;
        entry.msTotal += answer.ms || 0;
        sectionAnswers.set(answer.sectionId, entry);
      }
    }

    const sectionDetail = SECTION_ORDER.map((section, index) => {
      const reached = reachedSection[index];
      const nextReached = index + 1 < SECTION_ORDER.length ? reachedSection[index + 1] : completed;
      const answers = sectionAnswers.get(section.id) || { served: 0, correct: 0, msTotal: 0 };
      return {
        id: section.id,
        title: section.title,
        index: index + 1,
        reached,
        movedOn: nextReached,
        lostHere: Math.max(0, reached - nextReached),
        dropRate: reached ? Math.round(((reached - nextReached) / reached) * 100) : 0,
        answered: answers.served,
        accuracy: answers.served ? Math.round((answers.correct / answers.served) * 100) : 0,
        avgSeconds: answers.served ? Math.round(answers.msTotal / answers.served / 100) / 10 : 0,
        perQuestion: reachedQuestion[index].map((count, qIndex) => ({
          question: qIndex + 1,
          reached: count,
        })),
      };
    });

    const questions = [...questionMap.values()]
      .map((entry) => ({
        qid: entry.qid,
        title: entry.title,
        sectionTitle: entry.sectionTitle,
        sectionIndex: entry.sectionIndex,
        served: entry.served,
        correctPct: entry.served ? Math.round((entry.correct / entry.served) * 100) : 0,
        timeouts: entry.timeouts,
        avgSeconds: entry.served ? Math.round(entry.msTotal / entry.served / 100) / 10 : 0,
        scorePct: entry.maxTotal ? Math.round((entry.pointsTotal / entry.maxTotal) * 100) : 0,
      }))
      .sort((a, b) => a.correctPct - b.correctPct || b.served - a.served);

    const drops = [...dropPoints.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      generatedAt: now,
      storage: hasRedis ? "upstash-redis" : "local-file (dev only)",
      totals: {
        questionsPerRun: QUESTIONS_PER_RUN,
        sessions: landed,
        identified,
        startedRun,
        completed,
        playing,
        abandoned,
        completionRate: startedRun ? Math.round((completed / startedRun) * 100) : 0,
        avgHei: completed ? Math.round(heiTotal / completed) : 0,
      },
      funnel,
      sections: sectionDetail,
      questions,
      drops,
      rows: rows.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)),
    });
  } catch (error) {
    res.status(500).json({ error: String(error.message || error) });
  }
}

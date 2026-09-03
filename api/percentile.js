// Where a score sits against everyone who has actually finished.
//
// This exists because the QC review asked for "better than 80% of players" and
// assumed we'd have to invent it. We don't — there are real completed runs. But
// an invented percentile in front of a senior audience is a credibility problem,
// so this endpoint is deliberately conservative:
//
//   * only COMPLETED runs count (a score from someone who quit at Q3 is noise)
//   * below MIN_SAMPLE it returns ready:false and the game says nothing at all
//   * the sample size is returned so the UI can name it — "of 80 people who've
//     finished" is a claim we can defend; a bare "top 20%" is not
//
// Public and unauthenticated on purpose: it returns one aggregate number and
// never touches a name, phone, email or session id.

import { listSessions, rateLimit } from "./_store.js";
import { clientIp } from "./_ip.js";

const MIN_SAMPLE = 30;
const CACHE_MS = 60_000;

let cache = { at: 0, key: "", scores: [] };

// Scores are only comparable within one scoring version. v1 floored every run at
// 40; v2 is a true 0-100. Mixing them would make the percentile quietly wrong,
// which is exactly the credibility problem this endpoint exists to avoid.
async function completedScores(version) {
  const now = Date.now();
  const key = `v${version}`;
  if (now - cache.at < CACHE_MS && cache.key === key && cache.scores.length) return cache.scores;
  const sessions = await listSessions(1000);
  const scores = sessions
    .filter((doc) => doc.completed
      && typeof doc.hei === "number" && doc.hei > 0
      && (doc.scoringVersion || 1) === version)
    .map((doc) => doc.hei)
    .sort((a, b) => a - b);
  cache = { at: now, key, scores };
  return scores;
}

export default async function handler(req, res) {
  try {
    await rateLimit(clientIp(req), 240, 3600);

    const hei = Number(req.query?.hei);
    if (!Number.isFinite(hei) || hei < 0 || hei > 100) {
      res.status(400).json({ error: "hei must be a number between 0 and 100" });
      return;
    }

    const version = Number(req.query?.v) === 1 ? 1 : 2;
    const scores = await completedScores(version);
    if (scores.length < MIN_SAMPLE) {
      // Not enough finishers to say anything honest yet.
      res.status(200).json({ ready: false, sample: scores.length, minSample: MIN_SAMPLE, version });
      return;
    }

    // Strictly-below count, so a score never claims to beat an identical one.
    const below = scores.filter((s) => s < hei).length;
    const percentile = Math.round((below / scores.length) * 100);

    res.setHeader("Cache-Control", "public, max-age=60");
    res.status(200).json({
      ready: true,
      percentile,
      sample: scores.length,
      median: scores[Math.floor(scores.length / 2)],
      version,
    });
  } catch (error) {
    // Never block the results screen on this — it is a nice-to-have.
    res.status(200).json({ ready: false, error: String(error.message || error) });
  }
}

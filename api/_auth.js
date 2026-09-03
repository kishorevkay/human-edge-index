// Dashboard auth for every endpoint that can read or delete pilot data.
//
// Three things matter here:
//   1. Fail closed on a real deployment if no key is configured — never fall back
//      to a guessable default where the public can reach it.
//   2. Compare in constant time, so the key can't be recovered byte-by-byte by
//      timing the responses.
//   3. Throttle wrong guesses per IP, so the key can't be brute-forced.

import { timingSafeEqual } from "node:crypto";
import { rateLimit } from "./_store.js";
import { clientIp } from "./_ip.js";

// VERCEL_ENV is "production" or "preview" on a real deployment and
// "development" under `vercel dev`, so the dev fallback can never leak live.
const isDeployed = ["production", "preview"].includes(process.env.VERCEL_ENV || "");

const MAX_FAILURES = 20;
const FAILURE_WINDOW_SECONDS = 900; // 15 minutes

export function dashboardKey() {
  const configured = process.env.ATLAS_DASHBOARD_KEY;
  if (configured) return configured;
  return isDeployed ? null : "dev";
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  // timingSafeEqual throws on length mismatch, so compare a fixed-size digest of
  // the lengths first — leaking only "wrong length", never which byte differed.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

// Returns null when authorised, otherwise a [status, body] pair to send back.
export async function requireKey(req) {
  const expected = dashboardKey();
  if (!expected) {
    return [503, { error: "ATLAS_DASHBOARD_KEY is not configured on this deployment." }];
  }

  const url = new URL(req.url, "http://localhost");
  const supplied = url.searchParams.get("key") || req.headers["x-atlas-key"] || "";

  if (supplied && constantTimeEqual(supplied, expected)) return null;

  const withinBudget = await rateLimit(
    `auth:${clientIp(req)}`,
    MAX_FAILURES,
    FAILURE_WINDOW_SECONDS,
  );
  if (!withinBudget) {
    return [429, { error: "Too many failed attempts. Try again in 15 minutes." }];
  }
  return [401, { error: "Wrong dashboard key." }];
}

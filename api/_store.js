// Storage adapter for pilot telemetry.
//
// Production: Upstash Redis over its REST API (env injected by the Vercel
// Marketplace integration). Local `vercel dev`: a JSON file in the temp dir so
// the whole flow can be verified without provisioning anything.
//
// The session document is the single source of truth. Aggregates are computed
// at read time in stats.js — no counters to drift out of sync.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REST_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

export const hasRedis = Boolean(REST_URL && REST_TOKEN);

// On a real deployment the local-file fallback would be worse than useless:
// each serverless invocation gets its own /tmp, so data would vanish at random.
// Fail loudly instead of silently losing the pilot's results.
const isDeployed = ["production", "preview"].includes(process.env.VERCEL_ENV || "");

function assertStore() {
  if (!hasRedis && isDeployed) {
    throw new Error(
      "No database configured. Add the Upstash Redis integration to this Vercel project "
      + "(it injects KV_REST_API_URL and KV_REST_API_TOKEN), then redeploy.",
    );
  }
}

const PREFIX = "atlas:";
const INDEX_KEY = `${PREFIX}sids`;
const INDEX_CAP = 5000;

// Sessions are stored with no expiry — the captured names and phone numbers are
// kept as leads, so they must not quietly disappear after a few months.

const sessionKey = (sid) => `${PREFIX}sess:${sid}`;

async function pipeline(commands) {
  const response = await fetch(`${REST_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });
  if (!response.ok) {
    throw new Error(`Upstash ${response.status}: ${await response.text()}`);
  }
  const payload = await response.json();
  return payload.map((entry) => {
    if (entry.error) throw new Error(`Upstash command failed: ${entry.error}`);
    return entry.result;
  });
}

/* ---------------------------------------------------------------- local file */

const LOCAL_PATH = join(tmpdir(), "atlas-pilot-telemetry.json");

function readLocal() {
  if (!existsSync(LOCAL_PATH)) return { sessions: {}, order: [], rate: {} };
  try {
    return JSON.parse(readFileSync(LOCAL_PATH, "utf8"));
  } catch {
    return { sessions: {}, order: [], rate: {} };
  }
}

function writeLocal(db) {
  writeFileSync(LOCAL_PATH, JSON.stringify(db));
}

/* ------------------------------------------------------------------ public API */

export async function getSession(sid) {
  assertStore();
  if (hasRedis) {
    const [raw] = await pipeline([["GET", sessionKey(sid)]]);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return readLocal().sessions[sid] || null;
}

export async function putSession(sid, doc) {
  assertStore();
  if (hasRedis) {
    await pipeline([
      ["SET", sessionKey(sid), JSON.stringify(doc)],
      ["ZADD", INDEX_KEY, doc.startedAt || Date.now(), sid],
      ["ZREMRANGEBYRANK", INDEX_KEY, 0, -(INDEX_CAP + 1)],
    ]);
    return;
  }
  const db = readLocal();
  db.sessions[sid] = doc;
  if (!db.order.includes(sid)) db.order.push(sid);
  writeLocal(db);
}

export async function listSessions(limit = 500) {
  assertStore();
  if (hasRedis) {
    const [ids] = await pipeline([["ZRANGE", INDEX_KEY, 0, limit - 1, "REV"]]);
    if (!ids?.length) return [];
    const values = await pipeline([["MGET", ...ids.map(sessionKey)]]);
    return (values[0] || [])
      .map((raw) => {
        try {
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
  const db = readLocal();
  return db.order
    .map((sid) => db.sessions[sid])
    .filter(Boolean)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
    .slice(0, limit);
}

export async function deleteSession(sid) {
  assertStore();
  if (hasRedis) {
    await pipeline([
      ["DEL", sessionKey(sid)],
      ["ZREM", INDEX_KEY, sid],
    ]);
    return;
  }
  const db = readLocal();
  delete db.sessions[sid];
  db.order = db.order.filter((id) => id !== sid);
  writeLocal(db);
}

export async function clearAll() {
  assertStore();
  if (hasRedis) {
    const [ids] = await pipeline([["ZRANGE", INDEX_KEY, 0, -1]]);
    const commands = [["DEL", INDEX_KEY]];
    for (const sid of ids || []) commands.push(["DEL", sessionKey(sid)]);
    await pipeline(commands);
    return (ids || []).length;
  }
  const db = readLocal();
  const count = db.order.length;
  writeLocal({ sessions: {}, order: [], rate: {} });
  return count;
}

// Coarse per-IP write ceiling so a public endpoint can't be flooded with junk.
export async function rateLimit(ip, max = 400, windowSeconds = 3600) {
  assertStore();
  const key = `${PREFIX}rate:${ip}`;
  if (hasRedis) {
    const [count] = await pipeline([["INCR", key]]);
    if (count === 1) await pipeline([["EXPIRE", key, windowSeconds]]);
    return count <= max;
  }
  const db = readLocal();
  const now = Date.now();
  const entry = db.rate[key];
  if (!entry || now - entry.since > windowSeconds * 1000) {
    db.rate[key] = { since: now, count: 1 };
    writeLocal(db);
    return true;
  }
  entry.count += 1;
  writeLocal(db);
  return entry.count <= max;
}

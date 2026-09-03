// Reset path for repeated pilot runs: wipe everything between batches, or drop
// a single junk session (your own test runs, a mis-typed name).
//
// POST /api/admin?key=...  { "action": "clear", "confirm": "CLEAR" }
// POST /api/admin?key=...  { "action": "delete", "sid": "..." }

import { clearAll, deleteSession } from "./_store.js";
import { requireKey } from "./_auth.js";

export default async function handler(req, res) {
  const denied = await requireKey(req);
  if (denied) {
    res.status(denied[0]).json(denied[1]);
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    if (body.action === "clear") {
      if (body.confirm !== "CLEAR") {
        res.status(400).json({ error: 'Send { "confirm": "CLEAR" } to wipe all pilot data.' });
        return;
      }
      const removed = await clearAll();
      res.status(200).json({ ok: true, removed });
      return;
    }

    if (body.action === "delete") {
      const sid = String(body.sid || "");
      if (!/^[A-Za-z0-9_-]+$/.test(sid)) {
        res.status(400).json({ error: "Bad sid." });
        return;
      }
      await deleteSession(sid);
      res.status(200).json({ ok: true, removed: 1 });
      return;
    }

    res.status(400).json({ error: "Unknown action." });
  } catch (error) {
    res.status(500).json({ error: String(error.message || error) });
  }
}

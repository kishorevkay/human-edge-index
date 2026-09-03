# HUMAN EDGE INDEX — hosting handover

Two things ship together from this one repo:

| | Path | What it is |
|---|---|---|
| **The game** | `/` | Public. 12 questions, mobile-first. |
| **The dashboard** | `/dashboard` | Private. Live funnel, drop-off, and the lead list with names + phone numbers. Key-gated. |

They share one backend (`/api/*`) and one database, so they must be deployed
together — the dashboard is not a separate app.

> ### ⚠️ Read this before choosing where to host
>
> **This is not a static site.** If it is served as plain static files, it
> *appears* to work and silently isn't:
>
> - The game plays perfectly end to end — but every `POST /api/track` is
>   answered with the HTML fallback and a `200`, so **nothing is recorded**. No
>   error, no console warning, no clue anything is wrong.
> - `/dashboard` resolves to the SPA fallback and **serves the game instead of
>   the dashboard**.
>
> Both were reproduced from a clean clone of this repo. The `/api` routes must
> run server-side. See §2.

---

## 1. What you need to provision — nothing

The database stays on our side. You don't need to create a Redis instance, a
Vercel KV, or any store at all.

Kish will send you **two** environment variables to set on the deployment:

| Variable | What it is |
|---|---|
| `KV_REST_API_URL` | Redis REST endpoint (ours) |
| `KV_REST_API_TOKEN` | Redis REST token (ours) |

`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are accepted as aliases if
that's what your tooling injects.

There is a third variable, **`ATLAS_DASHBOARD_KEY`** — the dashboard password.
**Kish will set that one himself** on the deployment; you don't need its value to
host the app, and the game side doesn't use it. If the deployment console needs
someone with access to paste it, give Kish a shout rather than picking a value —
the protected routes fail closed with a 503 until it is set, which is the
intended behaviour.

Two asks on all of these:

- **Set them as secrets**, never as committed config — this repo is public.
- **Please don't point the app at a different store.** The pilot's existing
  players and leads live in ours, and the dashboard reads the same data the
  game writes.

## 2. Hosting

### If you deploy on Vercel — nothing to do
`vercel.json` and the `api/` folder are already in the right shape. Set the three
env vars, point at the repo, done. This is how it runs today.

### If you deploy on your own infrastructure — one adapter needed
The nine files in `api/` are **standard Node handlers** — `export default async
function (req, res)` using `req.url`, `req.method`, `req.headers`, `req.body`,
`res.status().json()`. They are not Vercel-specific beyond that signature, so
mounting them behind Express (or Fastify with a compat layer) is a thin wrapper:

```js
import express from "express";
import track from "./api/track.js";
import stats from "./api/stats.js";
// …admin, export, percentile

const app = express();
app.use(express.json());
app.use(express.static("dist"));           // the built game + dashboard
app.all("/api/track", (req, res) => track(req, res));
app.all("/api/stats", (req, res) => stats(req, res));
// …and the rest
```

Two things the wrapper must preserve:

1. **`req.url` must include the query string.** Auth reads `?key=` from it.
2. **The client IP must be real.** `api/_ip.js` reads `x-forwarded-for` /
   `x-real-ip`. If your proxy strips them, the auth rate-limiter buckets every
   attempt together and will lock out legitimate users.

### What will NOT work
A static-only host (S3/CloudFront with no compute). The game records telemetry
and the dashboard reads it — both need the `/api` routes running server-side.

**Build:** `npm ci && npm run build` → serve `dist/`. Node 18+.

---

## 3. Security — already in place, please don't relax it

- `/api/stats`, `/api/admin`, `/api/export` return **401 without the key**;
  `/api/track` and `/api/percentile` are deliberately public (the game posts to
  them anonymously).
- The key is compared in **constant time** and wrong guesses are **rate-limited
  per IP** (20 per 15 min).
- If `ATLAS_DASHBOARD_KEY` is unset on a real deployment, the protected routes
  **fail closed with 503** rather than falling open. Please keep that behaviour.
- `vercel.json` sets HSTS, `nosniff`, a strict CSP on the dashboard, and
  `noindex` on both the dashboard and `/api`. If you're not on Vercel, please
  reproduce those headers at your edge — particularly **`noindex` on
  `/dashboard`**, which lists personal data.

**The dashboard holds PII** — real names and phone numbers for ~350 people. It
also has a **CLEAR ALL DATA** button that wipes the store with no undo.

---

## 4. The existing pilot data — carries over automatically

Because the database doesn't move, the **352 sessions already recorded (127 with
a phone number) are simply there** the moment your deployment points at it.
Nothing to migrate, nothing to import.

The dashboard will keep counting on top of them.

## 5. Please don't change

- **The `atlas:` key prefix** in `api/_store.js` — it namespaces our data.
- **Scoring** (`SCORING_VERSION` in `src/atlas/main.js`). The percentile endpoint
  only compares runs of the same version; bumping it silently orphans history.
- **The auth behaviour in `api/_auth.js`** — constant-time compare, per-IP rate
  limiting, and failing closed when the key is unset.

## 6. Verifying a deployment

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR_HOST/            # 200 — the game
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR_HOST/api/stats   # 401 — protected, as intended
```

That 401 is the whole check on your side: the game loads and the private routes
refuse anonymous access. Kish will confirm the dashboard itself once he has set
the key.

---

Questions → Kish (Creative Director, upGrad).

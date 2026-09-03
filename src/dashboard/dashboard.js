// Atlas pilot dashboard — near-live view of who is playing and where they quit.
//
// Polls /api/stats every few seconds (paused while the tab is hidden). All
// player-supplied text is escaped on the way in: names and phone numbers come
// from a public form, so they are untrusted input.

import "./dashboard.css";

const KEY_STORAGE = "atlas-dash-key";
const TABS = [{ id: "analytics", label: "ANALYTICS" }, { id: "leads", label: "LEADS" }];
const POLL_MS = 3000;

const root = document.getElementById("dash");

const state = {
  key: "",
  data: null,
  error: "",
  gateError: "",
  lastFetch: 0,
  polling: 0,
  clearArmed: false,
  busy: false,
  tab: (() => {
    try { return localStorage.getItem("atlas-dash-tab") || "analytics"; } catch { return "analytics"; }
  })(),
};

/* ------------------------------------------------------------------ helpers */

const esc = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

function ago(ms) {
  if (!ms) return "—";
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function clockTime(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function bar(value, max, { loss = false, accuracy = false, tip = "" } = {}) {
  const width = max > 0 ? Math.round((value / max) * 100) : 0;
  const cls = loss ? " is-loss" : accuracy ? " is-accuracy" : "";
  return `<div class="bar-track"${tip ? ` data-tip="${esc(tip)}"` : ""}>
    <div class="bar-fill${cls}" style="width:${width}%"></div>
  </div>`;
}

/* -------------------------------------------------------------------- gate */

function renderGate() {
  root.innerHTML = `
    <div class="gate-screen">
      <form class="gate-card" id="gate-form">
        <div class="dash-title"><span class="eyebrow">ATLAS · HUMAN EDGE INDEX</span></div>
        <h1>Pilot dashboard</h1>
        <p>Enter the dashboard key to see live player data.</p>
        <input id="gate-key" type="password" autocomplete="current-password" placeholder="Dashboard key" />
        <button class="dash-btn primary" type="submit">UNLOCK</button>
        ${state.gateError ? `<p class="gate-error">${esc(state.gateError)}</p>` : ""}
      </form>
    </div>
  `;
  document.getElementById("gate-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const value = document.getElementById("gate-key").value.trim();
    if (!value) return;
    state.key = value;
    state.gateError = "";
    load(true);
  });
  document.getElementById("gate-key")?.focus();
}

/* ------------------------------------------------------------------ panels */

function tiles(totals) {
  const items = [
    { label: "PLAYERS", value: totals.sessions, note: `${totals.identified} gave a name`, accent: "" },
    { label: "PLAYING NOW", value: totals.playing, note: "active in the last 75s", accent: "accent-live" },
    { label: `FINISHED ALL ${totals.questionsPerRun || 12}`, value: totals.completed, note: `${totals.completionRate}% of those who started`, accent: "accent-done" },
    { label: "DROPPED OFF", value: totals.abandoned, note: "stopped before the results", accent: "accent-lost" },
    { label: "AVG HUMAN EDGE INDEX", value: totals.avgHei, note: "finished runs only · floors at 40, out of 100", accent: "" },
  ];
  return `<div class="tiles">${items.map((item) => `
    <div class="tile ${item.accent}">
      <span>${item.label}</span>
      <strong>${item.value}</strong>
      <small>${esc(item.note)}</small>
    </div>
  `).join("")}</div>`;
}

function funnelPanel(funnel) {
  const top = funnel[0]?.count || 0;
  if (!top) {
    return panel("Drop-off funnel", "Every stage of a run, and how many players got that far.", emptyState());
  }
  const rows = funnel.map((step, index) => {
    const previous = index > 0 ? funnel[index - 1].count : null;
    const lost = previous === null ? 0 : Math.max(0, previous - step.count);
    const isStage = step.label.startsWith("Reached") || step.label.startsWith("Finished");
    return `
      <div class="funnel-row${isStage ? " is-stage" : ""}">
        <label>${esc(step.label)}</label>
        ${bar(step.count, top, { tip: `${step.count} of ${top} players (${step.pct}%)` })}
        <div class="value">${step.count}
          <em class="${lost ? "loss" : ""}">${lost ? `−${lost} lost` : `${step.pct}%`}</em>
        </div>
      </div>
    `;
  }).join("");
  return panel(
    "Drop-off funnel",
    "Each stage of a run and how many players got that far. The red number is how many were lost at that step.",
    `<div class="funnel">${rows}</div>`,
  );
}

function sectionPanel(sections, startedRun) {
  if (!sections.some((section) => section.reached)) {
    return panel("Section by section", "Where each level loses people.", emptyState());
  }
  const rows = sections.map((section) => {
    const steps = section.perQuestion.map((entry) => {
      const height = startedRun ? Math.round((entry.reached / startedRun) * 100) : 0;
      return `<div class="qstep" data-tip="${esc(section.title)} · Q${entry.question}: ${entry.reached} players reached it">
        <i style="height:${height}%"></i>
      </div>`;
    }).join("");
    return `
      <tr>
        <td class="name-cell">
          <strong>${String(section.index).padStart(2, "0")} · ${esc(section.title)}</strong>
          <small>${section.answered} answers logged</small>
        </td>
        <td class="num">${section.reached}</td>
        <td class="num">${section.lostHere ? `<span style="color:var(--coral);font-weight:800">${section.lostHere}</span>` : "0"}</td>
        <td class="num">${section.dropRate}%</td>
        <td><div class="cell-bar">${bar(section.accuracy, 100, { accuracy: true, tip: `${section.accuracy}% of answers correct` })}<b>${section.accuracy}%</b></div></td>
        <td class="num">${section.avgSeconds ? `${section.avgSeconds}s` : "—"}</td>
        <td>
          <div class="qsteps">${steps}</div>
          <div class="qstep-labels">${section.perQuestion.map((entry) => `<span>Q${entry.question}</span>`).join("")}</div>
        </td>
      </tr>
    `;
  }).join("");
  return panel(
    "Section by section",
    "Reached = players who got into that level. Lost here = players who never made it to the next one. The bars on the right show how deep into each level people got.",
    `<div class="dash-table-wrap"><table class="dash-table">
      <thead><tr>
        <th>SECTION</th><th class="num">REACHED</th><th class="num">LOST HERE</th>
        <th class="num">DROP</th><th>ACCURACY</th><th class="num">AVG TIME</th><th>REACHED PER QUESTION</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`,
    "wide",
  );
}

function dropPanel(drops) {
  if (!drops.length) {
    return panel("Exact quit points", "The precise question players stopped on.", emptyState("Nobody has dropped off yet."));
  }
  const top = drops[0].count;
  const rows = drops.slice(0, 14).map((drop) => `
    <div class="funnel-row">
      <label>${esc(drop.label)}</label>
      ${bar(drop.count, top, { loss: true, tip: `${drop.count} player${drop.count === 1 ? "" : "s"} stopped here` })}
      <div class="value">${drop.count}</div>
    </div>
  `).join("");
  return panel(
    "Exact quit points",
    "The last question each unfinished player saw — sorted by how many stopped there.",
    `<div class="funnel">${rows}</div>`,
  );
}

function questionPanel(questions) {
  if (!questions.length) {
    return panel("Hardest questions", "Ranked by how often players get them wrong.", emptyState());
  }
  const rows = questions.slice(0, 18).map((question) => `
    <tr>
      <td class="wrap"><span class="q-title" data-tip="${esc(question.title)}">${esc(question.title || question.qid)}</span></td>
      <td><small style="color:var(--muted);font-weight:700">${esc(question.sectionTitle || "")}</small></td>
      <td class="num">${question.served}</td>
      <td><div class="cell-bar">${bar(question.correctPct, 100, { accuracy: true, tip: `${question.correctPct}% answered correctly` })}<b>${question.correctPct}%</b></div></td>
      <td class="num">${question.avgSeconds ? `${question.avgSeconds}s` : "—"}</td>
      <td class="num">${question.timeouts || "—"}</td>
    </tr>
  `).join("");
  return panel(
    "Hardest questions",
    "Lowest correct-rate first. A high timeout count next to a low score usually means the question is unclear, not hard.",
    `<div class="dash-table-wrap"><table class="dash-table">
      <thead><tr><th>QUESTION</th><th>SECTION</th><th class="num">SERVED</th><th>CORRECT</th><th class="num">AVG TIME</th><th class="num">TIMED OUT</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`,
    "wide",
  );
}


/* Leads: only players who actually handed over contact details. Separate tab
   because it answers a different question from the analytics — this is the
   follow-up list, not the funnel. */
function leadsPanel(rows) {
  const leads = rows
    .filter((r) => r.email && r.phone)
    .sort((a, b) => (b.leadAt || 0) - (a.leadAt || 0));

  if (!leads.length) {
    return `<section class="panel panel-wide">
      <h2>Leads</h2>
      <p class="dash-empty">No contact details captured yet. Players are asked after they finish all twelve calls.</p>
    </section>`;
  }

  return `<section class="panel panel-wide">
    <h2>Leads <span class="panel-count">${leads.length}</span></h2>
    <div class="dash-table-wrap"><table class="dash-table">
      <thead><tr>
        <th>Name</th><th>Email</th><th>Phone</th><th>H.E.I.</th>
        <th>Profile</th><th>Level</th><th>Shared</th><th>When</th>
      </tr></thead>
      <tbody>
        ${leads.map((r) => `<tr>
          <td><b>${esc(r.name)}</b></td>
          <td><a class="lead-link" href="mailto:${esc(r.email)}">${esc(r.email)}</a></td>
          <td><a class="lead-link" href="tel:${esc(r.phone.replace(/[^0-9+]/g, ""))}">${esc(r.phone)}</a></td>
          <td><b>${r.hei || 0}</b></td>
          <td>${esc(r.profile || "—")}</td>
          <td>${esc((r.tier || "—").toUpperCase())}</td>
          <td>${r.sharedOutcome === "shared" ? "✓" : "—"}</td>
          <td>${esc(ago(r.leadAt))}</td>
        </tr>`).join("")}
      </tbody>
    </table></div>
  </section>`;
}

function leadsCsv(rows) {
  const leads = rows.filter((r) => r.email && r.phone).sort((a, b) => (b.leadAt || 0) - (a.leadAt || 0));
  const head = ["name", "email", "phone", "hei", "profile", "tier", "shared", "capturedAt"];
  const body = leads.map((r) => [
    r.name, r.email, r.phone, r.hei || 0, r.profile || "", r.tier || "",
    r.sharedOutcome || "", r.leadAt ? new Date(r.leadAt).toISOString() : "",
  ]);
  return [head, ...body]
    .map((line) => line.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(","))
    .join("\n");
}

function playerPanel(rows) {
  if (!rows.length) {
    return panel("Players", "Every session, newest activity first.", emptyState("No players yet. Share the game link and they'll appear here within seconds."));
  }
  const body = rows.map((row) => `
    <tr>
      <td class="name-cell">
        <strong>${esc(row.name)}</strong>
        <small>${row.phone ? esc(row.phone) : "no phone"}</small>
      </td>
      <td>
        <span class="status ${row.status}"><i></i>${row.status.toUpperCase()}</span>
        ${row.closedTab ? '<span class="tag-closed" data-tip="We saw them leave the page and they never came back — this drop-off is confirmed, not just an inactivity timeout">LEFT PAGE</span>' : ""}
      </td>
      <td class="wrap">${esc(row.furthest)}</td>
      <td class="num">${row.answered}</td>
      <td class="num">${row.answered ? `${row.accuracy}%` : "—"}</td>
      <td class="num">${row.timeouts || "—"}</td>
      <td class="num">${row.avgSeconds ? `${row.avgSeconds}s` : "—"}</td>
      <td class="num">${row.status === "completed" ? `<b style="color:var(--navy)">${row.hei}</b>` : "—"}</td>
      <td>${row.profile ? esc(row.profile) : "—"}</td>
      <td><small style="color:var(--muted);font-weight:700">${esc(row.device)}</small></td>
      <td>${esc(ago(row.lastSeen))}<br><small style="color:var(--muted)">joined ${esc(clockTime(row.startedAt))}</small></td>
      <td><button class="row-kill" data-kill="${esc(row.sid)}" data-tip="Delete this session" aria-label="Delete session">×</button></td>
    </tr>
  `).join("");
  return panel(
    "Players",
    "Newest activity first. Delete a row to drop your own test runs out of the numbers.",
    `<div class="dash-table-wrap"><table class="dash-table">
      <thead><tr>
        <th>PLAYER</th><th>STATUS</th><th>GOT AS FAR AS</th><th class="num">ANSWERED</th>
        <th class="num">ACCURACY</th><th class="num">TIMEOUTS</th><th class="num">AVG TIME</th>
        <th class="num">HEI</th><th>PROFILE</th><th>DEVICE</th><th>LAST SEEN</th><th></th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table></div>`,
    "wide",
  );
}

function panel(title, note, inner, extraClass = "") {
  return `
    <section class="panel ${extraClass}">
      <div class="panel-head">
        <div><h2>${esc(title)}</h2><p>${esc(note)}</p></div>
      </div>
      ${inner}
    </section>
  `;
}

function emptyState(message = "Waiting for the first player.") {
  return `<div class="empty"><strong>Nothing here yet</strong>${esc(message)}</div>`;
}

/* ---------------------------------------------------------------- main view */

function renderDash() {
  const data = state.data;
  if (!data) return;
  const isDev = data.storage.startsWith("local-file");

  root.innerHTML = `
    <div class="dash">
      <div class="dash-top">
        <div class="dash-title">
          <span class="eyebrow">ATLAS · HUMAN EDGE INDEX · PILOT</span>
          <h1>Where players get stuck</h1>
          <p>Updated ${esc(ago(state.lastFetch))} · refreshing every ${POLL_MS / 1000}s${isDev ? " · LOCAL DEV STORE" : ""}</p>
        </div>
        <div class="dash-actions">
          <span class="live-pill ${document.hidden ? "is-paused" : ""}"><i></i>${document.hidden ? "PAUSED" : "LIVE"}</span>
          <button class="dash-btn" id="btn-refresh">REFRESH</button>
          ${state.tab === "leads"
            ? `<button class="dash-btn" id="btn-csv-leads">CSV · LEADS</button>`
            : `<button class="dash-btn" id="btn-csv-players">CSV · PLAYERS</button>`}
          ${state.tab === "leads" ? "" : `<button class="dash-btn" id="btn-csv-answers">CSV · EVERY ANSWER</button>`}
          <button class="dash-btn danger ${state.clearArmed ? "armed" : ""}" id="btn-clear">
            ${state.clearArmed ? `CLICK AGAIN TO WIPE ${data.totals.sessions}` : "CLEAR ALL DATA"}
          </button>
          <button class="dash-btn" id="btn-lock">LOCK</button>
        </div>
      </div>

      ${state.error ? `<div class="dash-error">${esc(state.error)}</div>` : ""}
      ${tiles(data.totals)}

      <nav class="dash-tabs">
        ${TABS.map((t) => `<button class="dash-tab ${state.tab === t.id ? "is-on" : ""}" data-tab="${t.id}">
          ${t.label}${t.id === "leads" ? `<i>${data.rows.filter((r) => r.email && r.phone).length}</i>` : ""}
        </button>`).join("")}
      </nav>

      <div class="panels">
        ${state.tab === "leads"
          ? leadsPanel(data.rows)
          : `${funnelPanel(data.funnel)}
             ${dropPanel(data.drops)}
             ${sectionPanel(data.sections, data.totals.startedRun)}
             ${playerPanel(data.rows)}
             ${questionPanel(data.questions)}`}
      </div>

      <p class="dash-note">
        A player counts as <b>playing</b> while we've heard from their browser in the last 75 seconds, and as
        <b>dropped off</b> after that. <b>Left page</b> means we saw them navigate away or close the tab and they never
        came back — that drop-off is confirmed rather than inferred from silence. Names and phone numbers are supplied by
        players themselves and stored only for this pilot.
      </p>
    </div>
  `;

  wireDash();
}

function wireDash() {
  document.getElementById("btn-refresh")?.addEventListener("click", () => load());
  document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    state.tab = b.dataset.tab;
    try { localStorage.setItem("atlas-dash-tab", state.tab); } catch { /* private mode */ }
    renderDash();
  }));

  document.getElementById("btn-csv-leads")?.addEventListener("click", () => {
    const csv = leadsCsv(state.data?.rows || []);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `hei-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });

  document.getElementById("btn-csv-players")?.addEventListener("click", () => download("players"));
  document.getElementById("btn-csv-answers")?.addEventListener("click", () => download("answers"));
  document.getElementById("btn-lock")?.addEventListener("click", () => {
    localStorage.removeItem(KEY_STORAGE);
    state.key = "";
    state.data = null;
    stopPolling();
    renderGate();
  });

  const clearButton = document.getElementById("btn-clear");
  clearButton?.addEventListener("click", async () => {
    if (!state.clearArmed) {
      state.clearArmed = true;
      renderDash();
      window.setTimeout(() => {
        if (state.clearArmed) {
          state.clearArmed = false;
          renderDash();
        }
      }, 5000);
      return;
    }
    state.clearArmed = false;
    await admin({ action: "clear", confirm: "CLEAR" });
  });

  document.querySelectorAll("[data-kill]").forEach((button) => {
    button.addEventListener("click", async () => {
      const sid = button.dataset.kill;
      if (!window.confirm("Delete this session permanently?")) return;
      await admin({ action: "delete", sid });
    });
  });

  wireTooltips();
}

/* ----------------------------------------------------------------- tooltip */

let tipEl = null;

function wireTooltips() {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.id = "dash-tip";
    document.body.appendChild(tipEl);
  }
  root.querySelectorAll("[data-tip]").forEach((node) => {
    node.addEventListener("pointerenter", () => {
      const rect = node.getBoundingClientRect();
      tipEl.textContent = node.dataset.tip;
      tipEl.style.left = `${rect.left + rect.width / 2}px`;
      tipEl.style.top = `${rect.top - 8}px`;
      tipEl.classList.add("is-on");
    });
    node.addEventListener("pointerleave", () => tipEl.classList.remove("is-on"));
  });
}

/* ---------------------------------------------------------------- transport */

async function load(fromGate = false) {
  if (state.busy) return;
  state.busy = true;
  try {
    const response = await fetch("/api/stats", {
      headers: { "x-atlas-key": state.key },
      cache: "no-store",
    });

    if (response.status === 401 || response.status === 503) {
      const body = await response.json().catch(() => ({}));
      state.gateError = body.error || "That key didn't work.";
      state.data = null;
      localStorage.removeItem(KEY_STORAGE);
      stopPolling();
      renderGate();
      return;
    }
    if (!response.ok) throw new Error(`API returned ${response.status}`);

    state.data = await response.json();
    state.lastFetch = Date.now();
    state.error = "";
    localStorage.setItem(KEY_STORAGE, state.key);
    renderDash();
    startPolling();
  } catch (error) {
    state.error = `Couldn't reach the API — ${error.message}. Retrying…`;
    if (state.data) {
      renderDash();
    } else if (fromGate) {
      state.gateError = state.error;
      renderGate();
    }
  } finally {
    state.busy = false;
  }
}

async function admin(payload) {
  try {
    const response = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-atlas-key": state.key },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `API returned ${response.status}`);
    state.error = "";
  } catch (error) {
    state.error = `That didn't work — ${error.message}`;
  }
  await load();
}

async function download(scope) {
  try {
    const response = await fetch(`/api/export?scope=${scope}`, {
      headers: { "x-atlas-key": state.key },
    });
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const blob = await response.blob();
    const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") || "")?.[1]
      || `atlas-pilot-${scope}.csv`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    state.error = `Export failed — ${error.message}`;
    renderDash();
  }
}

function startPolling() {
  if (state.polling) return;
  state.polling = window.setInterval(() => {
    if (!document.hidden) load();
  }, POLL_MS);
}

function stopPolling() {
  window.clearInterval(state.polling);
  state.polling = 0;
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.key) load();
  else if (state.data) renderDash();
});

/* -------------------------------------------------------------------- boot */

// A key passed in the URL is moved straight into storage and stripped from the
// address bar so it doesn't sit in history or get pasted around by accident.
const fromUrl = new URL(location.href).searchParams.get("key");
if (fromUrl) {
  state.key = fromUrl;
  history.replaceState(null, "", location.pathname);
} else {
  state.key = localStorage.getItem(KEY_STORAGE) || "";
}

if (state.key) {
  renderGate();
  load(true);
} else {
  renderGate();
}

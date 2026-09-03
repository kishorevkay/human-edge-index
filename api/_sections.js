// Canonical run shape, mirrored from src/atlas/questions.js so the funnel can
// show a section nobody reached yet (0 players) instead of omitting it.
// If the section list in questions.js changes, update this too.

// Rebuilt 2026-08-14 for the massy redesign: SNAP leads, run is 12 questions
// (4/4/2/2) not 20, and OUT-THINK / BLIND SPOT are tap formats, not free text.
export const SECTION_ORDER = [
  { id: "snap", title: "SNAP CALLS", count: 4 },
  { id: "spot", title: "SPOT THE FLAW", count: 4 },
  { id: "counter", title: "OUT-THINK IT", count: 2 },
  { id: "blindspot", title: "THE BLIND SPOT", count: 2 },
];

// Per-section now. Kept as a helper so old call sites don't silently divide by 5.
export const questionsInSection = (id) =>
  (SECTION_ORDER.find((s) => s.id === id) || {}).count || 0;
export const QUESTIONS_PER_RUN = SECTION_ORDER.reduce((n, s) => n + s.count, 0);

// A session counts as still playing if we heard from it inside this window.
// The client heartbeats every 20s, so this tolerates three missed beats.
export const ACTIVE_WINDOW_MS = 75_000;

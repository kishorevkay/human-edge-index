/* ------------------------------------------------------------------
   HAPTICS — navigator.vibrate, tuned for Android.

   v1 didn't fire on a real device. Three causes, all fixed here:

   1. `navigator.vibrate(0)` was called immediately before the pattern to
      cancel any running buzz. On Android Chrome the cancel and the new
      pattern land in the same task and the cancel wins — nothing plays.
      Removed; rapid re-triggering is handled by replacing the pattern,
      which vibrate() already does natively.

   2. Durations were too short to feel. Android vibrator motors have a
      spin-up time; anything under ~10ms is silently dropped and 8ms taps
      (v1's value) are imperceptible even when they do fire. Everything is
      now at or above the perceptual floor while staying light.

   3. Brave — which is Kish's default browser — blocks the Vibration API
      under Shields as a fingerprinting vector. `navigator.vibrate` still
      EXISTS there and returns true, so feature detection can't see it.
      Nothing in code can work around that; `diagnose()` reports it.

   iOS Safari has never shipped this API at all. Android-first by design.
------------------------------------------------------------------- */

const supported = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

/* Android-perceptible. Correct and wrong differ in SHAPE, not just length,
   so they're distinguishable without looking at the screen. */
const PATTERNS = {
  tap:     18,                       // light but actually felt
  select:  25,
  correct: [22, 55, 38],             // short-short-longer, rising: "yes"
  wrong:   [45, 45, 45],             // even double-thud: "no"
  reveal:  [16, 45, 16],
  levelup: [25, 70, 25, 70, 55],
  badge:   [16, 45, 16, 45, 16, 45, 60],
  tick:    12,                       // final 3 seconds only
};

export const haptics = {
  enabled: true,
  lastResult: null,

  supported() { return supported; },

  fire(name) {
    if (!supported || !this.enabled) return false;
    const p = PATTERNS[name];
    if (p === undefined) return false;
    try {
      // No pre-cancel: vibrate() replaces any running pattern by itself, and
      // a preceding vibrate(0) suppresses this call on Android Chrome.
      const ok = navigator.vibrate(p);
      this.lastResult = { name, pattern: p, returned: ok, at: Date.now() };
      return ok;
    } catch (err) {
      this.lastResult = { name, error: String(err) };
      return false;
    }
  },

  setEnabled(on) {
    this.enabled = !!on;
    if (!on && supported) { try { navigator.vibrate(0); } catch { /* noop */ } }
  },

  /* Callable from the console on a real handset: window.__atlasHaptics.diagnose() */
  diagnose() {
    const ua = navigator.userAgent;
    const isBrave = !!(navigator.brave && navigator.brave.isBrave);
    return {
      apiPresent: supported,
      enabled: this.enabled,
      android: /Android/i.test(ua),
      ios: /iPhone|iPad|iPod/i.test(ua),
      brave: isBrave,
      note: isBrave
        ? "Brave blocks vibration under Shields even though the API reports as present. Lower Shields for this site, or test in Chrome."
        : (/iPhone|iPad|iPod/i.test(ua) ? "iOS has no Vibration API." : "Should work — check the phone's own vibration/touch-feedback setting is on."),
      testFired: this.fire("wrong"),
      lastResult: this.lastResult,
    };
  },
};

if (typeof window !== "undefined") window.__atlasHaptics = haptics;

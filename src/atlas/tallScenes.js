/* GENERATED — do not edit by hand.
   Rerun: node tools/build-tall-manifest.mjs

   Which scenes have a 2:3 portrait plate. Phones swap to it so the
   staged reveal can fill the screen instead of showing a 2.5:1 band
   cropped out of a square. Listing it explicitly matters: a <source>
   whose file is missing commits the browser to a broken image, and
   the portrait set lands in batches. */
export const TALL_SCENES = new Set([
  "blind-ambulance-route-v1",
  "blind-driver-heatmap-v1",
  "blind-er-v1",
  "blind-exam-v1",
  "blind-face-attendance-v1",
  "blind-festival-stock-v1",
  "blind-flood-v1",
  "blind-keystrokes-v1",
  "blind-wearable-insurance-v1",
  "counter-checkout-v1",
  "counter-delivery-eta-v1",
  "counter-elevator-v1",
  "counter-empathy-v1",
  "counter-gym-v1",
  "counter-no-show-v1",
  "counter-nurse-v1",
  "counter-password-v1",
  "counter-shy-student-v1",
  "snap-bakery-v1",
  "snap-candy-v1",
  "snap-celebrity-v1",
  "snap-drone-nest-v1",
  "snap-grandpa-v1",
  "snap-pizzas-v1",
  "snap-price-war-v1",
  "snap-review-v1",
  "snap-traffic-v1",
  "spot-5am-v1",
  "spot-ab-test-v1",
  "spot-cancellation-v1",
  "spot-drone-scale-v1",
  "spot-forever-strategy-v1",
  "spot-happiness-v1",
  "spot-hiring-bias-v1",
  "spot-price-test-v1",
  "spot-safety-v1",
]);

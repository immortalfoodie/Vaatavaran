import test from "node:test";
import assert from "node:assert/strict";
import {
  CFM_TO_M3H,
  DIY_BOX_CADR_M3H,
  TARGET_ACH,
  estimateCleanRoom,
} from "../public/clean-room.js";

const room = { lengthM: 4, widthM: 3.5, heightM: 3 }; // 42 m³

test("Air changes per hour and clean-down time follow the well-mixed room model", () => {
  const estimate = estimateCleanRoom({ ...room, cadr: 210, unit: "m3h" });
  assert.equal(estimate.volumeM3, 42);
  assert.equal(estimate.ach, 5);
  // 90% reduction takes ln(10) / ACH hours: 2.3026 / 5 h ≈ 27.6 min.
  assert.equal(estimate.minutesTo90, 28);
  assert.equal(estimate.verdict, "good");
  assert.equal(estimate.recommendedCadrM3h, TARGET_ACH * 42);
});

test("CFM ratings are converted before sizing", () => {
  const estimate = estimateCleanRoom({ ...room, cadr: 100, unit: "cfm" });
  assert.equal(estimate.cadrM3h, Math.round(100 * CFM_TO_M3H));
  assert.equal(estimate.recommendedCadrCfm, Math.round((TARGET_ACH * 42) / CFM_TO_M3H));
});

test("Verdicts distinguish well-sized, helpful and undersized cleaners", () => {
  assert.equal(estimateCleanRoom({ ...room, cadr: 250, unit: "m3h" }).verdict, "good");
  assert.equal(estimateCleanRoom({ ...room, cadr: 120, unit: "m3h" }).verdict, "helps");
  assert.equal(estimateCleanRoom({ ...room, cadr: 40, unit: "m3h" }).verdict, "undersized");
});

test("The DIY box estimate uses the studied ~350 m³/h figure", () => {
  const estimate = estimateCleanRoom({ ...room, cadr: DIY_BOX_CADR_M3H, unit: "m3h" });
  assert.equal(DIY_BOX_CADR_M3H, 350);
  assert.equal(estimate.ach, 8.3);
});

test("Missing, zero, negative or absurd inputs give no estimate rather than a wrong one", () => {
  for (const bad of [
    { ...room, cadr: 0, unit: "m3h" },
    { ...room, cadr: -50, unit: "m3h" },
    { ...room, lengthM: 0, cadr: 200, unit: "m3h" },
    { ...room, heightM: 40, cadr: 200, unit: "m3h" },
    { ...room, cadr: Number.NaN, unit: "m3h" },
    { lengthM: 4, cadr: 200, unit: "m3h" },
  ]) {
    assert.equal(estimateCleanRoom(bad), null, JSON.stringify(bad));
  }
});

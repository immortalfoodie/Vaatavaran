import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ACTIVITIES,
  forecastSlots,
  normalizeActivities,
  planDay,
  windowAt,
} from "../public/planner.js";
import { usAqiFromPm } from "../public/aqi-scales.js";

const UTC = { zone: "UTC" };
const START = Date.parse("2026-11-27T00:00:00Z");
const HOUR = 3_600_000;

/**
 * 24 hourly points from midnight UTC with the given PM2.5 per hour.
 * @param {(hour: number) => number} pm25At
 */
function forecast(pm25At) {
  return Array.from({ length: 24 }, (_, hour) => {
    const pm25 = pm25At(hour);
    return {
      time: new Date(START + hour * HOUR).toISOString(),
      aqi: usAqiFromPm(pm25, null),
      pm25,
    };
  });
}

/** Smoggy mornings and evenings, cleaner afternoon (lowest at 15:00). */
const smoggyDay = forecast((h) => (h >= 13 && h <= 16 ? 30 + Math.abs(15 - h) * 5 : 90));
const sensitive = { sensitive: true };
const relaxed = { sensitive: false };

/** @param {Record<string, unknown>} overrides */
const activity = (overrides) => ({
  type: "walk",
  minutes: 30,
  time: "07:00",
  flexible: true,
  ...overrides,
});

test("A flexible walk moves from a smoggy morning to the cleanest afternoon hour", () => {
  const plan = planDay({
    hourly: smoggyDay,
    city: UTC,
    activities: [activity({})],
    profile: relaxed,
  });
  const [walk] = plan.steps;
  assert.equal(walk.status, "moved");
  assert.equal(walk.planned.time, "2026-11-27T15:00:00.000Z");
  assert.equal(walk.usual.pm25, 90);
  assert.equal(walk.planned.pm25, 30);
  assert.equal(Number(walk.reduction.toFixed(3)), Number((1 - 30 / 90).toFixed(3)));
  assert.match(walk.reason, /90 to 30 µg\/m³/);
  assert.equal(plan.summary.moved, 1);
  assert.equal(Number(plan.summary.reduction.toFixed(3)), 0.667);
});

test("Small improvements are not worth moving an activity", () => {
  const flat = forecast((h) => (h === 15 ? 85 : 90)); // 15:00 is only ~6% cleaner
  const plan = planDay({ hourly: flat, city: UTC, activities: [activity({})], profile: relaxed });
  assert.equal(plan.steps[0].status, "keep");
  assert.equal(plan.steps[0].planned.time, plan.steps[0].usual.time);
  assert.equal(plan.summary.moved, 0);
});

test("Fixed activities keep their time and their hours are not double-booked", () => {
  const plan = planDay({
    hourly: smoggyDay,
    city: UTC,
    activities: [
      activity({ type: "school", time: "15:00", flexible: false }),
      activity({ time: "07:00" }),
    ],
    profile: relaxed,
  });
  const school = plan.steps.find((s) => s.type === "school");
  const walk = plan.steps.find((s) => s.type === "walk");
  assert.equal(school.status, "fixed");
  assert.equal(school.planned.time, "2026-11-27T15:00:00.000Z");
  assert.equal(walk.status, "moved");
  assert.notEqual(walk.planned.time, school.planned.time, "walk avoids the school-run hour");
  assert.equal(walk.planned.pm25, 35, "next-cleanest hour (14:00 or 16:00)");
});

test("Strenuous activity moves indoors when even the cleanest hour is unhealthy", () => {
  const severe = forecast(() => 140); // US AQI ~200+ all day
  const plan = planDay({
    hourly: severe,
    city: UTC,
    activities: [activity({ type: "exercise", minutes: 45 })],
    profile: sensitive,
  });
  assert.equal(plan.steps[0].status, "indoors");
  assert.equal(plan.steps[0].reduction, 0);
  assert.equal(plan.summary.indoors, 1);
  assert.equal(plan.summary.baselineDose, 0, "indoor swaps are not counted as measured savings");
});

test("Suggestions stay within waking hours even when the night is cleaner", () => {
  const cleanNight = forecast((h) => (h < 5 ? 5 : 90 - h));
  const plan = planDay({
    hourly: cleanNight,
    city: UTC,
    activities: [activity({})],
    profile: relaxed,
  });
  const hour = new Date(plan.steps[0].planned.time).getUTCHours();
  assert.ok(hour >= 6 && hour < 22, `suggested ${hour}:00`);
});

test("Times outside the forecast are reported, not guessed", () => {
  const short = smoggyDay.slice(0, 10); // 00:00–09:00 only
  const plan = planDay({
    hourly: short,
    city: UTC,
    activities: [activity({ time: "18:00" })],
    profile: relaxed,
  });
  assert.equal(plan.steps[0].status, "unavailable");
  assert.equal(plan.steps[0].planned, null);
  assert.match(plan.steps[0].reason, /outside the forecast/);
});

test("Hours without a PM2.5 forecast are estimated from AQI and flagged", () => {
  const aqiOnly = smoggyDay.map(({ time, aqi }) => ({ time, aqi }));
  const slots = forecastSlots(aqiOnly, "UTC");
  assert.ok(slots.every((s) => s.pm25Estimated && s.pm25 > 0));
  assert.equal(
    planDay({ hourly: aqiOnly, city: UTC, activities: [activity({})], profile: relaxed })
      .pm25Estimated,
    true,
  );
});

test("Multi-hour activities weight exposure by minutes and never span a data gap", () => {
  const slots = forecastSlots(
    forecast((h) => (h === 7 ? 100 : 40)),
    "UTC",
  );
  const window = windowAt(slots, 7, 90); // 60 min at 100 + 30 min at 40
  assert.equal(window.span, 2);
  assert.equal(window.dose, 100 * 60 + 40 * 30);
  assert.equal(window.pm25, 80);
  const gapped = slots.filter((_, i) => i !== 8);
  assert.equal(windowAt(gapped, 7, 90), null);
});

test("Activity input is validated: bad rows dropped, minutes clamped, list capped", () => {
  const list = normalizeActivities([
    { type: "walk", time: "07:00", minutes: 5 },
    { type: "teleport", time: "08:00" },
    { type: "exercise", time: "25:00" },
    { type: "commute", time: "09:30", minutes: 999, label: "  Office  " },
    null,
  ]);
  assert.equal(list.length, 2);
  assert.deepEqual(
    list.map((a) => [a.id, a.label, a.minutes, a.flexible]),
    [
      ["a1", "Walk", 10, false],
      ["a4", "Office", 180, false],
    ],
  );
  const many = Array.from({ length: 20 }, () => ({ type: "walk", time: "07:00" }));
  assert.equal(normalizeActivities(many).length, MAX_ACTIVITIES);
  assert.deepEqual(normalizeActivities("not a list"), []);
});

test("In half-hour time zones (India) a 07:00 activity uses the hour that contains 07:00", () => {
  // Forecast hours start at :30 local time in IST (UTC+5:30); 01:30 UTC = 07:00 IST.
  const ist = { zone: "Asia/Kolkata" };
  const plan = planDay({
    hourly: smoggyDay,
    city: ist,
    activities: [activity({ time: "07:00", flexible: false, type: "school" })],
    profile: relaxed,
  });
  const [school] = plan.steps;
  assert.equal(school.usualTime, "07:00");
  assert.equal(school.usual.time, "2026-11-27T01:00:00.000Z", "06:30–07:30 IST slot");
  assert.match(school.reason, /^Fixed at 7:00\s?am/i);
});

test("Steps are listed in the order they happen, and indoor swaps leave outdoor hours free", () => {
  const severeMorning = forecast((h) => (h >= 14 && h <= 15 ? 40 : 140));
  const plan = planDay({
    hourly: severeMorning,
    city: UTC,
    activities: [
      activity({ type: "exercise", time: "18:00", minutes: 45 }), // unhealthy at its best → indoors
      activity({ time: "08:00" }),
    ],
    profile: sensitive,
  });
  const order = plan.steps.map((s) => s.type);
  const walk = plan.steps.find((s) => s.type === "walk");
  assert.equal(walk.status, "moved");
  assert.equal(new Date(walk.planned.time).getUTCHours(), 14, "walk gets the clean hour");
  assert.deepEqual(order, ["walk", "exercise"], "14:00 walk before the 18:00 indoor session");
});
